/**
 * Binary discovery helpers — thin, backward-compatible wrappers over the reworked resolver
 * (`src/spawn/resolve.ts`).
 *
 * The legacy download/extract stack that used to live here (its own `https.get`, `tar`/`unzip`
 * shell-outs, and unverified downloads) has been retired in favour of `resolveBinary`, which does
 * manifest-driven discovery with mandatory SHA-256 verification and injectable IO. These wrappers
 * remain only so existing importers of `findBinary` / `downloadBinary` / `getBinaryVersion` keep
 * working.
 */

import { execSync } from 'child_process';
import { resolveBinary, DEFAULT_ENGINE_VERSION } from './spawn/resolve.js';

const INSTALL_HINT =
  'Rift binary not found. Install it via one of:\n' +
  "  1. Run 'npx rift-fetch' to download it on demand\n" +
  '  2. Set RIFT_BINARY_PATH environment variable\n' +
  "  3. Install 'rift' or 'rift-http-proxy' to your system PATH\n\n" +
  'For manual installation, visit: https://github.com/achird-labs/rift/releases';

/**
 * Locate an already-present Rift binary without downloading.
 *
 * Delegates to {@link resolveBinary} but suppresses its download step, so resolution is limited to
 * `RIFT_BINARY_PATH` → `PATH` → the local version cache. Throws with an install hint if none is found.
 *
 * @deprecated Prefer `resolveBinary` (from the spawn transport) for new code.
 */
export async function findBinary(): Promise<string> {
  return resolveBinary({
    download: async () => {
      throw new Error(INSTALL_HINT);
    },
  });
}

/**
 * Resolve (downloading on demand, with SHA-256 verification) the Rift binary for this platform.
 *
 * @param version Engine version to fetch; `'latest'` maps to the SDK's pinned default.
 * @param baseUrl Optional release mirror base.
 * @deprecated Prefer `resolveBinary` (from the spawn transport) for new code.
 */
export async function downloadBinary(
  version: string = 'latest',
  baseUrl?: string
): Promise<string> {
  // Preserve the historical "actually fetch the requested version" contract: skip the resolver's
  // PATH and cache steps so a binary already on PATH doesn't shadow the requested download.
  return resolveBinary({
    version: version === 'latest' ? DEFAULT_ENGINE_VERSION : version,
    lookupPath: () => null,
    cacheLookup: () => null,
    ...(baseUrl ? { mirror: baseUrl } : {}),
  });
}

/**
 * Get the installed binary's version string, or `null` if the binary is absent or errors.
 *
 * @deprecated Prefer `resolveBinary` + your own version probe for new code.
 */
export async function getBinaryVersion(): Promise<string | null> {
  try {
    const binaryPath = await findBinary();
    const result = execSync(`"${binaryPath}" --version`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.trim();
  } catch {
    return null;
  }
}
