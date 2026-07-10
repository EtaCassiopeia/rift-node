/**
 * undici trust helper for the intercept (TLS-MITM) surface — placeholder.
 *
 * The full implementation (`interceptDispatcher(handle)` returning a `ProxyAgent` wired with the
 * intercept CA) lands with issue #11. The module is importable now so the package's exports map is
 * settled; calling into it throws until then.
 */

const NOT_IMPLEMENTED =
  '@rift-vs/rift/intercept-undici is not implemented yet — see https://github.com/EtaCassiopeia/rift-node/issues/11';

export function interceptDispatcher(): never {
  throw new Error(NOT_IMPLEMENTED);
}
