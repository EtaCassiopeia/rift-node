/**
 * Vitest fixtures for Rift — placeholder.
 *
 * The full implementation (worker-scoped engine fixture, per-test imposter auto-teardown,
 * `assertReceived`) lands with issue #12. The module is importable now so the package's exports map
 * is settled; calling into it throws until then.
 */

const NOT_IMPLEMENTED =
  '@rift-vs/rift/testkit/vitest is not implemented yet — see https://github.com/EtaCassiopeia/rift-node/issues/12';

export function createRiftTest(): never {
  throw new Error(NOT_IMPLEMENTED);
}

export function assertReceived(): never {
  throw new Error(NOT_IMPLEMENTED);
}
