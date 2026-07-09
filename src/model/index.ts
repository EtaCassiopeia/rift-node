/**
 * Typed wire model — the Mountebank imposter grammar + `_rift` extensions, plus the
 * `fromJson` escape hatch and exact-JSON serialization. Zero runtime dependencies.
 */

export * from './types.js';
export { fromJson, WireValidationError } from './fromJson.js';
export { toWireJson, toWireString } from './serialize.js';
