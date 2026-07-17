/**
 * `librift_ffi` C-ABI v2 surface (issue #8), shaped for koffi: every argument/return is a pointer
 * or a primitive — no auto-decoded strings. `char*` returns come back as {@link NativePtr} (raw,
 * possibly-null) so `native-call.ts`'s `handleCall` controls the decode-then-free ordering itself;
 * input JSON strings are passed as plain `string` (koffi encodes those on the way in — there's no
 * discipline needed for an argument the callee copies out of).
 */

/** An opaque native pointer as koffi hands it back: a `RiftHandle*` or an unfreed `char*`. `null`
 * is the universal "this pointer is absent" sentinel (a real `NULL`). */
export type NativePtr = unknown;

export interface NativeBinding {
  rift_start(): NativePtr;
  rift_stop(handle: NativePtr): void;
  rift_create_imposter(handle: NativePtr, json: string): number;
  rift_replace_stubs(handle: NativePtr, port: number, json: string): number;
  rift_delete_imposter(handle: NativePtr, port: number): number;
  rift_delete_all(handle: NativePtr): number;
  rift_apply_config(handle: NativePtr, json: string): NativePtr;
  rift_recorded(handle: NativePtr, port: number): NativePtr;
  rift_stub_warnings(handle: NativePtr, port: number): NativePtr;
  rift_flow_state_get(handle: NativePtr, port: number, flowId: string, key: string): NativePtr;
  rift_flow_state_put(handle: NativePtr, port: number, flowId: string, key: string, valueJson: string): number;
  rift_flow_state_delete(handle: NativePtr, port: number, flowId: string, key: string): number;
  rift_space_add_stub(handle: NativePtr, port: number, flowId: string, json: string): number;
  rift_space_list_stubs(handle: NativePtr, port: number, flowId: string): NativePtr;
  rift_space_delete(handle: NativePtr, port: number, flowId: string): number;
  rift_space_recorded(handle: NativePtr, port: number, flowId: string): NativePtr;
  rift_start_intercept(handle: NativePtr, optionsJson: string): NativePtr;
  rift_intercept_add_rules(handle: NativePtr, json: string): number;
  rift_intercept_clear_rules(handle: NativePtr): number;
  rift_intercept_list_rules(handle: NativePtr): NativePtr;
  rift_intercept_ca_pem(handle: NativePtr): NativePtr;
  rift_intercept_export_truststore(handle: NativePtr, format: string, password: string, outPath: string): number;
  rift_serve_admin(handle: NativePtr, optionsJson: string): NativePtr;
  /** Static string — always present, NEVER pass to `rift_free`. */
  rift_build_info(): NativePtr;
  /** Reads and clears the calling thread's last-error slot. */
  rift_last_error(): NativePtr;
  rift_free(ptr: NativePtr): void;
}

export type ReturnKind = 'void' | 'uint16' | 'int32' | 'string';

/** Every `NativeBinding` member EXCEPT the four handled specially outside `handleCall`'s dispatch
 * table: `rift_start` (one-time init, its own NULL-handle failure path), `rift_last_error` and
 * `rift_free` (the discipline's own internal machinery), and `rift_build_info` (read once at
 * init, bypassing the sentinel path entirely — see `readBuildInfo`). */
type DispatchableFn = Exclude<
  keyof NativeBinding,
  'rift_start' | 'rift_last_error' | 'rift_free' | 'rift_build_info'
>;

/** Maps each dispatchable call to how `handleCall` classifies its return value: which sentinel
 * (if any) signals failure, and whether a success value needs decode+free. Keyed off
 * `DispatchableFn` so adding/removing a `NativeBinding` member forces this table to stay exhaustive. */
export const RETURN_KIND: Record<DispatchableFn, ReturnKind> = {
  rift_stop: 'void',
  rift_create_imposter: 'uint16',
  rift_replace_stubs: 'int32',
  rift_delete_imposter: 'int32',
  rift_delete_all: 'int32',
  rift_apply_config: 'string',
  rift_recorded: 'string',
  rift_stub_warnings: 'string',
  rift_flow_state_get: 'string',
  rift_flow_state_put: 'int32',
  rift_flow_state_delete: 'int32',
  rift_space_add_stub: 'int32',
  rift_space_list_stubs: 'string',
  rift_space_delete: 'int32',
  rift_space_recorded: 'string',
  rift_start_intercept: 'string',
  rift_intercept_add_rules: 'int32',
  rift_intercept_clear_rules: 'int32',
  rift_intercept_list_rules: 'string',
  rift_intercept_ca_pem: 'string',
  rift_intercept_export_truststore: 'int32',
  rift_serve_admin: 'string',
};

export type NativeCallableFn = keyof typeof RETURN_KIND;
