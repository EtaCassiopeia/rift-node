/**
 * Embedded transport (issue #8): koffi FFI binding + worker_threads wrapper for `librift_ffi`.
 *
 * Subpath-only (`@rift-vs/rift/embedded`) — deliberately NOT re-exported from the package root,
 * since importing it pulls in `worker_threads` and (at opt-in) the optional `koffi` dependency.
 * Wiring this into `rift.embedded()` on the root `RiftEngine` facade is issue #10.
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
