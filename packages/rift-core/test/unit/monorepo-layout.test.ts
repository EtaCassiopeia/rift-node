/**
 * Gate for #39 — the monorepo split. Asserts the physical two-package layout and the manifest
 * properties the issue's acceptance criteria name. Paths are computed from this test file's
 * location inside packages/rift-core/test/unit, so the assertions are layout-relative and fail
 * loudly (red) on the pre-split single-package layout.
 */
import { readFileSync, existsSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const coreRoot = join(here, '..', '..');            // packages/rift-core
const repoRoot = join(coreRoot, '..', '..');        // repo root
const embeddedRoot = join(repoRoot, 'packages', 'rift-embedded');

function readJson(p: string): Record<string, unknown> {
  return JSON.parse(readFileSync(p, 'utf8'));
}

describe('monorepo split (#39)', () => {
  it('root is a private npm-workspaces shell over packages/*', () => {
    const root = readJson(join(repoRoot, 'package.json'));
    expect(root['private']).toBe(true);
    expect(root['workspaces']).toEqual(['packages/*']);
  });

  it('src/embedded is extracted: embedded sources live in packages/rift-embedded, not core', () => {
    expect(existsSync(join(embeddedRoot, 'src', 'ffi.ts'))).toBe(true);
    expect(existsSync(join(embeddedRoot, 'src', 'worker.ts'))).toBe(true);
    expect(existsSync(join(coreRoot, 'src', 'embedded'))).toBe(false);
  });

  it('@rift-vs/rift-embedded publishes independently with koffi as a REAL dependency', () => {
    const pkg = readJson(join(embeddedRoot, 'package.json'));
    expect(pkg['name']).toBe('@rift-vs/rift-embedded');
    expect((pkg['dependencies'] as Record<string, string>)['koffi']).toBeDefined();
    expect(pkg['optionalDependencies']).toBeUndefined();
    expect((pkg['peerDependencies'] as Record<string, string>)['@rift-vs/rift']).toBeDefined();
    // ffi.ts reads minEngineVersion from its own package manifest after the move
    expect(pkg['minEngineVersion']).toBeDefined();
    expect((pkg['files'] as string[])).toContain('dist');
  });

  it('core @rift-vs/rift stays zero-dependency and drops koffi entirely', () => {
    const text = readFileSync(join(coreRoot, 'package.json'), 'utf8');
    const pkg = JSON.parse(text) as Record<string, unknown>;
    expect(pkg['name']).toBe('@rift-vs/rift');
    expect(pkg['dependencies'] ?? {}).toEqual({});
    expect(text.includes('"koffi"')).toBe(false);
    const meta = pkg['peerDependenciesMeta'] as Record<string, { optional?: boolean }>;
    expect(meta['@rift-vs/rift-embedded']?.optional).toBe(true);
  });

  it('core exports drop ./embedded and gain the ./internal seam for the embedded package', () => {
    const pkg = readJson(join(coreRoot, 'package.json'));
    const exports = pkg['exports'] as Record<string, unknown>;
    expect(exports['./embedded']).toBeUndefined();
    expect(exports['./internal']).toBeDefined();
  });

  it('core reaches embedded ONLY through the dynamic package-name import (no static refs)', () => {
    const engineTs = readFileSync(join(coreRoot, 'src', 'engine.ts'), 'utf8');
    // Specifier is a const (tsc must not type-resolve it — build order is core-first), dynamically
    // imported; and no static ./embedded/ path may survive anywhere in core.
    expect(engineTs.includes("'@rift-vs/rift-embedded'")).toBe(true);
    expect(engineTs).toMatch(/await import\(EMBEDDED_PACKAGE\)/);
    expect(engineTs.includes('./embedded/')).toBe(false);
  });
});

describe('monorepo split (#39) — regression guards', () => {
  it('no core source imports koffi (hoisting would mask it in-repo but break consumers)', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]
      );
    const offenders = walk(join(coreRoot, 'src')).filter(
      (f) =>
        f.endsWith('.ts') &&
        /from 'koffi'|require\('koffi'\)|import\('koffi'\)/.test(readFileSync(f, 'utf8'))
    );
    expect(offenders).toEqual([]);
  });
});
