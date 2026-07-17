/**
 * `rift.spawn()` — launches the `rift` engine binary as a child process. Resolves the binary via
 * `RIFT_BINARY_PATH` -> PATH -> local cache -> checksummed download (never when air-gapped); run
 * `npx rift-fetch` ahead of time to warm the cache (e.g. in CI) or prepare an air-gapped install.
 * Self-skips when no binary is resolvable offline, same convention as this repo's own integration
 * tests.
 */
import fs from 'fs';
import { execSync } from 'child_process';
import { rift, imposter, onGet, okJson } from '../src/index.js';

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

  // docs:embed quickstart-spawn
  await using engine = await rift.spawn(); // resolves/downloads the rift binary on first use

  const users = await engine.create(
    imposter('users').stub(onGet('/api/users/1').willReturn(okJson({ id: 1, name: 'Alice' }))));

  await fetch(`${users.url}/api/users/1`);
  // docs:embed-end quickstart-spawn
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
