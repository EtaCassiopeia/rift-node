/**
 * Bootstrap regression gate (issue #1)
 *
 * Locks the packaging invariants established by the repo extraction: the version line
 * continues at 0.12.0, the package targets Node 20+, declares a machine-readable
 * `minEngineVersion`, and resolves its ESM entry points + type declarations from `dist/`.
 * These are the config contracts every downstream artifact depends on.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

interface PackageJson {
  name?: string;
  version?: string;
  type?: string;
  main?: string;
  types?: string;
  minEngineVersion?: unknown;
  engines?: { node?: string };
  exports?: Record<string, { import?: string; types?: string }>;
  repository?: { url?: string; directory?: string };
  homepage?: string;
  bugs?: { url?: string };
  files?: string[];
}

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  fs.readFileSync(path.join(here, '..', '..', 'package.json'), 'utf8')
) as PackageJson;

describe('package.json bootstrap invariants', () => {
  it('keeps the published package name', () => {
    expect(pkg.name).toBe('@rift-vs/rift');
  });

  it('is a clean stable version strictly above the monorepo line (> 0.12.0)', () => {
    // The monorepo publishes @rift-vs/rift independently and may advance the line at any
    // time, so we don't pin an exact number — we assert the invariant that matters: the
    // package.json base is a clean (non-prerelease) semver strictly greater than the last
    // known monorepo stable, 0.12.0. CI only ever publishes `-snapshot.*` prereleases; the
    // stable number is chosen (and confirmed free) when a release is cut.
    const v = pkg.version ?? '';
    expect(v).toMatch(/^\d+\.\d+\.\d+$/);
    const [maj, min, pat] = v.split('.').map(Number);
    const gt = (a: number[], b: number[]) =>
      a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];
    expect(gt([maj, min, pat], [0, 12, 0])).toBe(true);
  });

  it('is an ESM package', () => {
    expect(pkg.type).toBe('module');
  });

  it('targets Node 20 or newer', () => {
    const node = pkg.engines?.node;
    expect(node).toBeDefined();
    const match = /(\d+)/.exec(node ?? '');
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBeGreaterThanOrEqual(20);
  });

  it('declares a semver minEngineVersion for the rift engine', () => {
    expect(typeof pkg.minEngineVersion).toBe('string');
    expect(pkg.minEngineVersion).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  });

  it('resolves ESM entry point and types from dist/', () => {
    expect(pkg.main).toBe('dist/index.js');
    expect(pkg.types).toBe('dist/index.d.ts');
    expect(pkg.exports?.['.']?.import).toBe('./dist/index.js');
    expect(pkg.exports?.['.']?.types).toBe('./dist/index.d.ts');
  });

  it('points repository metadata at the extracted rift-node repo', () => {
    expect(pkg.repository?.url).toContain('rift-node');
    expect(pkg.repository?.directory).toBeUndefined();
    expect(pkg.homepage).toContain('rift-node');
    expect(pkg.homepage).not.toContain('/rift/');
    expect(pkg.bugs?.url).toContain('rift-node');
  });

  it('publishes exactly dist, bin and the binaries placeholder', () => {
    expect(pkg.files).toEqual(['dist', 'bin', 'binaries/.gitkeep']);
  });
});
