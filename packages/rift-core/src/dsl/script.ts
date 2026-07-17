/**
 * Typed script specs (`_rift.script`) — rift's embedded rhai/js scripting extension.
 *
 * `ScriptSpec` is a union of the three legal shapes, and the `Script.*` factories each produce
 * exactly one of `code` / `file` / `ref`. The per-arm index signature (needed so a spec is a valid
 * `JsonValue` for `_rift.script`) means a hand-built literal could still satisfy several arms at
 * once, so `ResponseBuilder.script()` also validates exclusivity at runtime (throws
 * `InvalidDefinition`). `code` variants carry `engine`; `file` variants omit it (the extension
 * implies rhai vs js). `script(spec)` wraps a spec into a response carrying only `_rift.script`.
 */

import type { JsonValue } from '../model/index.js';

export type ScriptSpec =
  | { engine: 'rhai' | 'js'; code: string; [key: string]: JsonValue }
  | { file: string; [key: string]: JsonValue }
  | { ref: string; [key: string]: JsonValue };

export const Script = {
  rhai(code: string): ScriptSpec {
    return { engine: 'rhai', code };
  },
  js(code: string): ScriptSpec {
    return { engine: 'js', code };
  },
  rhaiFile(path: string): ScriptSpec {
    return { file: path };
  },
  jsFile(path: string): ScriptSpec {
    return { file: path };
  },
  ref(name: string): ScriptSpec {
    return { ref: name };
  },
} as const;
