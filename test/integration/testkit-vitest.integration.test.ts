/**
 * Self-skipping integration coverage for the Vitest testkit (`src/testkit/vitest.ts`, issue #12).
 *
 * `vitest` is an optional peer dependency, not installed in this worktree — this mirrors the
 * `describeOrSkip` convention used by the other integration suites (e.g.
 * `embedded-quickstart.integration.test.ts`'s `koffiIsInstalled()`). It goes one step further than
 * those: it never even statically imports `../../src/testkit/vitest.js`, since THAT file itself
 * statically imports `vitest` — a static import of an unresolvable module throws at module-load
 * time, before `describeOrSkip` gets a chance to skip anything. The import only happens dynamically,
 * inside the gated test body, so a jest run with vitest absent never attempts to resolve it at all.
 */

import { createRequire } from 'module';

function vitestIsInstalled(): boolean {
  try {
    createRequire(import.meta.url).resolve('vitest');
    return true;
  } catch {
    return false;
  }
}

const describeOrSkip = vitestIsInstalled() ? describe : describe.skip;

describeOrSkip('@rift-vs/rift/testkit/vitest (real vitest package present)', () => {
  it('createRiftTest()/riftTest/assertReceived have the expected shape', async () => {
    const { createRiftTest, riftTest, assertReceived } = await import('../../src/testkit/vitest.js');
    expect(typeof createRiftTest).toBe('function');
    expect(typeof riftTest).toBe('function');
    expect(typeof riftTest.extend).toBe('function');
    expect(typeof assertReceived).toBe('function');
  });

  it('createRiftTest(opts) builds an independent fixture-extended test API', async () => {
    const { createRiftTest } = await import('../../src/testkit/vitest.js');
    const custom = createRiftTest({ transport: 'spawn' });
    expect(typeof custom).toBe('function');
    expect(typeof custom.extend).toBe('function');
  });
});
