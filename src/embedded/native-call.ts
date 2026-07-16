/**
 * The FFI call discipline (issue #8) — pure, koffi-free, unit-testable against a fake
 * `NativeBinding`. Implements the last-error + decode + free contract every `librift_ffi` call
 * must follow:
 *
 *   - A per-return-kind SENTINEL (`NULL` for `char*`/handle fns, `0` for `rift_create_imposter`,
 *     `-1` for `int32` fns) means failure — read `rift_last_error()`; a populated slot decodes to
 *     the engine's diagnostic (and gets freed), an empty slot ("no diagnostic") gets a generic,
 *     fn-named message instead.
 *   - A non-sentinel `char*` success gets decoded to a JS string and freed.
 *   - Numeric/void successes pass through untouched — nothing to free.
 *
 * `rift_build_info` is deliberately NOT part of this dispatch table: it's a static, always-present
 * probe read once at init via {@link readBuildInfo}, bypassing the sentinel path, and it is never
 * freed (freeing a `const char*` the library owns statically would be a use-after-free/heap
 * corruption bug on the native side).
 */

import { RETURN_KIND } from './native-binding.js';
import type { NativeBinding, NativeCallableFn, NativePtr, ReturnKind } from './native-binding.js';

/** The worker's native state: the koffi binding, its decode fn, and the `RiftHandle*` from
 * `rift_start` (worker-local — never crosses the structured-clone boundary). */
export interface WorkerNativeState {
  binding: NativeBinding;
  decode: Decode;
  handle: NativePtr;
}

/** Decodes a raw native pointer to a JS string. In production this is `(p) => koffi.decode(p,
 * 'string')`; tests inject a fake so this module never has to import koffi. */
export type Decode = (ptr: NativePtr) => string;

export interface NativeCallRequest {
  id: number;
  fn: NativeCallableFn;
  args: unknown[];
}

export interface NativeCallError {
  message: string;
  fn: string;
}

export interface NativeCallOk {
  id: number;
  ok: true;
  value: string | number | null;
}

export interface NativeCallErr {
  id: number;
  ok: false;
  error: NativeCallError;
}

export type NativeCallResponse = NativeCallOk | NativeCallErr;

function invoke(binding: NativeBinding, fn: NativeCallableFn, args: unknown[]): unknown {
  const method = binding[fn] as unknown as (...a: unknown[]) => unknown;
  return method.apply(binding, args);
}

/**
 * Reads and clears the last-error slot, producing the discipline's two failure shapes: the
 * engine's own diagnostic when the slot is populated (freed after decode), or a generic
 * "no diagnostic" message when it's empty — still a failure, just an undiagnosed one, never
 * swallowed into a success. Shared by `handleCall`'s sentinel path and by the worker's
 * `rift_start`-returned-NULL init failure, which needs the exact same discipline outside the
 * dispatch table `handleCall` covers.
 */
export function readLastErrorMessage(binding: NativeBinding, decode: Decode, fn: string): NativeCallError {
  const errPtr = binding.rift_last_error();
  if (errPtr === null) {
    return { message: `${fn} failed with no engine diagnostic`, fn };
  }
  const message = decode(errPtr);
  binding.rift_free(errPtr);
  return { message, fn };
}

/** Reads the static `rift_build_info` string. Deliberately bypasses the sentinel path — it's
 * always present by construction — and never frees the pointer (it's static, library-owned). */
export function readBuildInfo(binding: NativeBinding, decode: Decode): string {
  return decode(binding.rift_build_info());
}

function isSentinel(kind: ReturnKind, result: unknown): boolean {
  switch (kind) {
    case 'uint16':
      return result === 0;
    case 'int32':
      return result === -1;
    case 'string':
      return result === null;
    case 'void':
      return false;
    default: {
      const exhaustive: never = kind;
      throw new Error(`native-call: unhandled return kind ${String(exhaustive)}`);
    }
  }
}

/**
 * Invokes `binding[req.fn](...req.args)` and applies the last-error + decode + free discipline
 * described above. Pure and synchronous: its only I/O is calling the given `binding`/`decode`,
 * which is exactly what makes it unit-testable with a FAKE binding — no worker thread, no koffi,
 * no cdylib required.
 */
export function handleCall(binding: NativeBinding, req: NativeCallRequest, decode: Decode): NativeCallResponse {
  const { id, fn, args } = req;
  const kind = RETURN_KIND[fn];
  const result = invoke(binding, fn, args);

  if (isSentinel(kind, result)) {
    return { id, ok: false, error: readLastErrorMessage(binding, decode, fn) };
  }

  switch (kind) {
    case 'void':
      return { id, ok: true, value: null };
    case 'uint16':
    case 'int32':
      return { id, ok: true, value: result as number };
    case 'string': {
      const value = decode(result as NativePtr);
      binding.rift_free(result as NativePtr);
      return { id, ok: true, value };
    }
    default: {
      const exhaustive: never = kind;
      throw new Error(`native-call: unhandled return kind ${String(exhaustive)}`);
    }
  }
}

/**
 * Dispatches a worker `call` message against the worker's native state: rejects a pre-init call,
 * prepends the worker-local `handle` to the args, and — crucially — converts ANY throw out of the
 * native call (a koffi arg/type mismatch, a bad pointer into `decode`, the exhaustiveness guards
 * above) into an error response carrying `id`. Without this, a throwing call would escape the
 * worker's message handler, emit `'error'` on the parent Worker, and never post a result — hanging
 * the caller and risking a host-process crash. Pure and testable with a fake `WorkerNativeState`.
 */
export function handleCallMessage(
  native: WorkerNativeState | null,
  req: NativeCallRequest
): NativeCallResponse {
  if (native === null) {
    return {
      id: req.id,
      ok: false,
      error: { message: 'embedded worker received a call before init completed', fn: req.fn },
    };
  }
  try {
    return handleCall(
      native.binding,
      { id: req.id, fn: req.fn, args: [native.handle, ...req.args] },
      native.decode
    );
  } catch (err) {
    return {
      id: req.id,
      ok: false,
      error: { message: err instanceof Error ? err.message : String(err), fn: req.fn },
    };
  }
}
