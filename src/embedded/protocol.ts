/**
 * Message protocol between `native.ts` (the main-thread `NativeEngine` facade) and `worker.ts`
 * (the worker_threads-side thin wrapper). Kept as plain, structurally-clonable data — no class
 * instances, no pointers — since it crosses the worker `postMessage` boundary.
 */

import type { NativeCallableFn } from './native-binding.js';
import type { NativeCallResponse } from './native-call.js';

export type ToWorkerMessage =
  | { type: 'init'; libPath: string }
  | { type: 'call'; id: number; fn: NativeCallableFn; args: unknown[] }
  | { type: 'shutdown' };

export type FromWorkerMessage =
  | { type: 'ready'; buildInfo: string }
  | { type: 'init-error'; message: string }
  | ({ type: 'result' } & NativeCallResponse)
  | { type: 'shutdown-ack' };
