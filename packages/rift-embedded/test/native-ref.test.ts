/**
 * Gate for #70 — event-loop retention. An in-flight FFI call must hold the process alive
 * (`worker.ref()` while the pending map is non-empty), an idle engine must not (`unref()` when it
 * empties — the pre-existing ergonomic), and `keepAlive: true` must pin the worker ref'd for the
 * standalone mock-server shape. Verified against a scripted fake worker that counts ref/unref.
 */
import { NativeEngine } from '../src/native.js';
import type { WorkerLike } from '../src/native.js';

type Listener = (...args: unknown[]) => void;

class RefCountingWorker implements WorkerLike {
  posted: Array<Record<string, unknown>> = [];
  refCalls = 0;
  unrefCalls = 0;
  #listeners = new Map<string, Listener[]>();

  postMessage(message: unknown): void {
    const msg = message as Record<string, unknown>;
    this.posted.push(msg);
    if (msg['type'] === 'init') {
      queueMicrotask(() => this.emit('message', { type: 'ready', buildInfo: '{"version":"9.9.9"}' }));
    }
    if (msg['type'] === 'shutdown') {
      queueMicrotask(() => {
        this.emit('message', { type: 'shutdown-ack' });
        this.emit('exit', 0);
      });
    }
  }

  /** Settles the pending call with the given id (success, numeric result). */
  respond(id: number): void {
    this.emit('message', { type: 'result', id, ok: true, value: 0 });
  }

  /** Settles the pending call with an engine-error result (`ok: false`). */
  respondError(id: number): void {
    this.emit('message', { type: 'result', id, ok: false, error: { fn: 'rift_delete_all', message: 'boom' } });
  }

  lastCallId(): number {
    const calls = this.posted.filter((m) => m['type'] === 'call');
    return (calls[calls.length - 1] as { id: number }).id;
  }

  on(event: string, listener: Listener): void {
    const list = this.#listeners.get(event) ?? [];
    list.push(listener);
    this.#listeners.set(event, list);
  }

  off(event: string, listener: Listener): void {
    const list = this.#listeners.get(event);
    if (!list) return;
    this.#listeners.set(
      event,
      list.filter((l) => l !== listener)
    );
  }

  ref(): void {
    this.refCalls += 1;
  }

  unref(): void {
    this.unrefCalls += 1;
  }

  async terminate(): Promise<number> {
    this.emit('exit', 1);
    return 1;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const l of this.#listeners.get(event) ?? []) l(...args);
  }
}

async function loadWith(worker: RefCountingWorker, keepAlive?: boolean): Promise<NativeEngine> {
  return NativeEngine.load('/fake/librift_ffi.dylib', { createWorker: () => worker, keepAlive });
}

describe('#70 — worker ref lifecycle', () => {
  it('an idle engine is unref’d after load (idle-exit ergonomic preserved)', async () => {
    const worker = new RefCountingWorker();
    await loadWith(worker);
    expect(worker.unrefCalls).toBe(1);
    expect(worker.refCalls).toBe(0);
  });

  it('a pending call refs the worker; settling the last call unrefs it', async () => {
    const worker = new RefCountingWorker();
    const engine = await loadWith(worker);
    const call = engine.deleteAll();
    expect(worker.refCalls).toBe(1);
    expect(worker.unrefCalls).toBe(1); // still just the post-load unref
    worker.respond(worker.lastCallId());
    await call;
    expect(worker.unrefCalls).toBe(2);
  });

  it('overlapping calls hold a single ref until the LAST one settles', async () => {
    const worker = new RefCountingWorker();
    const engine = await loadWith(worker);
    const first = engine.deleteAll();
    const firstId = worker.lastCallId();
    const second = engine.deleteAll();
    expect(worker.refCalls).toBe(1); // no double-ref for the second in-flight call
    worker.respond(firstId);
    await first;
    expect(worker.unrefCalls).toBe(1); // one still pending — must NOT unref yet
    worker.respond(worker.lastCallId());
    await second;
    expect(worker.unrefCalls).toBe(2);
  });

  it('keepAlive: true pins the worker ref’d through ready and idle (standalone-server shape)', async () => {
    const worker = new RefCountingWorker();
    const engine = await loadWith(worker, true);
    expect(worker.unrefCalls).toBe(0); // no post-load unref
    const call = engine.deleteAll();
    worker.respond(worker.lastCallId());
    await call;
    expect(worker.unrefCalls).toBe(0); // idle again, still pinned
  });

  it('re-refs on the NEXT call after going idle (1→0→1 cycle, not a one-shot latch)', async () => {
    const worker = new RefCountingWorker();
    const engine = await loadWith(worker);
    const first = engine.deleteAll();
    worker.respond(worker.lastCallId());
    await first;
    expect(worker.refCalls).toBe(1);
    expect(worker.unrefCalls).toBe(2);
    const second = engine.deleteAll();
    expect(worker.refCalls).toBe(2); // idle→busy again MUST re-ref
    worker.respond(worker.lastCallId());
    await second;
    expect(worker.unrefCalls).toBe(3);
  });

  it('an error result (ok: false) still releases the ref (unref is outcome-independent)', async () => {
    const worker = new RefCountingWorker();
    const engine = await loadWith(worker);
    const call = engine.deleteAll();
    worker.respondError(worker.lastCallId());
    await expect(call).rejects.toThrow(/boom/);
    expect(worker.unrefCalls).toBe(2); // post-load + post-drain, despite the failure outcome
    const next = engine.deleteAll();
    expect(worker.refCalls).toBe(2); // and the engine is still usable + re-refs
    worker.respond(worker.lastCallId());
    await next;
  });

  it('worker exit mid-call rejects the call and releases the ref state without throwing', async () => {
    const worker = new RefCountingWorker();
    const engine = await loadWith(worker);
    const call = engine.deleteAll();
    expect(worker.refCalls).toBe(1);
    worker.emit('exit', 1);
    await expect(call).rejects.toThrow(/exited/i);
    expect(worker.unrefCalls).toBe(2); // post-load + pending-drained
  });
});
