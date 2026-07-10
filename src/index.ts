/**
 * `@rift-vs/rift` — official Node.js / TypeScript SDK for Rift.
 *
 * The root surface is the typed layer: the fluent DSL, the wire model (namespaced as `wire`) with
 * its `fromJson` escape hatch, the transports (`rift.connect` / `rift.spawn` / `rift.embedded`), the
 * SDK-wide error hierarchy, and verification. The Mountebank-compatible `create()` is kept here as a
 * permanent drop-in (and is also available from `@rift-vs/rift/compat`).
 *
 * ESM-only, Node ≥ 20. See the README "Requirements" section.
 *
 * @example
 * ```ts
 * import { rift, imposter, onGet, okJson } from '@rift-vs/rift';
 * await using engine = await rift.spawn();
 * const users = await engine.create(imposter('users')
 *   .stub(onGet('/api/users/1').willReturn(okJson({ id: 1, name: 'Alice' }))));
 * ```
 */

// SDK-wide error hierarchy (canonical location).
export * from './errors.js';

// Typed wire model. Exposed under the `wire` namespace because the full Mountebank grammar types
// (Imposter, Stub, Predicate, Response) share names with the DSL's concepts; the escape-hatch
// helpers are lifted to the root. `WireValidationError` comes from the error hierarchy above.
export * as wire from './model/index.js';
export { fromJson, toWireJson, toWireString } from './model/index.js';

// Fluent DSL builders (imposter/stub/response/predicate/scenario) that produce the wire model.
export * from './dsl/index.js';

// Transports. `connect`/`rift` come straight from the remote client (the remote barrel also
// re-exports the errors, which we already surface from `./errors.js`).
export { connect, rift } from './remote/client.js';
export type { RemoteClient, FlowScopedOptions } from './remote/client.js';

// Spawn transport + reworked binary resolver. Importing this attaches `rift.spawn`.
export * from './spawn/index.js';

// Binary discovery helpers (thin wrappers over the resolver; kept for compatibility).
export { findBinary, downloadBinary, getBinaryVersion } from './binary.js';

// Mountebank-compatible `create()` — permanent drop-in surface. Also at `@rift-vs/rift/compat`.
export { create } from './compat/index.js';
export type { CreateOptions, RedisOptions, RiftServer } from './types.js';

import { create } from './compat/index.js';
export default { create };
