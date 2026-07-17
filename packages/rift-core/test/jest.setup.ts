/**
 * Polyfill the explicit-resource-management well-known symbols (`Symbol.asyncDispose`,
 * `Symbol.dispose`) for jest's `vm` context, which does not expose them on Node 20/22 even though
 * the host runtime has them (Node 24+ exposes them in the vm too). Without this, any `await using`
 * / `using` in a test throws `TypeError: Symbol.asyncDispose is not defined` from the TypeScript
 * `__addDisposableResource` downlevel helper — which is why the embedded integration suites failed
 * on the Node 22 CI lane once the #53 segfault stopped masking them (#62).
 *
 * Uses the registered (`Symbol.for`) symbols so the value is stable across realms and matches what
 * native Node uses when present. Runs via `setupFiles` before any test or `dist` module loads, so
 * the disposer method keys and the helper's lookup resolve to the same symbol.
 */
const S = Symbol as unknown as { asyncDispose?: symbol; dispose?: symbol };
if (S.asyncDispose === undefined) {
  Object.defineProperty(Symbol, 'asyncDispose', { value: Symbol.for('nodejs.asyncDispose') });
}
if (S.dispose === undefined) {
  Object.defineProperty(Symbol, 'dispose', { value: Symbol.for('nodejs.dispose') });
}
