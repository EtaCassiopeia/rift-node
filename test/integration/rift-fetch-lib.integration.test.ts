/**
 * Gate for issue #9 — `rift-fetch --lib` end-to-end against the real GitHub releases manifest.
 * Self-skips in CI (same `describeOrSkip` convention as `quickstart.integration.test.ts`), and also
 * skips when the network is unreachable, so a disconnected/sandboxed dev machine doesn't fail this
 * suite. Runs the built CLI (`npm run build` must have already produced `dist/`) as a child process
 * against a scratch `RIFT_CACHE_DIR`, so it never touches (or depends on) the real user cache.
 */

import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function networkReachable(): boolean {
  try {
    execFileSync('node', ['--input-type=module', '-e', "await fetch('https://github.com', { method: 'HEAD', signal: AbortSignal.timeout(3000) })"], {
      stdio: 'pipe',
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

const shouldRun = !process.env.CI && existsSync(path.join(repoRoot, 'dist', 'natives', 'index.js')) && networkReachable();
const describeOrSkip = shouldRun ? describe : describe.skip;

describeOrSkip('issue #9 — rift-fetch --lib against the real release manifest', () => {
  it('resolves and caches the cdylib for a cross-fetched classifier', () => {
    const scratchCache = mkdtempSync(path.join(tmpdir(), 'rift-fetch-lib-'));
    try {
      const out = execFileSync(
        'node',
        [path.join(repoRoot, 'bin', 'rift-fetch.js'), '--lib', '--classifier', 'darwin-aarch64', '--version', 'v0.12.0'],
        {
          cwd: repoRoot,
          env: { ...process.env, RIFT_CACHE_DIR: scratchCache },
          encoding: 'utf8',
          timeout: 60_000,
        }
      );
      const libPath = out.trim();
      expect(libPath).toContain('librift_ffi-darwin-aarch64.dylib');
      expect(existsSync(libPath)).toBe(true);
      expect(existsSync(`${libPath}.sha256`)).toBe(true);
    } finally {
      rmSync(scratchCache, { recursive: true, force: true });
    }
  }, 60_000);
});
