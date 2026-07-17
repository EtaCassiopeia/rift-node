/**
 * Gates for the compat `create()` layer:
 * - issue #25 AC2b — the readiness poll runs on `fetch` and treats ANY HTTP response (including an
 *   error status) as "server up", retrying only on a transport rejection.
 * - issue #28 — a spawn failure rejects `create()` catchably (never an uncaught throw inside the
 *   child's `'error'` listener), post-startup child errors reach `server.on('error', …)`, and a
 *   clean early exit (code 0) rejects promptly instead of waiting out the startup timeout.
 */

import { EventEmitter } from 'events';
import type { ChildProcess, spawn as spawnProcess } from 'child_process';
import { jest } from '@jest/globals';
import { create, waitForServer, type CreateDeps } from '../../src/compat/index.js';

describe('issue #25 — compat waitForServer (fetch-based poll)', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('AC2b: an error-status HTTP response counts as ready (resolves)', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ status: 503 } as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(waitForServer('localhost', 12345, 5000)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('AC2b: retries on transport rejection, then resolves once a response arrives', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValue({ status: 200 } as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(waitForServer('localhost', 12345, 5000)).resolves.toBeUndefined();
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('AC2b: rejects when the server never responds within the timeout', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(waitForServer('localhost', 12345, 250)).rejects.toThrow(/did not start/);
  });
});

describe('issue #28 — create() spawn-failure and child-error delivery', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  type FakeChild = EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: jest.Mock;
  };

  function fakeChildDeps(): { child: FakeChild; deps: CreateDeps } {
    const child: FakeChild = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: jest.fn(() => true),
    });
    const deps: CreateDeps = {
      spawn: (() => child as unknown as ChildProcess) as unknown as typeof spawnProcess,
      resolveEngineBinary: async () => '/fake/rift-binary',
    };
    return { child, deps };
  }

  function serverNeverUp(): void {
    globalThis.fetch = jest
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
  }

  function serverUpImmediately(): void {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue({ status: 200 } as Response) as unknown as typeof fetch;
  }

  it("AC1: spawn failure rejects create() instead of crashing the host", async () => {
    serverNeverUp();
    const { child, deps } = fakeChildDeps();

    const pending = create({ port: 45700 }, deps);
    setImmediate(() => child.emit('error', new Error('spawn ENOENT')));

    await expect(pending).rejects.toThrow('Failed to start Rift: spawn ENOENT');
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it("AC2: post-startup child error reaches server.on('error') without throwing", async () => {
    serverUpImmediately();
    const { child, deps } = fakeChildDeps();

    const server = await create({ port: 45701 }, deps);
    const seen: Error[] = [];
    server.on('error', (err: Error) => seen.push(err));

    child.emit('error', new Error('engine hiccup'));

    expect(seen).toHaveLength(1);
    expect(seen[0].message).toBe('engine hiccup');
  });

  it('AC3: clean early exit (code 0) during startup rejects promptly with a code-0 message', async () => {
    serverNeverUp();
    const { child, deps } = fakeChildDeps();

    const pending = create({ port: 45702 }, deps);
    setImmediate(() => child.emit('exit', 0, null));

    await expect(pending).rejects.toThrow(/exited with code 0 during startup/);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('regression: signal-kill during startup rejects with the signal message', async () => {
    serverNeverUp();
    const { child, deps } = fakeChildDeps();

    const pending = create({ port: 45704 }, deps);
    setImmediate(() => child.emit('exit', null, 'SIGTERM'));

    await expect(pending).rejects.toThrow(/killed by signal SIGTERM/);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('regression: nonzero early exit still rejects with the stderr detail', async () => {
    serverNeverUp();
    const { child, deps } = fakeChildDeps();

    const pending = create({ port: 45703 }, deps);
    setImmediate(() => {
      child.stderr.emit('data', Buffer.from('bad config'));
      child.emit('exit', 1, null);
    });

    await expect(pending).rejects.toThrow(/exited with code 1[\s\S]*bad config/);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });
});
