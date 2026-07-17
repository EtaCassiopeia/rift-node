/**
 * Testkit core (issue #12): the injectable engine-acquisition and imposter-tracking machinery
 * shared by the Vitest fixtures (`vitest.ts`) and the Jest helpers (`jest.ts`).
 *
 * Kept in its own module, separate from both frameworks, so it's unit-testable against a fake
 * `RiftEngine`/`ImposterHandle` under Jest alone (`test/unit/testkit.test.ts`) — no real engine, no
 * Vitest, no process spawn, no cdylib.
 */

import { createRequire } from 'module';
import { rift, type ConnectOptions, type EmbeddedOptions, type ImposterHandle, type RiftEngine } from '../engine.js';
import type { SpawnOptions } from '../spawn/spawn.js';
import { EngineUnavailable, RiftError } from '../errors.js';

// --- engine acquisition ------------------------------------------------------------------------

/** `transport` picks the transport explicitly; omitted, it auto-detects (embedded when it looks
 * available, else spawn — see {@link AcquireEngineDeps.isEmbeddedAvailable}). `engine` is forwarded
 * verbatim to the chosen transport's factory. */
export type AcquireEngineOptions =
  | { transport: 'embedded'; engine?: EmbeddedOptions }
  | { transport: 'spawn'; engine?: SpawnOptions }
  | { transport: { connect: string }; engine?: ConnectOptions }
  | { transport?: undefined; engine?: EmbeddedOptions | SpawnOptions };

/** Injectable so `acquireEngine`'s transport auto-detect and acquisition are unit-testable with
 * fakes (see `test/unit/testkit.test.ts`) — no real engine involved. Defaults to the real `rift.*`
 * factories and a real "does the embedded transport look reachable" probe. */
export interface AcquireEngineDeps {
  embedded(opts?: EmbeddedOptions): Promise<RiftEngine>;
  spawn(opts?: SpawnOptions): Promise<RiftEngine>;
  connect(url: string, opts?: ConnectOptions): Promise<RiftEngine>;
  isEmbeddedAvailable(): boolean;
}

/** Real probe for the no-`transport` default: true when the embedded transport's module graph is
 * reachable — the future split `@rift-vs/rift-embedded` package, or (today) this package's own
 * bundled `./embedded/create.js`. This only answers "is the module there", not "will it actually
 * load a cdylib" (e.g. `koffi` may still be missing) — a `false` here just steers the default
 * toward `spawn` instead; a wrong `true` still surfaces as a clear `EngineUnavailable` below. */
function defaultIsEmbeddedAvailable(): boolean {
  const resolve = createRequire(import.meta.url).resolve;
  try {
    resolve('@rift-vs/rift-embedded');
    return true;
  } catch {
    // Not split out into its own package yet (or not installed) — fall through.
  }
  try {
    // The internal embedded module always resolves in the single-package layout, so gate on the
    // optional `koffi` peer the embedded transport actually needs at runtime — otherwise the default
    // would pick embedded even where koffi is absent and never fall back to spawn.
    resolve('koffi');
    resolve('../embedded/create.js');
    return true;
  } catch {
    return false;
  }
}

export const defaultAcquireEngineDeps: AcquireEngineDeps = {
  embedded: rift.embedded,
  spawn: rift.spawn,
  connect: rift.connect,
  isEmbeddedAvailable: defaultIsEmbeddedAvailable,
};

type ChosenTransport =
  | { kind: 'embedded'; engine?: EmbeddedOptions }
  | { kind: 'spawn'; engine?: SpawnOptions }
  | { kind: 'connect'; url: string; engine?: ConnectOptions };

function chooseTransport(opts: AcquireEngineOptions, deps: AcquireEngineDeps): ChosenTransport {
  const { transport } = opts;
  if (transport === 'embedded') return { kind: 'embedded', engine: opts.engine };
  if (transport === 'spawn') return { kind: 'spawn', engine: opts.engine };
  if (transport !== undefined) return { kind: 'connect', url: transport.connect, engine: opts.engine };
  // No explicit transport: `opts.engine`'s type isn't narrowed to either transport's shape here —
  // the caller already committed to "whichever auto-detect picks" by omitting `transport`.
  return deps.isEmbeddedAvailable()
    ? { kind: 'embedded', engine: opts.engine as EmbeddedOptions | undefined }
    : { kind: 'spawn', engine: opts.engine as SpawnOptions | undefined };
}

function acquireVia(chosen: ChosenTransport, deps: AcquireEngineDeps): Promise<RiftEngine> {
  switch (chosen.kind) {
    case 'embedded':
      return deps.embedded(chosen.engine);
    case 'spawn':
      return deps.spawn(chosen.engine);
    case 'connect':
      return deps.connect(chosen.url, chosen.engine);
  }
}

const MISSING_ARTIFACT: Record<ChosenTransport['kind'], string> = {
  embedded: 'the librift_ffi cdylib (or the optional koffi dependency)',
  spawn: 'the rift engine binary',
  connect: 'a reachable Rift admin endpoint',
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Resolves a `RiftEngine` for the testkit: dispatches on `opts.transport` (auto-detecting embedded
 * vs. spawn when omitted, via `deps.isEmbeddedAvailable`). Any already-typed `RiftError` (e.g. a
 * transport's own `EngineUnavailable`/`EngineVersionError`) propagates unchanged; anything else is
 * wrapped in a single, clear `EngineUnavailable` naming the transport and what it's missing — never
 * a raw rejection from deep inside `rift.spawn`/`rift.embedded`, and never an unhandled rejection
 * (the failure stays part of this function's own returned promise chain throughout). */
export async function acquireEngine(
  opts: AcquireEngineOptions = {},
  deps: AcquireEngineDeps = defaultAcquireEngineDeps
): Promise<RiftEngine> {
  const chosen = chooseTransport(opts, deps);
  try {
    return await acquireVia(chosen, deps);
  } catch (error) {
    if (error instanceof RiftError) throw error;
    throw new EngineUnavailable(
      `testkit could not acquire a Rift engine via the "${chosen.kind}" transport — is ${MISSING_ARTIFACT[chosen.kind]} available? (${errorMessage(error)})`,
      { cause: error }
    );
  }
}

// --- imposter tracking ---------------------------------------------------------------------------

/** A `RiftEngine` wrapped so every imposter it creates is tracked for auto-teardown. */
export interface TrackedEngine extends RiftEngine {
  /** Handles created via `.create()`/`.replaceAll()` on this tracked engine, in creation order. A
   * `.get()`-attached handle is never added here — attaching to an existing imposter is not
   * ownership, so it's never auto-deleted. Mutated in place by `deleteAll()` and by
   * `disposeTracked()`. */
  readonly created: ImposterHandle[];
}

/** Wraps `engine` in a `Proxy` that intercepts `create`/`replaceAll` (pushing the resulting
 * handle(s) onto `.created`) and `deleteAll` (which also clears `.created`, since nothing tracked
 * survives that call). Every other member — notably `get()` — passes straight through. Methods are
 * invoked with `this` bound to `engine` itself (never the proxy/receiver): a real `Engine` closes
 * over private class fields, and reading those through a `Proxy` `this` fails their brand check. */
export function trackCreates(engine: RiftEngine): TrackedEngine {
  const created: ImposterHandle[] = [];

  const proxy = new Proxy(engine, {
    get(target, prop) {
      if (prop === 'created') return created;
      if (prop === 'create') {
        return async (...args: Parameters<RiftEngine['create']>) => {
          const handle = await target.create(...args);
          created.push(handle);
          return handle;
        };
      }
      if (prop === 'replaceAll') {
        return async (...args: Parameters<RiftEngine['replaceAll']>) => {
          const handles = await target.replaceAll(...args);
          created.push(...handles);
          return handles;
        };
      }
      if (prop === 'deleteAll') {
        return async () => {
          await target.deleteAll();
          created.length = 0;
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  return proxy as TrackedEngine;
}

/** Tears down every tracked handle via `Promise.allSettled` — deliberately not `Promise.all`/a
 * `for` loop with `await`: one imposter's failed `delete()` must never stop the others from being
 * cleaned up, nor mask the test's own pass/fail outcome by rejecting the teardown itself. Clears
 * `created` afterward (regardless of individual outcomes) so a reused array starts the next test
 * empty. */
export async function disposeTracked(created: ImposterHandle[]): Promise<void> {
  const outcomes = await Promise.allSettled(created.map((h) => h.delete()));
  created.length = 0;
  // Never throw (that would mask the test outcome), but a persistently-failing teardown would
  // otherwise leave a leaked imposter with no trace — warn so it's debuggable.
  const failures = outcomes.filter((o) => o.status === 'rejected');
  if (failures.length > 0) {
    console.warn(
      `rift testkit: ${failures.length} imposter teardown(s) failed: ${failures
        .map((f) => String((f as PromiseRejectedResult).reason))
        .join('; ')}`
    );
  }
}
