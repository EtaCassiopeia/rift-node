/**
 * Vitest fixtures: `riftTest` supplies a worker-scoped engine, `{ engine }`, with every imposter
 * `.create()`d during a test auto-deleted when that test ends. Only needs to compile here — running
 * it for real requires the Vitest runner, which this package treats as an optional peer dependency.
 */
import { riftTest } from '../src/testkit/vitest.js';
import { imposter, onGet, okJson, times } from '../src/index.js';

// docs:embed testkit-vitest
riftTest('looks up user', async ({ engine }) => {
  const users = await engine.create(imposter('users').record()
    .stub(onGet('/api/users/1').willReturn(okJson({ id: 1 }))));  // auto-teardown
  await fetch(`${users.url}/api/users/1`);
  await users.verify(onGet('/api/users/1'), times(1));
});
// docs:embed-end testkit-vitest
