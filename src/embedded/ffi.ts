/**
 * Real koffi-backed `NativeBinding` for `librift_ffi` (issue #8).
 *
 * `koffi` is dynamically `import()`ed ONLY from inside {@link loadNativeBinding}, which itself is
 * only ever called by `worker.ts` at init (i.e. when a caller actually opts into the embedded
 * transport). The SDK core — and every other module in this package — stays zero-dependency;
 * koffi's absence, or the cdylib's absence/incompatibility, surfaces as a rejected Promise at that
 * opt-in moment, never as a failure to `import` this module or any module that (transitively)
 * imports it.
 *
 * Declares all 26 `librift_ffi` C-ABI v2 symbols. Every `char*`-typed result is declared as a raw
 * pointer (`'void *'`), never koffi's auto-decoding `'string'` result type — `native-call.ts`'s
 * `handleCall` is the only thing that decides when to decode and free.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { NativeLibraryError } from '../errors.js';
import type { NativeBinding, NativePtr } from './native-binding.js';
import type { Decode } from './native-call.js';
import { traceFfi } from './debug-trace.js';

type KoffiModule = typeof import('koffi');
type KoffiLib = ReturnType<KoffiModule['load']>;
type KoffiFunction = ReturnType<KoffiLib['func']>;

const here = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')) as {
  minEngineVersion?: string;
};
const MIN_ENGINE_VERSION = packageJson.minEngineVersion ?? '0.0.0';

const PTR = 'void *';
const STR = 'str';

function causeMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Message for a v1 (pre-FFI) engine build: `rift_build_info` is the v2-probe symbol — its
 * absence means the loaded cdylib predates the C-ABI v2 surface this SDK requires. */
export function v1AbiMessage(libPath: string, minEngineVersion: string): string {
  return `ABI v1 library at ${libPath} — rift-node requires C-ABI v2 (rift >= ${minEngineVersion})`;
}

/** Message for a missing file / non-library path — wraps koffi's `load()` failure with the path
 * and the precise underlying cause, so a copy-pasted error names the exact broken input. */
export function loadFailureMessage(libPath: string, cause: unknown): string {
  return `Failed to load native library at ${libPath}: ${causeMessage(cause)}`;
}

async function importKoffi(): Promise<KoffiModule['default']> {
  const mod: KoffiModule = await import('koffi');
  return mod.default;
}

export interface LoadedNative {
  binding: NativeBinding;
  decode: Decode;
}

/**
 * Loads `librift_ffi` from `libPath` and wires up every C-ABI v2 symbol as a `NativeBinding`.
 * Never throws synchronously — always rejects — with a precise, user-actionable message for each
 * of the three failure modes: koffi itself unresolvable (not installed), the path isn't a loadable
 * library (missing file / wrong format), or the library is missing `rift_build_info` (ABI v1).
 */
export async function loadNativeBinding(libPath: string): Promise<LoadedNative> {
  let koffi: KoffiModule['default'];
  try {
    koffi = await importKoffi();
  } catch (err) {
    throw new NativeLibraryError(
      `The embedded transport requires the optional "koffi" dependency, which is not installed: ${causeMessage(err)}`,
      { path: libPath, cause: err }
    );
  }

  let lib: KoffiLib;
  try {
    traceFfi(`koffi.load(${libPath})`);
    lib = koffi.load(libPath);
    traceFfi('koffi.load:ok');
  } catch (err) {
    throw new NativeLibraryError(loadFailureMessage(libPath, err), { path: libPath, cause: err });
  }

  traceFfi('koffi.opaque(RiftHandle)');
  const handlePtr = koffi.pointer(koffi.opaque('RiftHandle'));

  const bindProbe = (name: string, result: string, args: string[]): KoffiFunction => {
    try {
      traceFfi(`bind:${name}`);
      return lib.func(name, result, args);
    } catch (err) {
      throw new NativeLibraryError(v1AbiMessage(libPath, MIN_ENGINE_VERSION), { path: libPath, cause: err });
    }
  };

  const bindRequired = (name: string, result: string, args: string[]): KoffiFunction => {
    try {
      traceFfi(`bind:${name}`);
      return lib.func(name, result, args);
    } catch (err) {
      throw new NativeLibraryError(
        `librift_ffi at ${libPath} is missing the "${name}" symbol — this build may be corrupt or incomplete.`,
        { path: libPath, cause: err }
      );
    }
  };

  // rift_build_info is resolved FIRST, and specially: its absence is the v2-probe failure. Every
  // symbol resolved after it is presumed to be on a genuine v2 library, so a missing symbol past
  // this point means a corrupt/incomplete build, not an old ABI.
  const buildInfoFn = bindProbe('rift_build_info', PTR, []);

  const fn = {
    rift_start: bindRequired('rift_start', handlePtr, []),
    rift_stop: bindRequired('rift_stop', 'void', [handlePtr]),
    rift_create_imposter: bindRequired('rift_create_imposter', 'uint16', [handlePtr, STR]),
    rift_replace_stubs: bindRequired('rift_replace_stubs', 'int32', [handlePtr, 'uint16', STR]),
    rift_delete_imposter: bindRequired('rift_delete_imposter', 'int32', [handlePtr, 'uint16']),
    rift_delete_all: bindRequired('rift_delete_all', 'int32', [handlePtr]),
    rift_apply_config: bindRequired('rift_apply_config', PTR, [handlePtr, STR]),
    rift_recorded: bindRequired('rift_recorded', PTR, [handlePtr, 'uint16']),
    rift_stub_warnings: bindRequired('rift_stub_warnings', PTR, [handlePtr, 'uint16']),
    rift_flow_state_get: bindRequired('rift_flow_state_get', PTR, [handlePtr, 'uint16', STR, STR]),
    rift_flow_state_put: bindRequired('rift_flow_state_put', 'int32', [handlePtr, 'uint16', STR, STR, STR]),
    rift_flow_state_delete: bindRequired('rift_flow_state_delete', 'int32', [handlePtr, 'uint16', STR, STR]),
    rift_space_add_stub: bindRequired('rift_space_add_stub', 'int32', [handlePtr, 'uint16', STR, STR]),
    rift_space_list_stubs: bindRequired('rift_space_list_stubs', PTR, [handlePtr, 'uint16', STR]),
    rift_space_delete: bindRequired('rift_space_delete', 'int32', [handlePtr, 'uint16', STR]),
    rift_space_recorded: bindRequired('rift_space_recorded', PTR, [handlePtr, 'uint16', STR]),
    rift_start_intercept: bindRequired('rift_start_intercept', PTR, [handlePtr, STR]),
    rift_intercept_add_rules: bindRequired('rift_intercept_add_rules', 'int32', [handlePtr, STR]),
    rift_intercept_clear_rules: bindRequired('rift_intercept_clear_rules', 'int32', [handlePtr]),
    rift_intercept_list_rules: bindRequired('rift_intercept_list_rules', PTR, [handlePtr]),
    rift_intercept_ca_pem: bindRequired('rift_intercept_ca_pem', PTR, [handlePtr]),
    rift_intercept_export_truststore: bindRequired('rift_intercept_export_truststore', 'int32', [
      handlePtr,
      STR,
      STR,
      STR,
    ]),
    rift_serve_admin: bindRequired('rift_serve_admin', PTR, [handlePtr, STR]),
    rift_build_info: buildInfoFn,
    rift_last_error: bindRequired('rift_last_error', PTR, []),
    rift_free: bindRequired('rift_free', 'void', [PTR]),
  };

  traceFfi('all-26-bound');
  const binding: NativeBinding = {
    rift_start: () => fn.rift_start() as NativePtr,
    rift_stop: (h) => {
      fn.rift_stop(h);
    },
    rift_create_imposter: (h, json) => fn.rift_create_imposter(h, json) as number,
    rift_replace_stubs: (h, port, json) => fn.rift_replace_stubs(h, port, json) as number,
    rift_delete_imposter: (h, port) => fn.rift_delete_imposter(h, port) as number,
    rift_delete_all: (h) => fn.rift_delete_all(h) as number,
    rift_apply_config: (h, json) => fn.rift_apply_config(h, json) as NativePtr,
    rift_recorded: (h, port) => fn.rift_recorded(h, port) as NativePtr,
    rift_stub_warnings: (h, port) => fn.rift_stub_warnings(h, port) as NativePtr,
    rift_flow_state_get: (h, port, flowId, key) => fn.rift_flow_state_get(h, port, flowId, key) as NativePtr,
    rift_flow_state_put: (h, port, flowId, key, valueJson) =>
      fn.rift_flow_state_put(h, port, flowId, key, valueJson) as number,
    rift_flow_state_delete: (h, port, flowId, key) => fn.rift_flow_state_delete(h, port, flowId, key) as number,
    rift_space_add_stub: (h, port, flowId, json) => fn.rift_space_add_stub(h, port, flowId, json) as number,
    rift_space_list_stubs: (h, port, flowId) => fn.rift_space_list_stubs(h, port, flowId) as NativePtr,
    rift_space_delete: (h, port, flowId) => fn.rift_space_delete(h, port, flowId) as number,
    rift_space_recorded: (h, port, flowId) => fn.rift_space_recorded(h, port, flowId) as NativePtr,
    rift_start_intercept: (h, optionsJson) => fn.rift_start_intercept(h, optionsJson) as NativePtr,
    rift_intercept_add_rules: (h, json) => fn.rift_intercept_add_rules(h, json) as number,
    rift_intercept_clear_rules: (h) => fn.rift_intercept_clear_rules(h) as number,
    rift_intercept_list_rules: (h) => fn.rift_intercept_list_rules(h) as NativePtr,
    rift_intercept_ca_pem: (h) => fn.rift_intercept_ca_pem(h) as NativePtr,
    rift_intercept_export_truststore: (h, format, password, outPath) =>
      fn.rift_intercept_export_truststore(h, format, password, outPath) as number,
    rift_serve_admin: (h, optionsJson) => fn.rift_serve_admin(h, optionsJson) as NativePtr,
    rift_build_info: () => fn.rift_build_info() as NativePtr,
    rift_last_error: () => fn.rift_last_error() as NativePtr,
    rift_free: (p) => {
      fn.rift_free(p);
    },
  };

  const decode: Decode = (p) => koffi.decode(p, 'string');
  return { binding, decode };
}
