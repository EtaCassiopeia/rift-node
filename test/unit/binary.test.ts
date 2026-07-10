/**
 * Gate for issue #25 AC3 — binary.ts is a thin, deprecated wrapper over the reworked resolver.
 * The legacy download/extract stack (its own `https.get`, tar/unzip shell-outs) and the buggy
 * `isBinaryInstalled` are gone; discovery/download delegate to `resolveBinary`.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as binary from '../../src/binary.js';

const binarySrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'binary.ts'),
  'utf8'
);

describe('issue #25 — binary.ts thin wrappers', () => {
  it('AC3: still exports the three compatibility wrappers as functions', () => {
    expect(typeof binary.findBinary).toBe('function');
    expect(typeof binary.downloadBinary).toBe('function');
    expect(typeof binary.getBinaryVersion).toBe('function');
  });

  it('AC3: the buggy isBinaryInstalled export is removed', () => {
    expect((binary as Record<string, unknown>).isBinaryInstalled).toBeUndefined();
  });

  it('AC3: the retired legacy platform helpers are gone', () => {
    expect((binary as Record<string, unknown>).PLATFORM_MAP).toBeUndefined();
    expect((binary as Record<string, unknown>).getPlatformKey).toBeUndefined();
  });

  it('AC3: delegates to the resolver and drops its own download/extract stack', () => {
    expect(binarySrc).toMatch(/from '\.\/spawn\/resolve\.js'/);
    expect(binarySrc).toMatch(/resolveBinary\(/);
    expect(binarySrc).not.toMatch(/https\.get\(/);
    expect(binarySrc).not.toMatch(/extractTarGz|extractZip|downloadFile/);
    // No stray console side effects in a library module.
    expect(binarySrc).not.toMatch(/console\.(log|warn)/);
  });

  it('AC3: findBinary injects a no-download resolver step (delegation, not its own fetch)', () => {
    // The wrapper suppresses resolveBinary's download step so discovery never reaches the network.
    expect(binarySrc).toMatch(/download:\s*async/);
  });
});
