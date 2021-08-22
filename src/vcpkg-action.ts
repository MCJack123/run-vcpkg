// Copyright (c) 2020-2021 Luca Cappa
// Released under the term specified in file LICENSE.txt
// SPDX short identifier: MIT

import * as path from 'path'
import * as core from '@actions/core'
import * as cache from '@actions/cache'
import { BaseUtilLib } from '@lukka/base-util-lib'
import * as runvcpkglib from '@lukka/run-vcpkg-lib'
import * as vcpkgutil from './vcpkg-utils'

// Input names for run-vcpkg only.
export const doNotCacheInput = 'doNotCache';
export const additionalCachedPathsInput = 'additionalCachedPaths';

/**
 * The input's name for additional content for the cache key.
 */
export const appendedCacheKeyInput = 'appendedCacheKey';

// Saved data in the action, and consumed by post-action.
export const VCPKG_CACHE_COMPUTED_KEY = "VCPKG_CACHE_COMPUTED_KEY";
export const VCPKG_CACHE_HIT_KEY = "VCPKG_CACHE_HIT_KEY";
export const VCPKG_DO_NOT_CACHE_KEY = "VCPKG_DO_NOT_CACHE_KEY";
export const VCPKG_ADDED_CACHEKEY_KEY = "VCPKG_ADDED_CACHEKEY_KEY";
export const VCPKG_ROOT_KEY = "VCPKG_ROOT_KEY";
export const VCPKG_DO_CACHE_ON_POST_ACTION_KEY = "VCPKG_DO_CACHE_ON_POST_ACTION_KEY";

export class VcpkgAction {

  private readonly doNotCache: boolean = false;
  private hitCacheKey: string | undefined;
  private readonly appendedCacheKey: string;
  private readonly vcpkgRootDir: string;

  constructor(private baseUtilLib: BaseUtilLib) {
    this.doNotCache = core.getInput(doNotCacheInput).toLowerCase() === "true";
    core.saveState(VCPKG_DO_NOT_CACHE_KEY, this.doNotCache ? "true" : "false");
    this.appendedCacheKey = core.getInput(appendedCacheKeyInput);
    this.vcpkgRootDir = path.normalize(core.getInput(runvcpkglib.vcpkgDirectory));
    vcpkgutil.Utils.ensureDirExists(this.vcpkgRootDir);
    core.saveState(VCPKG_ROOT_KEY, this.vcpkgRootDir);
    vcpkgutil.Utils.addCachedPaths(core.getInput(additionalCachedPathsInput));
  }

  public async run(): Promise<void> {
    const restoreKeys: string[] = await vcpkgutil.Utils.computeCacheKey(this.appendedCacheKey);
    const vcpkgCacheComputedKey = restoreKeys[0];
    if (!vcpkgCacheComputedKey) {
      core.error("Computation for the cache key failed!");
    } else {
      core.saveState(VCPKG_CACHE_COMPUTED_KEY, vcpkgCacheComputedKey);
      await this.baseUtilLib.wrapOp('Restore vcpkg and its artifacts from cache',
        () => this.restoreCache(restoreKeys));
      const runner: runvcpkglib.VcpkgRunner = new runvcpkglib.VcpkgRunner(this.baseUtilLib.baseLib);
      await runner.run();

      core.saveState(VCPKG_DO_CACHE_ON_POST_ACTION_KEY, "true");
    }
  }

  private async saveCache(key: string): Promise<void> {
    await vcpkgutil.Utils.saveCache(this.doNotCache, key, this.hitCacheKey,
      vcpkgutil.Utils.getAllCachedPaths(this.baseUtilLib.baseLib, this.vcpkgRootDir));
  }

  private async restoreCache(restoreKeys: string[]): Promise<void> {
    try {
      if (this.doNotCache) {
        core.info(`Caching is disabled (${doNotCacheInput}=true)`);
      } else {
        const pathsToCache: string[] = vcpkgutil.Utils.getAllCachedPaths(this.baseUtilLib.baseLib, this.vcpkgRootDir);
        const primaryKey = restoreKeys.shift() as string;
        core.info(`Cache key: '${primaryKey}'`);
        core.info(`Cache restore keys: '${restoreKeys}'`);
        core.info(`Cached paths: '${pathsToCache}'`);

        let cacheHitId: string | undefined;
        try {
          cacheHitId = await cache.restoreCache(pathsToCache, primaryKey, restoreKeys);
        }
        catch (err) {
          try {
            core.warning(`restoreCache() failed once: '${err?.toString()}' , retrying...`);
            cacheHitId = await cache.restoreCache(pathsToCache, primaryKey, restoreKeys);
          }
          catch (err) {
            core.warning(`restoreCache() failed again: '${err?.toString()}'.`);
          }
        }

        if (cacheHitId) {
          core.info(`Cache hit, id=${cacheHitId}.`);
          this.hitCacheKey = cacheHitId;
          core.saveState(VCPKG_CACHE_HIT_KEY, cacheHitId);
        } else {
          core.info(`Cache miss.`);
        }
      }
    } catch (err) {
      const error: Error = err as Error;
      if (error?.stack) {
        core.info(error.stack);
      }
    }
  }
}
