/**
 * Embedded-lane jest project (issue #44): runs the conformance + embedded integration suites
 * against the BUILT package. `src/` imports are remapped to `dist/`, so `NativeEngine.load`'s
 * `new URL('./worker.js', import.meta.url)` resolves the real compiled worker
 * (`dist/embedded/worker.js`) — from TS source under ts-jest it would resolve
 * `src/embedded/worker.js` inside the embedded package, which doesn't exist and couldn't run on `worker_threads` anyway.
 * Requires `npm run build` first (CI's embedded-conformance jobs build before testing).
 * The unit suite (`jest.config.js`) keeps importing `src/`.
 */
import base from './jest.config.js';

export default {
  ...base,
  moduleNameMapper: {
    // Must precede the base `.js`-stripping rule: `../../src/x.js` has to hit dist, not ts-jest.
    '^(?:\\.\\./)+src/(.*)\\.js$': '<rootDir>/dist/$1.js',
    ...base.moduleNameMapper,
  },
  testMatch: [
    '**/test/conformance/**/*.test.ts',
    '**/test/integration/embedded-*.integration.test.ts',
  ],
};
