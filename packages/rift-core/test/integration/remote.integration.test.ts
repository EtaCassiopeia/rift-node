/**
 * Integration tests for the fetch-based remote admin API client (issue #4)
 *
 * These tests spawn a real Rift engine via `create()` and drive it through
 * `connect()` / `RemoteClient` — no mocked fetch. They require the rift
 * binary to be available and are skipped otherwise (see server.test.ts for
 * the same skip pattern).
 *
 * To run these tests:
 *   1. Build rift-http-proxy: cargo build --release
 *   2. Set RIFT_BINARY_PATH to the binary location
 *   3. Run: npm run test:integration
 */

import fs from 'fs';
import { execSync } from 'child_process';
import { create } from '../../src/index.js';
import { connect } from '../../src/remote/index.js';
import type { RiftServer } from '../../src/types.js';

// Synchronous check at module load time
function checkBinarySync(): boolean {
  // Check environment variable
  if (process.env.RIFT_BINARY_PATH) {
    return fs.existsSync(process.env.RIFT_BINARY_PATH);
  }

  // Check if any of the binary names are in PATH
  const binaryNames = ['rift-http-proxy', 'rift', 'mb'];
  const cmd = process.platform === 'win32' ? 'where' : 'which';

  for (const name of binaryNames) {
    try {
      execSync(`${cmd} ${name}`, { stdio: 'pipe' });
      return true;
    } catch {
      // Try next name
    }
  }

  return false;
}

const binaryAvailable = checkBinarySync();

if (!binaryAvailable) {
  console.warn('\n⚠️  Rift binary not found, skipping remote client integration tests');
  console.warn('   Set RIFT_BINARY_PATH to enable these tests\n');
}

const conditionalDescribe = binaryAvailable ? describe : describe.skip;

conditionalDescribe('Remote client integration', () => {
  const adminPort = 4010;
  const baseUrl = `http://localhost:${adminPort}`;
  let server: RiftServer;

  beforeAll(async () => {
    server = await create({ port: adminPort });
  });

  afterAll(async () => {
    await server.close();
  });

  it('round-trips an imposter through createImposter/getImposter/deleteImposter', async () => {
    await using client = connect(baseUrl);
    const stubPort = 4545;

    await client.createImposter({ port: stubPort, protocol: 'http', stubs: [] });

    const fetched = await client.getImposter(stubPort);
    expect(fetched.port).toBe(stubPort);
    expect(fetched.protocol).toBe('http');

    await client.deleteImposter(stubPort);

    await expect(client.getImposter(stubPort)).rejects.toThrow();
  });
});
