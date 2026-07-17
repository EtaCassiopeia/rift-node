/**
 * Mountebank-compat `create()` — the pre-existing drop-in surface, unchanged: existing
 * `@rift-vs/rift`/Mountebank code (raw REST calls against `POST /imposters`, the `mb` CLI, etc.)
 * keeps working with zero rewrites. It is a PERMANENT surface, not a deprecated bridge — see
 * docs/migration.md for why both APIs coexist. Self-skips like the spawn quick start.
 */
import fs from 'fs';
import { execSync } from 'child_process';
import { create } from '../src/index.js';

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

  // docs:embed quickstart-compat
  const server = await create({ port: 2525 });

  // existing Mountebank-style REST calls / mb client code works unchanged against server.port

  await server.close();
  // docs:embed-end quickstart-compat
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
