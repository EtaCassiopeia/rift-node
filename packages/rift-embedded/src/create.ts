/**
 * `rift.embedded()` wiring (issue #10): resolves the `librift_ffi` cdylib, loads the `NativeEngine`,
 * runs the version/feature preflight, and returns the same `RiftEngine` facade `rift.connect`/
 * `rift.spawn` produce — backed by `EmbeddedAdmin` (./admin.ts) instead of an HTTP client.
 *
 * `loadNativeEngine` is injectable specifically so this whole pipeline — preflight, registry, stub
 * routing, and the lazy admin-plane bridge — is unit-testable against a FAKE `NativeEngineLike` with
 * no real cdylib/koffi involved (see test/unit/embedded-admin.test.ts). The default wiring (real
 * `resolveCdylib` + `NativeEngine.load`) is only exercised by the real-cdylib integration suite,
 * which self-skips without `RIFT_FFI_LIB`.
 */

import { Engine, versionIssue, MIN_ENGINE_VERSION, type BuildInfo } from '@rift-vs/rift/internal';
import { EngineVersionError, NativeLibraryError } from '@rift-vs/rift';
import { resolveCdylib } from '@rift-vs/rift';
import { EmbeddedInterceptBackend } from './intercept-backend.js';
import { NativeEngine } from './native.js';
import { EmbeddedAdmin, type NativeEngineLike, type StartAdminPlane } from './admin.js';

// `EmbeddedOptions` is DEFINED in core (`engine.ts`) since the #39 split: core's `rift.embedded()`
// must type its options without referencing this package (a type-import here would cycle the build
// order — core builds first). Re-exported so the package root keeps the full boundary surface.
import type { EmbeddedOptions } from '@rift-vs/rift';
export type { EmbeddedOptions };

export interface EmbeddedDeps {
  /** Injectable native-engine loader; defaults to `resolveCdylib` + `NativeEngine.load`. Supplying
   * this SKIPS `resolveCdylib` entirely — tests inject a fake loader with no real cdylib involved. */
  loadNativeEngine?: (libPath: string) => Promise<NativeEngineLike>;
  /** Injectable admin-plane starter, forwarded to `EmbeddedAdmin`; see `admin.ts`'s `StartAdminPlane`. */
  startAdminPlane?: StartAdminPlane;
}

async function defaultLoadNativeEngine(libPath: string): Promise<NativeEngineLike> {
  return NativeEngine.load(libPath);
}

/**
 * `native.buildInfo` is the FFI's build-info payload, JSON-encoded (`{version, commit?, builtAt?,
 * features[]}`) — distinct from the free-text handshake string `NativeEngine`'s own init log uses
 * internally (issue #8); this is the richer payload the version/feature preflight below needs.
 */
function parseBuildInfo(raw: string): BuildInfo {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new NativeLibraryError(`embedded engine reported non-JSON build info: ${raw}`, { cause });
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new NativeLibraryError(`embedded engine reported malformed build info: ${raw}`);
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj['version'] !== 'string') {
    throw new NativeLibraryError(`embedded engine build info is missing "version": ${raw}`);
  }
  const features = obj['features'];
  return {
    version: obj['version'],
    commit: typeof obj['commit'] === 'string' ? obj['commit'] : undefined,
    builtAt: typeof obj['builtAt'] === 'string' ? obj['builtAt'] : undefined,
    features: Array.isArray(features) ? features.filter((f): f is string => typeof f === 'string') : [],
  };
}

function runVersionPreflight(buildInfo: BuildInfo, versionCheck: 'fail' | 'warn' | 'off'): void {
  if (versionCheck === 'off') return;
  const issue = versionIssue(buildInfo.version);
  if (issue === undefined) return;
  if (versionCheck === 'fail') {
    throw new EngineVersionError(buildInfo.version, MIN_ENGINE_VERSION, issue);
  }
  console.warn(`rift: ${issue}; skipping compatibility gate`);
}

function runFeaturePreflight(buildInfo: BuildInfo, requireFeatures: string[] | undefined): void {
  if (requireFeatures === undefined) return;
  const missing = requireFeatures.find((f) => !buildInfo.features.includes(f));
  if (missing === undefined) return;
  throw new EngineVersionError(
    buildInfo.version,
    MIN_ENGINE_VERSION,
    `this cdylib was built without '${missing}' — requireFeatures needs it. This is a build-variant ` +
      `property (rebuild or download a cdylib variant with '${missing}' enabled), not a version mismatch.`
  );
}

export async function createEmbeddedEngine(
  options: EmbeddedOptions = {},
  deps: EmbeddedDeps = {}
): Promise<Engine> {
  const loadNativeEngine = deps.loadNativeEngine ?? defaultLoadNativeEngine;

  const libPath =
    deps.loadNativeEngine !== undefined
      ? (options.libPath ?? 'injected://native-engine')
      : await resolveCdylib({
          libPath: options.libPath,
          version: options.version,
          download: options.download,
          env: options.cacheDir !== undefined ? { ...process.env, RIFT_CACHE_DIR: options.cacheDir } : undefined,
        });

  const native = await loadNativeEngine(libPath);
  const buildInfo = parseBuildInfo(native.buildInfo);

  runVersionPreflight(buildInfo, options.versionCheck ?? 'fail');
  runFeaturePreflight(buildInfo, options.requireFeatures);

  const admin = new EmbeddedAdmin({ native, buildInfo, startAdminPlane: deps.startAdminPlane });

  // No `onClose` hook: `Engine.close()` already awaits `adminClient.close()` (== `admin.close()`)
  // unconditionally — there's no separate spawned process to tear down for the embedded transport.
  return new Engine(admin, 'embedded', {
    buildInfo: async () => admin.buildInfo,
    adminUrl: () => admin.adminUrl(),
    interceptBackend: new EmbeddedInterceptBackend(native),
  });
}
