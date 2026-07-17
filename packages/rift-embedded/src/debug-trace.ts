/**
 * Diagnostic-only tracing for the embedded FFI segfault (#53). When `RIFT_FFI_DEBUG_TRACE` is set,
 * {@link traceFfi} records a label at each native step so that, if the next step segfaults, the last
 * label names where it died (which koffi bind, or which call). Writes go two ways, both synchronous
 * so a crash can't lose the last line:
 *   - `writeSync(2, …)` to stderr — appears inline in the CI job log, independent of any file path
 *     or the jest worker/env plumbing (the prior file-only approach came up empty);
 *   - `appendFileSync(RIFT_FFI_DEBUG_TRACE, …)` when that env var names a file, for the artifact.
 * Inert unless `RIFT_FFI_DEBUG_TRACE` is set; only the embedded debug CI lane sets it, so production
 * behaviour is unchanged.
 */
import { appendFileSync, writeSync } from 'fs';

const TRACE_FILE = process.env.RIFT_FFI_DEBUG_TRACE;
const ENABLED = TRACE_FILE !== undefined && TRACE_FILE !== '';

export function traceFfi(label: string): void {
  if (!ENABLED) return;
  try {
    writeSync(2, `[ffi-trace] ${label}\n`);
  } catch {
    // stderr may be unavailable in some worker configs — the file append below is the fallback.
  }
  if (TRACE_FILE) appendFileSync(TRACE_FILE, `${label}\n`);
}
