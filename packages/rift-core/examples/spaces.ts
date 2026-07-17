/**
 * The "spaces" isolation pattern for a shared, already-running engine (`rift.connect(url)`, e.g.
 * one Rift instance shared by an entire CI job): imposters generally can't be created/deleted per
 * test without disturbing other tests still running against them. Scope stub setup + verification
 * to a fresh flow id per test instead — no imposter create/delete, no cross-test bleed. This
 * example spins up its own engine + shared imposter first to stay self-contained; in a real suite
 * the shared imposter already exists (created once, wherever the engine itself is provisioned).
 */
import fs from 'fs';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { rift, imposter, onGet, okJson, times } from '../src/index.js';

function binaryAvailable(): boolean {
  const explicit = process.env.RIFT_BINARY_PATH;
  if (explicit) return fs.existsSync(explicit);
  if (process.env.RIFT_OFFLINE || process.env.RIFT_SKIP_BINARY_DOWNLOAD) return false;
  for (const name of ['rift-http-proxy', 'rift', 'mb']) {
    try {
      execSync(`${process.platform === 'win32' ? 'where' : 'which'} ${name}`, { stdio: 'pipe' });
      return true;
    } catch {
      // try the next candidate name
    }
  }
  return false;
}

async function main(): Promise<void> {
  if (!binaryAvailable()) {
    console.log('no rift binary resolvable offline — skipping (run `npx rift-fetch` first).');
    return;
  }

  await using engine = await rift.spawn();

  // Set up once, wherever the shared imposter is created — NOT per test.
  const shared = await engine.create(
    imposter('users')
      .record()
      .flowIdFromHeader('X-Flow-Id')
      .stub(onGet('/health').willReturn(okJson({ ok: true }))));
  const sharedUsersPort = shared.port;

  // docs:embed spaces
  const users = await engine.get(sharedUsersPort); // a shared imposter, not created by this test
  const flowId = randomUUID();
  const space = users.space(flowId);

  await space.addStub(onGet('/api/users/1').willReturn(okJson({ id: 1 })));
  await fetch(`${users.url}/api/users/1`, { headers: { 'X-Flow-Id': flowId } });
  await space.verify(onGet('/api/users/1'), times(1));
  await space.delete(); // cleans up this test's slice only — the shared imposter itself lives on
  // docs:embed-end spaces

  await shared.delete();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
