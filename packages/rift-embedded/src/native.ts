/**
 * `NativeEngine` — the embedded transport's main-thread facade (issue #8).
 *
 * Owns the worker_threads lifecycle and the request/response correlation on top of the protocol
 * in `protocol.ts`; the actual FFI discipline lives in `native-call.ts` and runs inside
 * `worker.ts`, not here. `load()` spawns the worker, sends `{type:'init', libPath}`, and awaits
 * `{type:'ready'}`/`{type:'init-error'}`. `close()` is idempotent, rejects in-flight calls with a
 * clear error, and force-`terminate()`s if the worker doesn't exit within the shutdown timeout.
 *
 * The worker transport is injectable (`createWorker`) precisely so this protocol is unit-testable
 * without spawning a real `worker_threads.Worker` — see `test/unit/embedded-worker.test.ts`.
 */

import { Worker } from 'worker_threads';
import { EngineUnavailable, NativeLibraryError, RiftError } from '@rift-vs/rift';
import type { NativeCallableFn } from './native-binding.js';
import type { FromWorkerMessage, ToWorkerMessage } from './protocol.js';

const SHUTDOWN_TIMEOUT_MS = 5000;

/** The subset of `worker_threads.Worker`'s surface `NativeEngine` depends on — small enough that
 * tests can satisfy it with a plain fake, and a real `Worker` satisfies it structurally as-is. */
export interface WorkerLike {
  postMessage(message: unknown): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
  off(event: string, listener: (...args: unknown[]) => void): void;
  terminate(): Promise<number>;
  unref(): void;
}

export interface NativeEngineLoadOptions {
  /** Injectable worker transport; defaults to a real `worker_threads.Worker` running `worker.js`. */
  createWorker?: () => WorkerLike;
}

function defaultCreateWorker(): WorkerLike {
  const url = new URL('./worker.js', import.meta.url);
  return new Worker(url) as unknown as WorkerLike;
}

interface PendingCall {
  fn: string;
  resolve(value: unknown): void;
  reject(err: unknown): void;
}

type EngineState = 'open' | 'closing' | 'closed';

export class NativeEngine {
  readonly buildInfo: string;

  #worker: WorkerLike;
  #nextId = 1;
  #pending = new Map<number, PendingCall>();
  #state: EngineState = 'open';
  #closePromise: Promise<void> | null = null;
  #exitHandler: (() => void) | null = null;

  private constructor(worker: WorkerLike, buildInfo: string) {
    this.#worker = worker;
    this.buildInfo = buildInfo;
    worker.on('message', (raw: unknown) => this.#onMessage(raw as FromWorkerMessage));
    worker.on('exit', () => this.#onUnexpectedExit());
    // A post-init uncaught throw in the worker emits 'error'; with NO listener, Node's default is to
    // rethrow on the main thread and crash the whole host process. Handle it: reject in-flight calls
    // and mark the engine dead, turning a native fault into a recoverable error, not a crash.
    worker.on('error', (err: unknown) => this.#onWorkerError(err));
    this.#exitHandler = () => {
      try {
        worker.postMessage({ type: 'shutdown' } satisfies ToWorkerMessage);
      } catch {
        // best-effort: the process is already tearing down.
      }
    };
    process.on('exit', this.#exitHandler);
  }

  /**
   * Spawns the worker, performs the init handshake, and resolves once it reports `ready`. Rejects
   * with a `NativeLibraryError` on `init-error` (koffi missing, cdylib missing/incompatible, ABI
   * v1), terminating the worker first so a failed load never leaks a thread.
   */
  static async load(libPath: string, opts: NativeEngineLoadOptions = {}): Promise<NativeEngine> {
    const createWorker = opts.createWorker ?? defaultCreateWorker;
    const worker = createWorker();

    const handshake = new Promise<{ buildInfo: string }>((resolve, reject) => {
      const onMessage = (raw: unknown): void => {
        const msg = raw as FromWorkerMessage;
        if (msg.type === 'ready') {
          cleanup();
          resolve({ buildInfo: msg.buildInfo });
        } else if (msg.type === 'init-error') {
          cleanup();
          reject(new NativeLibraryError(msg.message, { path: libPath }));
        }
      };
      const onError = (err: unknown): void => {
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      };
      const onExit = (): void => {
        cleanup();
        reject(new NativeLibraryError('embedded worker exited during init', { path: libPath }));
      };
      const cleanup = (): void => {
        worker.off('message', onMessage);
        worker.off('error', onError);
        worker.off('exit', onExit);
      };
      worker.on('message', onMessage);
      worker.on('error', onError);
      worker.on('exit', onExit);
    });

    worker.postMessage({ type: 'init', libPath } satisfies ToWorkerMessage);

    let ready: { buildInfo: string };
    try {
      ready = await handshake;
    } catch (err) {
      try {
        await worker.terminate();
      } catch {
        // best-effort cleanup of a worker that never finished initializing.
      }
      throw err;
    }

    const engine = new NativeEngine(worker, ready.buildInfo);
    worker.unref();
    return engine;
  }

  #onMessage(msg: FromWorkerMessage): void {
    if (msg.type !== 'result') return;
    const pending = this.#pending.get(msg.id);
    if (!pending) return; // late response for a call already rejected by close(), or unknown id.
    this.#pending.delete(msg.id);
    if (msg.ok) {
      pending.resolve(msg.value);
    } else {
      pending.reject(new RiftError(`${msg.error.fn}: ${msg.error.message}`));
    }
  }

  #onUnexpectedExit(): void {
    if (this.#state !== 'open') return; // exit is expected once close() is in progress.
    this.#state = 'closed';
    this.#rejectAllPending(new EngineUnavailable('embedded worker exited unexpectedly'));
    this.#unregisterExitHandler();
  }

  #onWorkerError(err: unknown): void {
    if (this.#state === 'closed') return; // a crash during/after close is moot.
    this.#state = 'closed';
    this.#rejectAllPending(
      new EngineUnavailable(`embedded worker crashed: ${err instanceof Error ? err.message : String(err)}`)
    );
    this.#unregisterExitHandler();
  }

  #rejectAllPending(err: Error): void {
    for (const pending of this.#pending.values()) pending.reject(err);
    this.#pending.clear();
  }

  #unregisterExitHandler(): void {
    if (this.#exitHandler) {
      process.off('exit', this.#exitHandler);
      this.#exitHandler = null;
    }
  }

  #call<T>(fn: NativeCallableFn, args: unknown[]): Promise<T> {
    if (this.#state !== 'open') {
      return Promise.reject(new EngineUnavailable(`NativeEngine is ${this.#state}; cannot call ${fn}`));
    }
    const id = this.#nextId++;
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { fn, resolve: resolve as (v: unknown) => void, reject });
      this.#worker.postMessage({ type: 'call', id, fn, args } satisfies ToWorkerMessage);
    });
  }

  /**
   * Idempotent: a second `close()` returns the same in-flight/completed close. Rejects every
   * currently-pending call with a clear "closing" error (never lets one dangle waiting on a
   * response that a shutting-down worker may never send), then asks the worker to stop gracefully;
   * if it hasn't exited within {@link SHUTDOWN_TIMEOUT_MS}, force-`terminate()`s it.
   */
  close(): Promise<void> {
    if (this.#state === 'closed') return Promise.resolve();
    if (this.#closePromise) return this.#closePromise;

    this.#state = 'closing';
    this.#rejectAllPending(new EngineUnavailable('NativeEngine is closing'));
    this.#closePromise = this.#doClose();
    return this.#closePromise;
  }

  async #doClose(): Promise<void> {
    const exited = new Promise<void>((resolve) => {
      const onExit = (): void => {
        this.#worker.off('exit', onExit);
        resolve();
      };
      this.#worker.on('exit', onExit);
    });

    try {
      this.#worker.postMessage({ type: 'shutdown' } satisfies ToWorkerMessage);
    } catch {
      // worker channel already gone (e.g. it crashed) — fall through to the timeout/terminate path.
    }

    const TIMED_OUT = Symbol('shutdown-timeout');
    // An explicit, clearable timer — a bare `sleep().then()` would leak a live 5s timer on the
    // (common) fast-close path where `exited` wins the race, delaying host process exit.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), SHUTDOWN_TIMEOUT_MS);
    });
    try {
      const outcome = await Promise.race([exited.then(() => 'exited' as const), timeout]);
      if (outcome === TIMED_OUT) {
        try {
          await this.#worker.terminate();
        } catch (err) {
          // Nothing more we can do, but don't claim a clean close silently: the worker thread may
          // still be alive (unref'd, so it won't hold the process open, but a native handle leaks).
          console.error(`rift: embedded worker did not terminate cleanly: ${String(err)}`);
        }
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }

    this.#state = 'closed';
    this.#unregisterExitHandler();
  }

  createImposter(json: string): Promise<number> {
    return this.#call<number>('rift_create_imposter', [json]);
  }

  replaceStubs(port: number, json: string): Promise<number> {
    return this.#call<number>('rift_replace_stubs', [port, json]);
  }

  deleteImposter(port: number): Promise<number> {
    return this.#call<number>('rift_delete_imposter', [port]);
  }

  deleteAll(): Promise<number> {
    return this.#call<number>('rift_delete_all', []);
  }

  applyConfig(json: string): Promise<string> {
    return this.#call<string>('rift_apply_config', [json]);
  }

  recorded(port: number): Promise<string> {
    return this.#call<string>('rift_recorded', [port]);
  }

  stubWarnings(port: number): Promise<string> {
    return this.#call<string>('rift_stub_warnings', [port]);
  }

  /** `found: false` means the key simply isn't set — NOT an error; `rift_flow_state_get` always
   * succeeds structurally (a real failure, e.g. an unknown port, still goes through the sentinel
   * path and rejects). */
  async flowStateGet(port: number, flowId: string, key: string): Promise<{ found: boolean; value?: unknown }> {
    const raw = await this.#call<string>('rift_flow_state_get', [port, flowId, key]);
    return JSON.parse(raw) as { found: boolean; value?: unknown };
  }

  flowStatePut(port: number, flowId: string, key: string, valueJson: string): Promise<number> {
    return this.#call<number>('rift_flow_state_put', [port, flowId, key, valueJson]);
  }

  flowStateDelete(port: number, flowId: string, key: string): Promise<number> {
    return this.#call<number>('rift_flow_state_delete', [port, flowId, key]);
  }

  spaceAddStub(port: number, flowId: string, json: string): Promise<number> {
    return this.#call<number>('rift_space_add_stub', [port, flowId, json]);
  }

  spaceListStubs(port: number, flowId: string): Promise<string> {
    return this.#call<string>('rift_space_list_stubs', [port, flowId]);
  }

  spaceDelete(port: number, flowId: string): Promise<number> {
    return this.#call<number>('rift_space_delete', [port, flowId]);
  }

  spaceRecorded(port: number, flowId: string): Promise<string> {
    return this.#call<string>('rift_space_recorded', [port, flowId]);
  }

  async startIntercept(optionsJson: string): Promise<Record<string, unknown>> {
    const raw = await this.#call<string>('rift_start_intercept', [optionsJson]);
    return JSON.parse(raw) as Record<string, unknown>;
  }

  interceptAddRules(json: string): Promise<number> {
    return this.#call<number>('rift_intercept_add_rules', [json]);
  }

  interceptClearRules(): Promise<number> {
    return this.#call<number>('rift_intercept_clear_rules', []);
  }

  interceptListRules(): Promise<string> {
    return this.#call<string>('rift_intercept_list_rules', []);
  }

  interceptCaPem(): Promise<string> {
    return this.#call<string>('rift_intercept_ca_pem', []);
  }

  interceptExportTruststore(format: string, password: string, outPath: string): Promise<number> {
    return this.#call<number>('rift_intercept_export_truststore', [format, password, outPath]);
  }

  async serveAdmin(optionsJson: string): Promise<Record<string, unknown>> {
    const raw = await this.#call<string>('rift_serve_admin', [optionsJson]);
    return JSON.parse(raw) as Record<string, unknown>;
  }
}
