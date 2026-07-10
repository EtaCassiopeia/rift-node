/**
 * Jest helpers for Rift — placeholder.
 *
 * The full implementation (`setupRift` beforeAll/afterEach helpers, `assertReceived`) lands with
 * issue #12. The module is importable now so the package's exports map is settled; calling into it
 * throws until then.
 */

const NOT_IMPLEMENTED =
  '@rift-vs/rift/testkit/jest is not implemented yet — see https://github.com/EtaCassiopeia/rift-node/issues/12';

export function setupRift(): never {
  throw new Error(NOT_IMPLEMENTED);
}

export function assertReceived(): never {
  throw new Error(NOT_IMPLEMENTED);
}
