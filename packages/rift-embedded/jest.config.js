/**
 * Unit-test config for the embedded package. `@rift-vs/rift` imports are mapped to the sibling
 * workspace's TypeScript SOURCE (not its built dist), so ts-jest compiles core in-process and the
 * unit suite runs without a prior `npm run build` — mirroring how these tests imported core via
 * relative paths before the #39 split.
 */
/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^@rift-vs/rift/internal$': '<rootDir>/../rift-core/src/internal.ts',
    '^@rift-vs/rift$': '<rootDir>/../rift-core/src/index.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { useESM: true }],
  },
  testMatch: ['**/test/**/*.test.ts'],
  verbose: true,
  testTimeout: 30000,
  maxWorkers: 1,
};
