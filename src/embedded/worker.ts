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

import { parentPort } from 'worker_threads';
import { loadNativeBinding } from './ffi.js';
import { handleCallMessage, readBuildInfo, readLastErrorMessage } from './native-call.js';
import type { WorkerNativeState } from './native-call.js';
import type { FromWorkerMessage, ToWorkerMessage } from './protocol.js';

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
    const buildInfo = readBuildInfo(binding, decode);
    const handle = binding.rift_start();
    if (handle === null) {
      const { message } = readLastErrorMessage(binding, decode, 'rift_start');
      post({ type: 'init-error', message });
      return;
    }
    native = { binding, decode, handle };
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
