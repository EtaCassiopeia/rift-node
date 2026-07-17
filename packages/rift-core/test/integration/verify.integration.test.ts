/**
 * Gate for issue #6 — the verification API over a live spawned engine. Self-skips when no rift
 * binary is available (same `describeOrSkip` convention as `quickstart.integration.test.ts`), with
 * one difference: `mb` (plain Mountebank) does NOT count here. `recordRequests`/`savedRequests` is
 * a Rift extension — a stock `mb` 404s on it — so unlike the other integration suites, this one
 * needs a genuine rift-http-proxy/rift binary (or `RIFT_BINARY_PATH`) to do anything useful.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import { rift, imposter, onGet, okJson, times, never } from '../../src/index.js';
import { VerificationError } from '../../src/errors.js';

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

describeOrSkip('issue #6 — verification API over spawn', () => {
  it('verify(times(N)) passes once N matching requests are recorded, and fails otherwise', async () => {
    await using engine = await rift.spawn();
    const users = await engine.create(
      imposter('users').record().stub(onGet('/api/users/1').willReturn(okJson({ id: 1 })))
    );

    await expect(users.verify(onGet('/api/users/1'), never())).resolves.toBeUndefined();

    await fetch(`${users.url}/api/users/1`);
    await fetch(`${users.url}/api/users/1`);

    await expect(users.verify(onGet('/api/users/1'), times(2))).resolves.toBeUndefined();
    await expect(users.verify(onGet('/api/users/1'), times(1))).rejects.toBeInstanceOf(VerificationError);

    const recorded = await users.recorded();
    expect(recorded).toHaveLength(2);
    expect(recorded.every((r) => r.path === '/api/users/1')).toBe(true);

    await users.clearRecorded();
    await expect(users.verify(onGet('/api/users/1'), never())).resolves.toBeUndefined();
  }, 45_000);
});
