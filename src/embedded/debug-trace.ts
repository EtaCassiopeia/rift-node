/**
 * Diagnostic-only tracing for the embedded FFI segfault (#53). When `RIFT_FFI_DEBUG_TRACE` names a
 * file, {@link traceFfi} appends a label synchronously — `appendFileSync` flushes to the OS, so if
 * the next native step segfaults, the file's last line names where it died (which koffi bind, or
 * which call). Inert unless the env var is set; the embedded debug CI lane is the only thing that
 * sets it, so production behaviour is unchanged.
 */
import { appendFileSync } from 'fs';

const TRACE_FILE = process.env.RIFT_FFI_DEBUG_TRACE;

export function traceFfi(label: string): void {
  if (TRACE_FILE) appendFileSync(TRACE_FILE, `${label}\n`);
}
