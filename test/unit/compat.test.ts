/**
 * Gate for issue #25 AC2b — the compat `create()` readiness poll runs on `fetch` and treats ANY
 * HTTP response (including an error status) as "server up", retrying only on a transport rejection.
 */

import { jest } from '@jest/globals';
import { waitForServer } from '../../src/compat/index.js';

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
