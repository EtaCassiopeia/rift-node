/**
 * Ambient type shim for `koffi` (issue #8).
 *
 * `koffi` is an `optionalDependency` — not installed by default — and `src/embedded/ffi.ts` only
 * ever `import()`s it dynamically, at init, inside the worker. This shim exists purely so
 * `tsc --noEmit` type-checks `ffi.ts` without koffi present on disk: it declares the minimal
 * surface actually used (`load`, `opaque`, `pointer`, `.func()`, `decode`), nothing more.
 */
declare module 'koffi' {
  export type KoffiFunction = (...args: unknown[]) => unknown;

  export interface KoffiLib {
    /** Declares a native function by C symbol name, koffi type string result, and arg types. */
    func(name: string, resultType: string, argTypes: string[]): KoffiFunction;
  }

  export function load(path: string): KoffiLib;
  /** Declares a named opaque type (used for the `RiftHandle` pointer target). */
  export function opaque(name: string): string;
  /** Wraps a type token as a pointer-to-that-type token. */
  export function pointer(type: string): string;
  /** Decodes a raw pointer's memory according to `type` (e.g. `'string'` for a NUL-terminated
   * UTF-8 `char*`). Does not free — the caller (`native-call.ts`) frees via `rift_free`. */
  export function decode(pointer: unknown, type: string): string;

  interface Koffi {
    load: typeof load;
    opaque: typeof opaque;
    pointer: typeof pointer;
    decode: typeof decode;
  }

  const koffi: Koffi;
  export default koffi;
}
