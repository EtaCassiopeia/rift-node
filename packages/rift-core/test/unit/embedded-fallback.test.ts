/**
 * The rift.embedded() dynamic-import fallback (#39): when `@rift-vs/rift-embedded` cannot be
 * loaded, the failure must surface as EngineUnavailable naming the package to install — never a
 * raw module-resolution error. The package IS resolvable in this repo (workspace link), so the
 * absence is simulated by mocking the specifier to throw at import time.
 */
import { jest } from '@jest/globals';

test('rift.embedded() maps a failing @rift-vs/rift-embedded import to EngineUnavailable with the install hint', async () => {
  jest.unstable_mockModule('@rift-vs/rift-embedded', () => {
    throw new Error('simulated ERR_MODULE_NOT_FOUND');
  });
  const { rift } = await import('../../src/engine.js');
  const { EngineUnavailable } = await import('../../src/errors.js');
  const attempt = rift.embedded();
  await expect(attempt).rejects.toBeInstanceOf(EngineUnavailable);
  await expect(attempt).rejects.toThrow(/@rift-vs\/rift-embedded/);
});
