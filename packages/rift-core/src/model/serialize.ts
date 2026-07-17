/**
 * Serialize a typed wire model to the exact JSON the engine speaks.
 *
 * Because the model already carries wire keys, serialization is a faithful, transformation-free
 * projection: it drops `undefined` optional fields (so omitted options never reach the wire) and
 * yields a JSON-safe object. A model produced by {@link fromJson} therefore round-trips to a
 * value-identical object — including an explicit `port`.
 *
 * The model must be JSON-safe. A non-serializable value (function, `bigint`, `symbol`, circular
 * reference) is a caller error, so it throws a typed {@link WireValidationError} naming the
 * offending key — it is never silently dropped or leaked as a raw `TypeError`.
 */

import { WireValidationError } from './fromJson.js';
import type { WireModel } from './types.js';

function jsonSafeReplacer(this: unknown, key: string, value: unknown): unknown {
  const t = typeof value;
  if (t === 'function' || t === 'bigint' || t === 'symbol') {
    throw new WireValidationError(
      `value of type ${t} is not JSON-serializable`,
      key === '' ? '$' : `…${key}`
    );
  }
  return value;
}

/** Serialize a wire model to the exact JSON string the engine accepts. */
export function toWireString(model: WireModel, space?: number): string {
  try {
    return JSON.stringify(model, jsonSafeReplacer, space);
  } catch (err) {
    if (err instanceof WireValidationError) throw err;
    // e.g. circular reference — JSON.stringify throws a bare TypeError.
    throw new WireValidationError(
      `model is not JSON-serializable: ${(err as Error).message}`,
      '$'
    );
  }
}

/** Project a wire model to a plain JSON-safe object (undefined optionals stripped). */
export function toWireJson(model: WireModel): unknown {
  return JSON.parse(toWireString(model));
}
