/**
 * Embedded transport: koffi FFI binding + worker_threads wrapper for `librift_ffi` (issue #8),
 * cdylib resolution reuse (issue #9), and the `rift.embedded()` wiring — `createEmbeddedEngine` +
 * `EmbeddedAdmin` — that ties them into the same `RiftEngine` facade `connect`/`spawn` produce
 * (issue #10).
 *
 * Subpath-only (`@rift-vs/rift/embedded`) — deliberately NOT re-exported from the package root,
 * since importing it pulls in `worker_threads` and (at opt-in) the optional `koffi` dependency.
 * `rift.embedded()` (the root `RiftEngine` facade's entry point) reaches this module via a dynamic
 * `import()`, not a static one, so calling `rift.connect`/`rift.spawn` alone never loads it.
 */

export { NativeEngine } from './native.js';
export type { NativeEngineLoadOptions, WorkerLike } from './native.js';

export { handleCall, readBuildInfo, readLastErrorMessage } from './native-call.js';
export type { Decode, NativeCallError, NativeCallErr, NativeCallOk, NativeCallRequest, NativeCallResponse } from './native-call.js';

export { RETURN_KIND } from './native-binding.js';
export type { NativeBinding, NativeCallableFn, NativePtr, ReturnKind } from './native-binding.js';

export { loadNativeBinding, v1AbiMessage, loadFailureMessage } from './ffi.js';
export type { LoadedNative } from './ffi.js';

export type { FromWorkerMessage, ToWorkerMessage } from './protocol.js';

// `rift.embedded()` wiring (issue #10).
export { createEmbeddedEngine } from './create.js';
export type { EmbeddedDeps, EmbeddedOptions } from './create.js';

export { EmbeddedAdmin } from './admin.js';
export type { EmbeddedAdminOptions, NativeEngineLike, StartAdminPlane } from './admin.js';

export { AdminBridge } from './bridge.js';
export type { BridgeOptions } from './bridge.js';
