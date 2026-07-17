/**
 * Jest helpers for Rift (issue #12): `setupRift` registers `beforeAll`/`afterEach`/`afterAll` hooks
 * around the same `acquireEngine`/`trackCreates`/`disposeTracked` core the Vitest fixtures
 * (`vitest.ts`) use — one engine for the whole `describe` block, imposters auto-deleted per test.
 *
 * Unlike `vitest.ts`, this never statically imports its host framework: `beforeAll`/`afterEach`/
 * `afterAll` are ordinary Jest (or Vitest-in-globals-mode) globals, detected at call time via
 * `globalThis` — so this module has nothing to shim and no optional-peer story of its own.
 */

import type { RiftEngine } from '../engine.js';
import { acquireEngine, disposeTracked, trackCreates, type AcquireEngineDeps, type AcquireEngineOptions } from './core.js';

type HookFn = () => Promise<void> | void;

interface TestGlobals {
  beforeAll(fn: HookFn): void;
  afterEach(fn: HookFn): void;
  afterAll(fn: HookFn): void;
}

/** `undefined` outside a Jest/Vitest-globals test run (e.g. `setupRift` imported and called from
 * plain Node) — every hook is checked together since a partial global set isn't a real test runner. */
function testGlobals(): TestGlobals | undefined {
  const g = globalThis as Partial<TestGlobals>;
  if (typeof g.beforeAll !== 'function' || typeof g.afterEach !== 'function' || typeof g.afterAll !== 'function') {
    return undefined;
  }
  return { beforeAll: g.beforeAll, afterEach: g.afterEach, afterAll: g.afterAll };
}

const ACCESS_BEFORE_SETUP =
  'setupRift(): access engine inside a test or hook, after beforeAll has run — either beforeAll ' +
  "has not run yet, or no jest/vitest-globals beforeAll/afterEach/afterAll were found at all";

export interface RiftEngineAccessor {
  readonly engine: RiftEngine;
}

/** Registers the lifecycle hooks and returns an accessor whose `.engine` getter throws until
 * `beforeAll` has actually run — `opts` (and the test-only `deps`) are forwarded to `acquireEngine`. */
export function setupRift(opts?: AcquireEngineOptions, deps?: AcquireEngineDeps): RiftEngineAccessor {
  let tracked: ReturnType<typeof trackCreates> | undefined;
  let engine: RiftEngine | undefined;

  const globals = testGlobals();
  if (globals !== undefined) {
    globals.beforeAll(async () => {
      engine = await acquireEngine(opts, deps);
      tracked = trackCreates(engine);
    });
    globals.afterEach(async () => {
      if (tracked !== undefined) await disposeTracked(tracked.created);
    });
    globals.afterAll(async () => {
      await engine?.close();
      engine = undefined;
      tracked = undefined;
    });
  }

  return {
    get engine(): RiftEngine {
      if (tracked === undefined) throw new Error(ACCESS_BEFORE_SETUP);
      return tracked;
    },
  };
}

export { assertReceived } from './assert.js';
