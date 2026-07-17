/**
 * Gate for issue #8 — the embedded transport's FFI call discipline + worker-facade protocol.
 *
 * Everything here runs against a FAKE `NativeBinding` (no koffi, no cdylib, no real
 * `worker_threads.Worker`) so it's CI-green on every platform, including one where koffi isn't
 * installed. `handleCall` is exercised directly (it's pure — see native-call.ts); the
 * `NativeEngine` facade is exercised through an injected fake worker transport that satisfies the
 * same message protocol a real Worker would.
 */

import { jest } from '@jest/globals';
import {
  handleCall,
  handleCallMessage,
  readBuildInfo,
  readLastErrorMessage,
} from '../src/native-call.js';
import type {
  Decode,
  NativeCallRequest,
  NativeCallResponse,
  WorkerNativeState,
} from '../src/native-call.js';
import { RETURN_KIND } from '../src/native-binding.js';
import type { NativeBinding, NativeCallableFn } from '../src/native-binding.js';
import { v1AbiMessage, loadFailureMessage } from '../src/ffi.js';
import { NativeEngine } from '../src/native.js';
import type { WorkerLike } from '../src/native.js';
import type { FromWorkerMessage, ToWorkerMessage } from '../src/protocol.js';

// -------------------------------------------------------------------------------------------
// Fake NativeBinding — every char*-shaped pointer is a small identity-distinct wrapper object so
// tests can assert exactly which pointer got freed, rather than comparing decoded strings.
// -------------------------------------------------------------------------------------------

interface FakePtr {
  readonly __fakePtr: string;
}

function ptr(value: string): FakePtr {
  return { __fakePtr: value };
}

const decode: Decode = (p) => (p as FakePtr).__fakePtr;

interface FakeBinding {
  binding: NativeBinding;
  calls: Array<{ fn: string; args: unknown[] }>;
  freedPtrs: FakePtr[];
  buildInfoPtr: FakePtr;
  queueResult(fn: NativeCallableFn, value: unknown): void;
  setLastError(message: string | null): void;
}

function createFakeBinding(buildInfo = 'rift 0.12.0 (librift_ffi abi v2)'): FakeBinding {
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  const freedPtrs: FakePtr[] = [];
  const results = new Map<string, unknown[]>();
  let lastError: string | null = null;
  const buildInfoPtr = ptr(buildInfo);

  function queueResult(fn: NativeCallableFn, value: unknown): void {
    const q = results.get(fn) ?? [];
    q.push(value);
    results.set(fn, q);
  }

  function nextResult(fn: string): unknown {
    const q = results.get(fn);
    if (!q || q.length === 0) {
      throw new Error(`fake binding: no queued result for ${fn} — call queueResult() first`);
    }
    return q.shift();
  }

  const raw: Record<string, (...args: unknown[]) => unknown> = {};
  for (const fn of Object.keys(RETURN_KIND) as NativeCallableFn[]) {
    raw[fn] = (...args: unknown[]) => {
      calls.push({ fn, args });
      return nextResult(fn);
    };
  }
  raw.rift_start = (...args: unknown[]) => {
    calls.push({ fn: 'rift_start', args });
    return ptr('handle-1');
  };
  raw.rift_last_error = (...args: unknown[]) => {
    calls.push({ fn: 'rift_last_error', args });
    const e = lastError;
    lastError = null;
    return e === null ? null : ptr(e);
  };
  raw.rift_free = (...args: unknown[]) => {
    calls.push({ fn: 'rift_free', args });
    freedPtrs.push(args[0] as FakePtr);
  };
  raw.rift_build_info = (...args: unknown[]) => {
    calls.push({ fn: 'rift_build_info', args });
    return buildInfoPtr;
  };

  return {
    binding: raw as unknown as NativeBinding,
    calls,
    freedPtrs,
    buildInfoPtr,
    queueResult,
    setLastError: (m: string | null) => {
      lastError = m;
    },
  };
}

function req(id: number, fn: NativeCallableFn, args: unknown[]): NativeCallRequest {
  return { id, fn, args };
}

// -------------------------------------------------------------------------------------------
// handleCall discipline
// -------------------------------------------------------------------------------------------

describe('handleCall — success paths', () => {
  it('char*-returning fn: decodes then frees exactly once', () => {
    const fake = createFakeBinding();
    fake.queueResult('rift_recorded', ptr('[{"method":"GET"}]'));
    const resp = handleCall(fake.binding, req(1, 'rift_recorded', ['h', 5000]), decode);
    expect(resp).toEqual({ id: 1, ok: true, value: '[{"method":"GET"}]' });
    expect(fake.freedPtrs).toHaveLength(1);
    expect(fake.freedPtrs[0]?.__fakePtr).toBe('[{"method":"GET"}]');
    expect(fake.calls.some((c) => c.fn === 'rift_last_error')).toBe(false);
  });

  it('int32-returning fn: passes the number through untouched, no free, no last_error read', () => {
    const fake = createFakeBinding();
    fake.queueResult('rift_delete_all', 3);
    const resp = handleCall(fake.binding, req(2, 'rift_delete_all', ['h']), decode);
    expect(resp).toEqual({ id: 2, ok: true, value: 3 });
    expect(fake.freedPtrs).toHaveLength(0);
    expect(fake.calls.some((c) => c.fn === 'rift_last_error')).toBe(false);
  });

  it('uint16-returning fn (rift_create_imposter): a real port passes through as success', () => {
    const fake = createFakeBinding();
    fake.queueResult('rift_create_imposter', 4545);
    const resp = handleCall(fake.binding, req(3, 'rift_create_imposter', ['h', '{}']), decode);
    expect(resp).toEqual({ id: 3, ok: true, value: 4545 });
  });

  it('void-returning fn (rift_stop): always succeeds with value:null', () => {
    const fake = createFakeBinding();
    fake.queueResult('rift_stop', undefined);
    const resp = handleCall(fake.binding, req(4, 'rift_stop', ['h']), decode);
    expect(resp).toEqual({ id: 4, ok: true, value: null });
  });
});

describe('handleCall — sentinel + populated last_error', () => {
  it('int32 sentinel (-1): reads+frees the diagnostic exactly once', () => {
    const fake = createFakeBinding();
    fake.queueResult('rift_delete_imposter', -1);
    fake.setLastError('no imposter listening on port 9999');
    const resp = handleCall(fake.binding, req(5, 'rift_delete_imposter', ['h', 9999]), decode);
    expect(resp).toEqual({
      id: 5,
      ok: false,
      error: { message: 'no imposter listening on port 9999', fn: 'rift_delete_imposter' },
    });
    expect(fake.calls.filter((c) => c.fn === 'rift_last_error')).toHaveLength(1);
    expect(fake.freedPtrs).toHaveLength(1);
    expect(fake.freedPtrs[0]?.__fakePtr).toBe('no imposter listening on port 9999');
  });

  it('uint16 sentinel (0): same discipline as int32', () => {
    const fake = createFakeBinding();
    fake.queueResult('rift_create_imposter', 0);
    fake.setLastError('malformed imposter JSON: missing "protocol"');
    const resp = handleCall(fake.binding, req(6, 'rift_create_imposter', ['h', 'bad json']), decode);
    expect(resp.ok).toBe(false);
    expect((resp as { error: { message: string } }).error.message).toBe(
      'malformed imposter JSON: missing "protocol"'
    );
  });

  it('string sentinel (NULL): same discipline', () => {
    const fake = createFakeBinding();
    fake.queueResult('rift_apply_config', null);
    fake.setLastError('config JSON failed schema validation');
    const resp = handleCall(fake.binding, req(7, 'rift_apply_config', ['h', '{}']), decode);
    expect(resp).toEqual({
      id: 7,
      ok: false,
      error: { message: 'config JSON failed schema validation', fn: 'rift_apply_config' },
    });
  });
});

describe('handleCall — sentinel + empty last_error slot', () => {
  it('falls back to a generic, fn-named message; still exactly one last_error read', () => {
    const fake = createFakeBinding();
    fake.queueResult('rift_delete_imposter', -1);
    fake.setLastError(null);
    const resp = handleCall(fake.binding, req(8, 'rift_delete_imposter', ['h', 1]), decode);
    expect(resp).toEqual({
      id: 8,
      ok: false,
      error: { message: 'rift_delete_imposter failed with no engine diagnostic', fn: 'rift_delete_imposter' },
    });
    expect(fake.calls.filter((c) => c.fn === 'rift_last_error')).toHaveLength(1);
    // the empty slot itself decodes to nothing — nothing was allocated, so nothing is freed.
    expect(fake.freedPtrs).toHaveLength(0);
  });
});

describe('rift_build_info — never goes through the sentinel path, never freed', () => {
  it('readBuildInfo decodes the static pointer without calling last_error or free', () => {
    const fake = createFakeBinding('rift 0.12.0 (librift_ffi abi v2)');
    const info = readBuildInfo(fake.binding, decode);
    expect(info).toBe('rift 0.12.0 (librift_ffi abi v2)');
    expect(fake.calls.some((c) => c.fn === 'rift_last_error')).toBe(false);
    expect(fake.freedPtrs).toHaveLength(0);
    expect(fake.freedPtrs).not.toContainEqual(fake.buildInfoPtr);
  });

  it('build_info pointer is never freed even if handleCall-style cleanup runs elsewhere in the same test', () => {
    const fake = createFakeBinding();
    readBuildInfo(fake.binding, decode);
    fake.queueResult('rift_recorded', ptr('[]'));
    handleCall(fake.binding, req(9, 'rift_recorded', ['h', 1]), decode);
    expect(fake.freedPtrs).not.toContainEqual(fake.buildInfoPtr);
  });
});

describe('handleCall — FIFO / serialization: each call gets its own error, in order', () => {
  it('processes a mixed sequence in order; no cross-contamination between calls', () => {
    const fake = createFakeBinding();

    fake.queueResult('rift_delete_imposter', -1);
    fake.setLastError('err-A: bad port');
    const a = handleCall(fake.binding, req(1, 'rift_delete_imposter', ['h', 1]), decode);

    fake.queueResult('rift_space_delete', 0);
    const b = handleCall(fake.binding, req(2, 'rift_space_delete', ['h', 2, 'flow']), decode);

    fake.queueResult('rift_replace_stubs', -1);
    fake.setLastError('err-C: invalid stub schema');
    const c = handleCall(fake.binding, req(3, 'rift_replace_stubs', ['h', 3, '{}']), decode);

    fake.queueResult('rift_recorded', ptr('[{"ok":true}]'));
    const d = handleCall(fake.binding, req(4, 'rift_recorded', ['h', 4]), decode);

    const results: NativeCallResponse[] = [a, b, c, d];
    expect(results.map((r) => r.id)).toEqual([1, 2, 3, 4]);

    expect(a).toEqual({ id: 1, ok: false, error: { message: 'err-A: bad port', fn: 'rift_delete_imposter' } });
    expect(b).toEqual({ id: 2, ok: true, value: 0 });
    expect(c).toEqual({ id: 3, ok: false, error: { message: 'err-C: invalid stub schema', fn: 'rift_replace_stubs' } });
    expect(d).toEqual({ id: 4, ok: true, value: '[{"ok":true}]' });

    // last_error was read exactly twice (calls a and c) — never for the successful b/d.
    expect(fake.calls.filter((call) => call.fn === 'rift_last_error')).toHaveLength(2);
    // each freed diagnostic/string is distinct — no reuse/leak across calls.
    const freedValues = fake.freedPtrs.map((p) => p.__fakePtr);
    expect(freedValues).toEqual(['err-A: bad port', 'err-C: invalid stub schema', '[{"ok":true}]']);
  });
});

describe('readLastErrorMessage — reusable by both handleCall and worker init (rift_start failure)', () => {
  it('is the same discipline handleCall uses internally', () => {
    const fake = createFakeBinding();
    fake.setLastError('engine failed to bind admin listener');
    const err = readLastErrorMessage(fake.binding, decode, 'rift_start');
    expect(err).toEqual({ message: 'engine failed to bind admin listener', fn: 'rift_start' });
    expect(fake.freedPtrs).toHaveLength(1);
  });

  it('empty slot -> generic message, same as the handleCall path', () => {
    const fake = createFakeBinding();
    fake.setLastError(null);
    const err = readLastErrorMessage(fake.binding, decode, 'rift_start');
    expect(err.message).toBe('rift_start failed with no engine diagnostic');
  });
});

// -------------------------------------------------------------------------------------------
// ffi.ts — pure init-error message construction (no koffi import required to exercise these)
// -------------------------------------------------------------------------------------------

describe('ffi.ts — init-error message construction (pure)', () => {
  it('v1AbiMessage names the path and the required minimum engine version', () => {
    const msg = v1AbiMessage('/opt/rift/librift_ffi.dylib', '0.12.0');
    expect(msg).toBe('ABI v1 library at /opt/rift/librift_ffi.dylib — rift-node requires C-ABI v2 (rift >= 0.12.0)');
  });

  it('loadFailureMessage carries the path and the precise underlying cause', () => {
    const cause = new Error('dlopen(/missing/librift_ffi.so): file not found');
    const msg = loadFailureMessage('/missing/librift_ffi.so', cause);
    expect(msg).toContain('/missing/librift_ffi.so');
    expect(msg).toContain('file not found');
  });

  it('loadFailureMessage tolerates a non-Error cause', () => {
    const msg = loadFailureMessage('/missing/lib.so', 'boom');
    expect(msg).toContain('boom');
  });
});

// -------------------------------------------------------------------------------------------
// NativeEngine facade protocol — driven entirely through a FAKE worker transport (no real
// worker_threads.Worker is ever constructed in this file).
// -------------------------------------------------------------------------------------------

type Listener = (...args: unknown[]) => void;

class FakeWorker implements WorkerLike {
  posted: unknown[] = [];
  terminateCalls = 0;
  #listeners = new Map<string, Listener[]>();

  postMessage(message: unknown): void {
    this.posted.push(message);
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

  unref(): void {
    // no-op: nothing to unref on a fake.
  }

  async terminate(): Promise<number> {
    this.terminateCalls += 1;
    this.emit('exit', 1);
    return 1;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.#listeners.get(event) ?? []) listener(...args);
  }

  lastPosted(): unknown {
    return this.posted[this.posted.length - 1];
  }
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function readyEngine(worker: FakeWorker, buildInfo = 'rift 0.12.0 (abi v2)'): Promise<NativeEngine> {
  const enginePromise = NativeEngine.load('/fake/librift_ffi.dylib', { createWorker: () => worker });
  await flush();
  const initMsg = worker.posted[0] as ToWorkerMessage;
  expect(initMsg).toEqual({ type: 'init', libPath: '/fake/librift_ffi.dylib' });
  worker.emit('message', { type: 'ready', buildInfo } satisfies FromWorkerMessage);
  return enginePromise;
}

describe('NativeEngine.load — handshake over a fake worker transport', () => {
  it('posts init, resolves on ready with the reported buildInfo', async () => {
    const worker = new FakeWorker();
    const engine = await readyEngine(worker, 'rift 0.12.0 (librift_ffi abi v2)');
    expect(engine.buildInfo).toBe('rift 0.12.0 (librift_ffi abi v2)');
    const closePromise = engine.close();
    worker.emit('exit', 0);
    await closePromise;
  });

  it('rejects with the worker-reported message on init-error', async () => {
    const worker = new FakeWorker();
    const enginePromise = NativeEngine.load('/x/librift_ffi.so', { createWorker: () => worker });
    await flush();
    worker.emit('message', {
      type: 'init-error',
      message: 'ABI v1 library at /x/librift_ffi.so — rift-node requires C-ABI v2 (rift >= 0.12.0)',
    } satisfies FromWorkerMessage);
    await expect(enginePromise).rejects.toThrow(/ABI v1 library/);
  });
});

describe('NativeEngine — close() idempotency, double-close, in-flight rejection', () => {
  it('close() posts shutdown once; a second close() does not re-post', async () => {
    const worker = new FakeWorker();
    const engine = await readyEngine(worker);

    const close1 = engine.close();
    await flush();
    worker.emit('exit', 0);
    await close1;

    const shutdowns = worker.posted.filter((m) => (m as ToWorkerMessage).type === 'shutdown');
    expect(shutdowns).toHaveLength(1);

    await expect(engine.close()).resolves.toBeUndefined();
    const shutdownsAfterSecondClose = worker.posted.filter((m) => (m as ToWorkerMessage).type === 'shutdown');
    expect(shutdownsAfterSecondClose).toHaveLength(1);
  });

  it('rejects in-flight calls with a clear error when close() runs concurrently', async () => {
    const worker = new FakeWorker();
    const engine = await readyEngine(worker);

    const inFlight = engine.deleteAll();
    await flush();

    const closePromise = engine.close();
    await expect(inFlight).rejects.toThrow(/clos/i);

    worker.emit('exit', 0);
    await closePromise;
  });

  it('a call made after close() rejects immediately without posting a message', async () => {
    const worker = new FakeWorker();
    const engine = await readyEngine(worker);
    const closePromise = engine.close();
    worker.emit('exit', 0);
    await closePromise;

    const postedBefore = worker.posted.length;
    await expect(engine.deleteAll()).rejects.toThrow();
    expect(worker.posted.length).toBe(postedBefore);
  });

  it('force-terminates after the shutdown timeout if the worker never exits', async () => {
    jest.useFakeTimers();
    try {
      const worker = new FakeWorker();
      const enginePromise = NativeEngine.load('/fake/lib', { createWorker: () => worker });
      await Promise.resolve();
      worker.emit('message', { type: 'ready', buildInfo: 'x' } satisfies FromWorkerMessage);
      const engine = await enginePromise;

      const closePromise = engine.close();
      await Promise.resolve();
      expect(worker.terminateCalls).toBe(0);

      await jest.advanceTimersByTimeAsync(6000);
      await closePromise;

      expect(worker.terminateCalls).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('NativeEngine — a call resolves/rejects by matching id, not send order', () => {
  it('resolves a later-sent call before an earlier one without cross-wiring results', async () => {
    const worker = new FakeWorker();
    const engine = await readyEngine(worker);

    const first = engine.recorded(1000);
    const second = engine.deleteAll();
    await flush();

    const firstMsg = worker.posted.find((m) => (m as { fn?: string }).fn === 'rift_recorded') as {
      id: number;
    };
    const secondMsg = worker.posted.find((m) => (m as { fn?: string }).fn === 'rift_delete_all') as {
      id: number;
    };
    expect(firstMsg.id).not.toBe(secondMsg.id);

    // Answer out of order: second call's result arrives first.
    worker.emit('message', { type: 'result', id: secondMsg.id, ok: true, value: 2 } satisfies FromWorkerMessage);
    await expect(second).resolves.toBe(2);

    worker.emit('message', {
      type: 'result',
      id: firstMsg.id,
      ok: false,
      error: { message: 'no imposter on port 1000', fn: 'rift_recorded' },
    } satisfies FromWorkerMessage);
    await expect(first).rejects.toThrow(/no imposter on port 1000/);

    const closePromise = engine.close();
    worker.emit('exit', 0);
    await closePromise;
  });
});

// -------------------------------------------------------------------------------------------
// handleCallMessage — worker call dispatch (pre-init reject, handle prepend, throw → error result)
// -------------------------------------------------------------------------------------------

describe('handleCallMessage — worker dispatch', () => {
  function stateOf(fb: ReturnType<typeof createFakeBinding>): WorkerNativeState {
    return { binding: fb.binding, decode, handle: ptr('handle-1') };
  }

  it('a call before init (native === null) is rejected, never invoked', () => {
    const resp = handleCallMessage(null, req(7, 'rift_recorded', [4545]));
    expect(resp).toEqual({
      id: 7,
      ok: false,
      error: { message: 'embedded worker received a call before init completed', fn: 'rift_recorded' },
    });
  });

  it('prepends the worker-local handle to the native call args', () => {
    const fb = createFakeBinding();
    fb.queueResult('rift_recorded', ptr('[]'));
    handleCallMessage(stateOf(fb), req(1, 'rift_recorded', [4545]));
    const call = fb.calls.find((c) => c.fn === 'rift_recorded');
    expect(call?.args[0]).toEqual(ptr('handle-1')); // handle first
    expect(call?.args[1]).toBe(4545); // then the caller's args
  });

  it('converts a THROW from the native call into an error result carrying the id (no hang/crash)', () => {
    const fb = createFakeBinding();
    // Make the native call throw (e.g. a koffi arg/type mismatch) instead of returning a sentinel.
    (fb.binding as unknown as Record<string, () => unknown>).rift_recorded = () => {
      throw new Error('koffi: unexpected argument type');
    };
    const resp = handleCallMessage(stateOf(fb), req(9, 'rift_recorded', [4545]));
    expect(resp).toEqual({
      id: 9,
      ok: false,
      error: { message: 'koffi: unexpected argument type', fn: 'rift_recorded' },
    });
  });
});

// -------------------------------------------------------------------------------------------
// NativeEngine — worker fault handling (unexpected exit / uncaught error reject pending)
// -------------------------------------------------------------------------------------------

describe('NativeEngine — worker fault rejects in-flight calls', () => {
  it('an unexpected worker exit rejects pending calls with EngineUnavailable', async () => {
    const worker = new FakeWorker();
    const engine = await readyEngine(worker);
    const inflight = engine.createImposter('{}');
    worker.emit('exit', 1); // crash, not via close()
    await expect(inflight).rejects.toThrow(/exited unexpectedly/);
    // subsequent calls also reject (engine is dead)
    await expect(engine.createImposter('{}')).rejects.toThrow(/closed/);
  });

  it("a worker 'error' event rejects pending calls instead of crashing the host", async () => {
    const worker = new FakeWorker();
    const engine = await readyEngine(worker);
    const inflight = engine.createImposter('{}');
    worker.emit('error', new Error('worker thread blew up'));
    await expect(inflight).rejects.toThrow(/worker crashed: worker thread blew up/);
  });
});
