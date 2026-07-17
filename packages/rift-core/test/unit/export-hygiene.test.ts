/**
 * Gate for issue #25 — export hygiene + legacy retirement.
 *
 * Covers: legacy types are gone from the root (AC1), zero runtime deps (AC2a), the exports map is
 * well-formed with every subpath importable (AC4), and the docs record the change (AC5).
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as rift from '../../src/index.js';
import type * as Root from '../../src/index.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8');
const pkg = JSON.parse(read('package.json'));

// --- AC1: legacy weak types are no longer exported from the root -------------------------------
// Compile-time enforcement: ts-jest type-checks this file, so accessing any legacy name as a member
// of the root namespace type must error. If one of these is wrongly re-exported, the `@ts-expect-error`
// becomes an unused-directive compile error and fails the suite. (Exported so it isn't "unused".)
export type _AssertNoLegacyRootExports = {
  // @ts-expect-error 'Predicate' must not be exported from the package root
  a: Root.Predicate;
  // @ts-expect-error 'Response' must not be exported from the package root
  b: Root.Response;
  // @ts-expect-error 'Stub' must not be exported from the package root
  c: Root.Stub;
  // @ts-expect-error 'Imposter' must not be exported from the package root
  d: Root.Imposter;
  // @ts-expect-error 'ImposterConfig' must not be exported from the package root
  e: Root.ImposterConfig;
  // @ts-expect-error 'ServerInfo' must not be exported from the package root
  f: Root.ServerInfo;
};

describe('issue #25 — export hygiene', () => {
  it('AC1: root no longer star-exports the legacy types module', () => {
    const indexSrc = read('src/index.ts');
    expect(indexSrc).not.toMatch(/export\s+\*\s+from\s+'\.\/types\.js'/);
  });

  it('AC1: the wire model is still reachable under the `wire` namespace', () => {
    // Value-level presence of the namespace (types have no runtime footprint).
    expect(rift.wire).toBeDefined();
    expect(typeof rift.fromJson).toBe('function');
  });

  it('AC1: the canonical error classes are exported from the root', () => {
    for (const name of [
      'RiftError',
      'InvalidDefinition',
      'ImposterNotFound',
      'EngineError',
      'EngineUnavailable',
      'CommunicationError',
      'WireValidationError',
      'VerificationError',
      'UnsupportedPredicateError',
      'EngineVersionError',
      'NativeLibraryError',
      'InterceptUnavailable',
    ]) {
      expect(typeof (rift as Record<string, unknown>)[name]).toBe('function');
    }
    // WireValidationError is now part of the RiftError hierarchy.
    expect(new rift.WireValidationError('x', '$')).toBeInstanceOf(rift.RiftError);
  });

  it('AC2a: the package has zero runtime dependencies', () => {
    expect(Object.keys(pkg.dependencies ?? {})).toHaveLength(0);
  });

  it('AC2a: optional peer deps are declared optional', () => {
    for (const peer of ['@rift-vs/rift-embedded', 'undici', 'vitest']) {
      expect(pkg.peerDependencies?.[peer]).toBeDefined();
      expect(pkg.peerDependenciesMeta?.[peer]?.optional).toBe(true);
    }
  });

  it('AC4: exports map lists all subpaths with `types` before `import`', () => {
    const expected = ['.', './compat', './testkit/vitest', './testkit/jest', './intercept-undici', './internal'];
    for (const key of expected) {
      const entry = pkg.exports[key];
      expect(entry).toBeDefined();
      expect(Object.keys(entry)[0]).toBe('types');
      expect(entry.import).toMatch(/^\.\/dist\//);
    }
  });

  it('AC4: every subpath source module is importable (testkit/vitest excepted — see next test)', async () => {
    await expect(import('../../src/index.js')).resolves.toBeDefined();
    await expect(import('../../src/compat/index.js')).resolves.toBeDefined();
    await expect(import('../../src/testkit/jest.js')).resolves.toBeDefined();
    await expect(import('../../src/intercept-undici.js')).resolves.toBeDefined();
    await expect(import('../../src/internal.js')).resolves.toBeDefined();
  });

  it('AC4/issue #12: testkit/vitest hard-requires the optional `vitest` peer, absent here', async () => {
    // Unlike the other subpaths, `testkit/vitest.ts` statically imports `vitest` at module scope
    // (needed to build `riftTest` eagerly) — so importing it without the optional peer installed
    // fails fast and by name, rather than silently degrading.
    await expect(import('../../src/testkit/vitest.js')).rejects.toThrow(/vitest/);
  });

  it('AC4/AC5: exports map declares no CommonJS `require` condition (ESM-only)', () => {
    for (const entry of Object.values<Record<string, string>>(pkg.exports)) {
      expect(entry.require).toBeUndefined();
    }
  });

  it('AC4: `create` is available from root and from the compat subpath', async () => {
    expect(typeof rift.create).toBe('function');
    const compat = await import('../../src/compat/index.js');
    expect(typeof compat.create).toBe('function');
  });

  it('AC5: README documents ESM-only + Node 20 floor', () => {
    const readme = read('README.md');
    expect(readme).toMatch(/ESM-only/);
    expect(readme).toMatch(/Node ≥ 20|Node 20/);
  });

  it('AC5: CHANGELOG lists the removed/renamed exports', () => {
    const changelog = read('CHANGELOG.md');
    expect(changelog).toMatch(/ImposterConfig/);
    expect(changelog).toMatch(/axios/);
    expect(changelog).toMatch(/isBinaryInstalled/);
  });
});
