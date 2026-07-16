/**
 * Conformance replay over a live engine (issue #7), plus an embedded-transport lane (issue #13).
 *
 * The spawn lane requires a rift/mb binary; self-skips in CI without one (same `describeOrSkip`
 * convention as `quickstart.integration.test.ts`/`spawn.integration.test.ts`). The embedded lane
 * requires BOTH `RIFT_FFI_LIB` (a real `librift_ffi` C-ABI v2 build) AND `koffi` to be resolvable
 * (an `optionalDependency` — absent by default, including in this worktree), mirroring
 * `embedded-quickstart.integration.test.ts`'s gate; it self-skips without either. The
 * `sdk-conformance-<version>` corpus (rift#460) hasn't shipped yet, so both lanes replay the same
 * two local mb fixtures instead — they have no `interactions.jsonl`, so a couple of interactions
 * are authored inline here, matching the stubs each fixture actually defines. `replayFixture`
 * (driver.ts) is already transport-agnostic, so the embedded lane is just a second engine factory
 * over the identical fixtures — no new harness logic.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import { createRequire } from 'module';

import { rift } from '../../src/index.js';
import { replayFixture } from './driver.js';
import { loadMbFixture, type Fixture } from './loader.js';

function binaryAvailable(): boolean {
  if (process.env.RIFT_BINARY_PATH) return fs.existsSync(process.env.RIFT_BINARY_PATH);
  if (process.env.RIFT_OFFLINE || process.env.RIFT_SKIP_BINARY_DOWNLOAD) return false;
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  for (const name of ['rift-http-proxy', 'rift', 'mb']) {
    try {
      execSync(`${cmd} ${name}`, { stdio: 'pipe' });
      return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

function koffiIsInstalled(): boolean {
  try {
    createRequire(import.meta.url).resolve('koffi');
    return true;
  } catch {
    return false;
  }
}

const describeOrSkip = binaryAvailable() ? describe : describe.skip;

const embeddedLibPath = process.env.RIFT_FFI_LIB;
const embeddedRunnable = Boolean(embeddedLibPath) && koffiIsInstalled();
const describeEmbeddedOrSkip = embeddedRunnable ? describe : describe.skip;

function basicApiFixture(): Fixture {
  return {
    ...loadMbFixture('basic-api.json'),
    interactions: [
      { request: { method: 'GET', path: '/health' }, expect: { status: 200, body: 'OK' } },
      {
        request: { method: 'GET', path: '/api/users' },
        expect: {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: [
            { id: 1, name: 'Alice' },
            { id: 2, name: 'Bob' },
          ],
        },
      },
      {
        request: { method: 'POST', path: '/api/users' },
        expect: { status: 201, body: { id: 999, message: 'Created' } },
      },
    ],
  };
}

function errorTestingFixture(): Fixture {
  return {
    ...loadMbFixture('error-testing.json'),
    interactions: [
      { request: { method: 'GET', path: '/success' }, expect: { status: 200, body: { status: 'ok' } } },
      {
        request: { method: 'GET', path: '/error/404' },
        expect: { status: 404, body: { error: 'Not Found' } },
      },
      {
        request: { method: 'GET', path: '/error/503' },
        expect: { status: 503, headers: { 'retry-after': '30' }, bodyContains: 'Service Unavailable' },
      },
    ],
  };
}

describeOrSkip('issue #7 — conformance replay over a spawned engine', () => {
  it('replays basic-api.json: health check, list, and create', async () => {
    await using engine = await rift.spawn();
    await replayFixture(engine, basicApiFixture());
  }, 30000);

  it('replays error-testing.json: a success path and a documented error path', async () => {
    await using engine = await rift.spawn();
    await replayFixture(engine, errorTestingFixture());
  }, 30000);

  it('fails loudly, naming the fixture and step, on a genuine mismatch', async () => {
    await using engine = await rift.spawn();
    const fixture: Fixture = {
      ...loadMbFixture('basic-api.json'),
      interactions: [{ request: { method: 'GET', path: '/health' }, expect: { status: 999 } }],
    };

    await expect(replayFixture(engine, fixture)).rejects.toThrow(
      'conformance replay failed: fixture "basic-api.json" step 0'
    );
  }, 30000);
});

describeEmbeddedOrSkip('issue #13 — conformance replay over the embedded transport', () => {
  it('replays basic-api.json: health check, list, and create', async () => {
    await using engine = await rift.embedded({ libPath: embeddedLibPath });
    await replayFixture(engine, basicApiFixture());
  }, 30000);

  it('replays error-testing.json: a success path and a documented error path', async () => {
    await using engine = await rift.embedded({ libPath: embeddedLibPath });
    await replayFixture(engine, errorTestingFixture());
  }, 30000);

  it('fails loudly, naming the fixture and step, on a genuine mismatch', async () => {
    await using engine = await rift.embedded({ libPath: embeddedLibPath });
    const fixture: Fixture = {
      ...loadMbFixture('basic-api.json'),
      interactions: [{ request: { method: 'GET', path: '/health' }, expect: { status: 999 } }],
    };

    await expect(replayFixture(engine, fixture)).rejects.toThrow(
      'conformance replay failed: fixture "basic-api.json" step 0'
    );
  }, 30000);
});
