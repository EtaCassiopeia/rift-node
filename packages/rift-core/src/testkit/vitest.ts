/**
 * Vitest fixtures for Rift (issue #12): one engine per Vitest worker (acquired lazily, closed when
 * the worker tears down) plus per-test imposter auto-teardown, built on the same
 * `acquireEngine`/`trackCreates` core the Jest helpers (`jest.ts`) use.
 *
 * `vitest` is an optional peer dependency, not installed in this package's own devDependencies —
 * `./vitest-shim.d.ts` supplies just enough ambient typing for this file to type-check without it.
 * At a consumer's runtime, their own installed `vitest` resolves the import for real.
 */

import { test as base } from 'vitest';
import type { RiftEngine } from '../engine.js';
import { acquireEngine, disposeTracked, trackCreates, type AcquireEngineOptions } from './core.js';

export interface RiftTestFixtures {
  /** Worker-scoped: one engine per Vitest worker, acquired on first use and closed once the worker
   * tears down. Exists mainly so the per-test `engine` fixture below can share it — prefer that one
   * for anything that creates imposters. */
  _workerEngine: RiftEngine;
  /** Per-test: every imposter created via `.create()`/`.replaceAll()` during the test is deleted
   * automatically once the test ends. A `.get()`-attached handle is left alone. */
  engine: RiftEngine;
}

/** Builds a Rift-aware `test` with the fixtures above. `opts` is forwarded to `acquireEngine` for
 * every worker's engine — pass an explicit `transport` to skip auto-detect. */
export function createRiftTest(opts?: AcquireEngineOptions) {
  return base.extend<RiftTestFixtures>({
    _workerEngine: [
      async (_context, use) => {
        const engine = await acquireEngine(opts);
        await use(engine);
        await engine.close();
      },
      { scope: 'worker' },
    ],
    engine: async ({ _workerEngine }, use) => {
      const tracked = trackCreates(_workerEngine);
      await use(tracked);
      await disposeTracked(tracked.created);
    },
  });
}

/** The default Rift Vitest test — auto-detects a transport (embedded when it looks available, else
 * spawn), same as `setupRift` (Jest). Call `createRiftTest(opts)` instead for an explicit transport
 * or engine options. */
export const riftTest = createRiftTest();

export { assertReceived } from './assert.js';
