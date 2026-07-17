/**
 * Embedded transport worker (issue #8) — a THIN worker_threads wrapper. All correctness logic
 * (sentinel detection, decode-then-free, per-call last-error reads) lives in `native-call.ts`'s
 * `handleCall`, unit-tested there against a fake binding; this file only owns:
 *
 *   - building the real `NativeBinding` from koffi at init (via `ffi.ts`, which is where the
 *     dynamic `import('koffi')` actually happens),
 *   - holding the one piece of state `handleCall` doesn't manage itself — the `RiftHandle*` from
 *     `rift_start` — and prepending it to every dispatched call's args,
 *   - the message-loop plumbing and graceful/forced shutdown.
 */

import { appendFileSync } from 'fs';
import { parentPort } from 'worker_threads';
import { loadNativeBinding } from './ffi.js';
import { handleCallMessage, readBuildInfo, readLastErrorMessage } from './native-call.js';
import type { WorkerNativeState } from './native-call.js';
import type { FromWorkerMessage, ToWorkerMessage } from './protocol.js';

// Diagnostic hook (#53): when `RIFT_FFI_DEBUG_TRACE` names a file, append each native symbol name
// synchronously *before* the FFI call is dispatched. `appendFileSync` flushes to the OS, so if the
// call segfaults, the file's last line names the crashing symbol. Inert unless the env var is set;
// never enabled in production.
const TRACE_FILE = process.env.RIFT_FFI_DEBUG_TRACE;
function traceCall(fn: string): void {
  if (TRACE_FILE) appendFileSync(TRACE_FILE, `${fn}\n`);
}

if (!parentPort) {
  throw new Error('src/embedded/worker.js must be run inside a worker_threads Worker');
}
const port = parentPort;

function post(msg: FromWorkerMessage): void {
  port.postMessage(msg);
}

let native: WorkerNativeState | null = null;

async function handleInit(libPath: string): Promise<void> {
  try {
    const { binding, decode } = await loadNativeBinding(libPath);
    traceCall('rift_build_info');
    const buildInfo = readBuildInfo(binding, decode);
    traceCall('rift_start');
    const handle = binding.rift_start();
    if (handle === null) {
      const { message } = readLastErrorMessage(binding, decode, 'rift_start');
      post({ type: 'init-error', message });
      return;
    }
    // Diagnostic hook (#53): `RIFT_FFI_DEBUG_NO_DECODE` neuters the PER-CALL decode only — leaving
    // init's build_info/last-error decode intact so init still succeeds — to isolate whether the
    // strlen SIGSEGV is in koffi.decode(char*) of a call RESULT vs argument marshalling. If the crash
    // disappears with this set, it is the result-decode path. Inert unless the env var is set.
    const callDecode = process.env.RIFT_FFI_DEBUG_NO_DECODE ? () => '' : decode;
    native = { binding, decode: callDecode, handle };
    post({ type: 'ready', buildInfo });
  } catch (err) {
    post({ type: 'init-error', message: err instanceof Error ? err.message : String(err) });
  }
}

function handleShutdown(): void {
  if (native) {
    try {
      native.binding.rift_stop(native.handle);
    } catch {
      // Best-effort: the process is exiting either way, and a failing rift_stop must not block
      // the worker from ever tearing down (that would defeat the facade's shutdown timeout).
    }
  }
  post({ type: 'shutdown-ack' });
  process.exit(0);
}

port.on('message', (raw: unknown) => {
  const msg = raw as ToWorkerMessage;
  switch (msg.type) {
    case 'init':
      void handleInit(msg.libPath);
      return;
    case 'call': {
      // handleCallMessage rejects pre-init calls, prepends the worker-local handle, and converts any
      // throw into an error result — so a bad call never escapes this handler and hangs the caller.
      traceCall(msg.fn);
      const response = handleCallMessage(native, { id: msg.id, fn: msg.fn, args: msg.args });
      post({ type: 'result', ...response });
      return;
    }
    case 'shutdown':
      handleShutdown();
      return;
    default: {
      const exhaustive: never = msg;
      throw new Error(`embedded worker: unhandled message ${JSON.stringify(exhaustive)}`);
    }
  }
});
