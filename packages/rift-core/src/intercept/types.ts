/**
 * Shared intercept (TLS-MITM) types (issue #11).
 *
 * `InterceptOptions` is the public `engine.intercept(options?)` input, shared by all three
 * transports. `InterceptBackend` is the transport-agnostic seam every transport adapts to (embedded
 * over FFI, remote/spawn over HTTP) so `InterceptHandle` (engine.ts) is implemented exactly once and
 * is fully testable against a fake backend with no cdylib/koffi/live engine involved.
 */

export interface InterceptOptions {
  host?: string;
  port?: number;
  /** Both-or-neither with `caKeyPath` — enforced by `engine.ts`'s `intercept()` dispatch. */
  caCertPath?: string;
  caKeyPath?: string;
}

export interface InterceptBackend {
  startIntercept(optionsJson: string): Promise<{ interceptPort: number; interceptUrl: string }>;
  addRules(rulesJson: string): Promise<void>;
  /** Returns the current rule list as a JSON array (string) — parsed by `InterceptHandle.rules()`. */
  listRules(): Promise<string>;
  clearRules(): Promise<void>;
  caPem(): Promise<string>;
  exportTruststore(format: string, password: string, outPath: string): Promise<void>;
}
