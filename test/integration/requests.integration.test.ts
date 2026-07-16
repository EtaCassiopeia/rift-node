/**
 * Gate for issue #26 — `ImposterHandle.requests()` over a live spawned engine. Needs genuine
 * `recordRequests`/`savedRequests` support (a Rift extension), so like `verify.integration.test.ts`
 * this one self-skips unless a real `rift-http-proxy`/`rift` binary (or `RIFT_BINARY_PATH`) is
 * available — plain `mb` 404s on it.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import { rift, imposter, onGet, okJson } from '../../src/index.js';
import type { RecordedRequest } from '../../src/verify/index.js';

function binaryAvailable(): boolean {
  if (process.env.RIFT_SKIP_BINARY_DOWNLOAD || process.env.RIFT_OFFLINE) {
    if (process.env.RIFT_BINARY_PATH) return fs.existsSync(process.env.RIFT_BINARY_PATH);
    return false;
  }
  if (process.env.RIFT_BINARY_PATH) return fs.existsSync(process.env.RIFT_BINARY_PATH);
  for (const name of ['rift-http-proxy', 'rift']) {
    try {
      execSync(`${process.platform === 'win32' ? 'where' : 'which'} ${name}`, { stdio: 'pipe' });
      return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

const describeOrSkip = binaryAvailable() ? describe : describe.skip;

describeOrSkip('issue #26 — recorded-request async iteration over spawn', () => {
  it('observes exactly 3 real requests, in order, via requests()', async () => {
    await using engine = await rift.spawn();
    const users = await engine.create(
      imposter('users').record().stub(onGet('/api/users/1').willReturn(okJson({ id: 1 })))
    );

    const controller = new AbortController();
    const seen: RecordedRequest[] = [];
    const consuming = (async () => {
      for await (const r of users.requests({ pollIntervalMs: 50, signal: controller.signal })) {
        seen.push(r);
        if (seen.length === 3) controller.abort();
      }
    })();

    await fetch(`${users.url}/api/users/1`);
    await fetch(`${users.url}/api/users/1?x=2`);
    await fetch(`${users.url}/api/users/1?x=3`);

    await consuming;

    expect(seen).toHaveLength(3);
    expect(seen.every((r) => r.path === '/api/users/1')).toBe(true);
    expect(seen.map((r) => r.query['x'])).toEqual([undefined, '2', '3']);
  }, 45_000);
});
