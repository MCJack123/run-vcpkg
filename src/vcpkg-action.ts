// Copyright (c) 2020-2021 Luca Cappa
// Released under the term specified in file LICENSE.txt
// SPDX short identifier: MIT

import * as path from 'path'
import * as core from '@actions/core'
import * as cache from '@actions/cache'
import * as baseutillib from '@lukka/base-util-lib'
import * as runvcpkglib from '@lukka/run-vcpkg-lib'
import * as vcpkgutil from './vcpkg-utils'

// Input names for run-vcpkg only.
export const doNotCacheInput = 'DONOTCACHE';
export const additionalCachedPathsInput = 'ADDITIONALCACHEDPATHS';
export const jobStatusInput = 'JOBSTATUS';
export const doNotCacheOnWorkflowFailureInput = 'DONOTCACHEONWORKFLOWFAILURE';
export const vcpkgJsonGlobInput = 'VCPKGJSONGLOB';

/**
 * The input's name for additional content for the cache key.
 */
export const appendedCacheKeyInput = 'appendedCacheKey';

// Saved data in the action, and consumed by post-action.
export const VCPKG_CACHE_COMPUTEDKEY_STATE = "VCPKG_CACHE_COMPUTEDKEY_STATE";
export const VCPKG_KEY_CACHE_HIT_STATE = "VCPKG_KEY_CACHE_HIT_STATE";
export const VCPKG_DO_NOT_CACHE_STATE = "VCPKG_DO_NOT_CACHE_STATE";
export const VCPKG_ADDED_CACHEKEY_STATE = "VCPKG_ADDED_CACHEKEY_STATE";
export const VCPKG_ROOT_STATE = "VCPKG_ROOT_STATE";
export const VCPKG_ADDITIONAL_CACHED_PATHS_STATE = "VCPKG_ADDITIONAL_CACHED_PATHS_STATE";

export class VcpkgAction {

  private readonly doNotCache: boolean = false;
  private readonly appendedCacheKey: string;
  private readonly vcpkgRootDir: string;
  private readonly runVcpkgCmdString: string;
  private readonly vcpkgJsonGlob: string;
  private readonly userProvidedCommitId: string;
  private hitCacheKey: string | undefined;

  constructor(private baseUtilLib: baseutillib.BaseUtilLib) {
    // Fetch inputs.
    this.doNotCache = core.getInput(doNotCacheInput).toLowerCase() === "true";
    this.appendedCacheKey = core.getInput(appendedCacheKeyInput);
    this.vcpkgRootDir = path.normalize(core.getInput(runvcpkglib.vcpkgDirectory));
    this.userProvidedCommitId = core.getInput(runvcpkglib.vcpkgCommitId);
    console.log(core.getInput(additionalCachedPathsInput));
    vcpkgutil.Utils.addCachedPaths(baseUtilLib.baseLib, core.getInput(additionalCachedPathsInput));
    this.runVcpkgCmdString = core.getInput(runvcpkglib.runVcpkgCmdString);
    this.vcpkgJsonGlob = core.getInput(vcpkgJsonGlobInput);
    // Save state for post action.
    baseUtilLib.baseLib.setState(VCPKG_DO_NOT_CACHE_STATE, this.doNotCache ? "true" : "false");
    baseUtilLib.baseLib.setState(VCPKG_ROOT_STATE, this.vcpkgRootDir);
  }

  public async run(): Promise<void> {
    await this.baseUtilLib.baseLib.mkdirP(this.vcpkgRootDir);
    const keys: baseutillib.KeySet = await vcpkgutil.Utils.computeCacheKeys(
      this.baseUtilLib, this.vcpkgJsonGlob, this.vcpkgRootDir, this.userProvidedCommitId, this.appendedCacheKey);
    if (!keys) {
      this.baseUtilLib.baseLib.error("Computation for the cache key failed!");
    } else {
      this.baseUtilLib.baseLib.setState(VCPKG_CACHE_COMPUTEDKEY_STATE, JSON.stringify(keys));
      await this.baseUtilLib.wrapOp('Restore vcpkg and its artifacts from cache',
        () => this.restoreCache(keys));

      await runvcpkglib.VcpkgRunner.run(this.baseUtilLib.baseLib, this.runVcpkgCmdString);
    }
  }

  private async restoreCache(keys: baseutillib.KeySet): Promise<void> {
    if (this.doNotCache) {
      this.baseUtilLib.baseLib.info(`Skipping as caching is disabled (${doNotCacheInput}:true)`);
    } else {
      const pathsToCache: string[] = vcpkgutil.Utils.getAllCachedPaths(
        this.baseUtilLib.baseLib, this.vcpkgRootDir);
      this.baseUtilLib.baseLib.info(`Cache key: '${keys.primary}'`);
      this.baseUtilLib.baseLib.info(`Cache restore keys: '${keys.restore}'`);
      this.baseUtilLib.baseLib.info(`Cached paths: '${pathsToCache}'`);

      let keyCacheHit: string | undefined;
      try {
        keyCacheHit = await cache.restoreCache(pathsToCache, keys.primary, keys.restore);
      }
      catch (err) {
        this.baseUtilLib.baseLib.warning(`cache.restoreCache() failed: '${(err as Error)?.message ?? "<undefined error>"}', skipping restoring from cache.`);
      }

      if (keyCacheHit) {
        this.baseUtilLib.baseLib.info(`Cache hit, key='${keyCacheHit}'.`);
        this.hitCacheKey = keyCacheHit;
        this.baseUtilLib.baseLib.setState(VCPKG_KEY_CACHE_HIT_STATE, keyCacheHit);
      } else {
        this.baseUtilLib.baseLib.info(`Cache miss.`);
      }
    }
  }
}
