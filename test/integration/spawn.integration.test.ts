/**
 * Integration test for the spawn transport (issue #5).
 *
 * Requires a rift/mb binary; self-skips in CI (no binary) via the shared checkBinarySync pattern.
 * When a binary is present it exercises the full lifecycle: resolve -> spawn on an ephemeral admin
 * port -> talk over the fetch RemoteClient -> graceful close.
 */

import fs from 'fs';
import { execSync } from 'child_process';
import { spawn } from '../../src/spawn/index.js';

function checkBinarySync(): boolean {
  if (process.env.RIFT_BINARY_PATH) {
    return fs.existsSync(process.env.RIFT_BINARY_PATH);
  }
  const names = ['rift-http-proxy', 'rift', 'mb'];
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  for (const name of names) {
    try {
      execSync(`${cmd} ${name}`, { stdio: 'pipe' });
      return true;
    } catch {
      // try next
    }
  }
  return false;
}

const binaryAvailable = checkBinarySync();
const conditionalDescribe = binaryAvailable ? describe : describe.skip;

conditionalDescribe('spawn transport integration', () => {
  it('spawns on an ephemeral admin port and is reachable over the remote client', async () => {
    await using engine = await spawn({ startupTimeoutMs: 20000 });
    expect(engine.port).toBeGreaterThan(0);
    expect(engine.url).toContain(String(engine.port));
    // Admin plane reachable over the fetch RemoteClient (both rift and mountebank answer this).
    const list = (await engine.client.listImposters()) as { imposters?: unknown[] };
    expect(list).toBeDefined();
    expect(Array.isArray(list.imposters)).toBe(true);
  }, 30000);
});
