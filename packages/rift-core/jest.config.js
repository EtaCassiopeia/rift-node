/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
  testMatch: ['**/test/**/*.test.ts'],
  // Polyfill Symbol.asyncDispose/dispose in the vm context (absent on Node 20/22) so `await using`
  // works in tests; the embedded config inherits this via `...base` (#62).
  setupFiles: ['<rootDir>/test/jest.setup.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  verbose: true,
  testTimeout: 30000,
  // Run in single worker for integration tests that spawn server processes
  maxWorkers: 1,
};
