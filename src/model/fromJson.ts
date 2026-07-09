/**
 * `fromJson` escape hatch: parse + validate raw imposter JSON, then hand it back verbatim.
 *
 * Contract (issue #2): the structure is validated for well-formedness but NEVER rewritten
 * beyond what the caller provided — no key renaming, no field injection, no dropped unknowns,
 * and an explicit `port` is respected exactly. Anything structurally valid round-trips to an
 * identical object via {@link toWireJson}.
 */

import type { ImpostersConfig, Imposter, Stub, WireModel } from './types.js';

/** Thrown when `fromJson` input is not well-formed imposter JSON. Carries the offending path. */
export class WireValidationError extends Error {
  readonly path: string;
  constructor(message: string, path: string) {
    super(`${message} (at ${path})`);
    this.name = 'WireValidationError';
    this.path = path;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  // Reject Map/Set/Date/RegExp/class instances: they pass typeof 'object' but serialize
  // lossily (Map -> {}, Date -> string), which would silently corrupt a "preserved" model.
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function validatePredicate(predicate: unknown, path: string): void {
  if (!isPlainObject(predicate)) {
    throw new WireValidationError('predicate must be an object', path);
  }
  for (const op of ['and', 'or'] as const) {
    if (predicate[op] !== undefined) {
      if (!Array.isArray(predicate[op])) {
        throw new WireValidationError(`${op} must be an array of predicates`, `${path}.${op}`);
      }
      (predicate[op] as unknown[]).forEach((p, i) =>
        validatePredicate(p, `${path}.${op}[${i}]`)
      );
    }
  }
  if (predicate.not !== undefined) {
    validatePredicate(predicate.not, `${path}.not`);
  }
}

function validateResponse(response: unknown, path: string): void {
  if (!isPlainObject(response)) {
    throw new WireValidationError('response must be an object', path);
  }
  if (response.is !== undefined && !isPlainObject(response.is)) {
    throw new WireValidationError('is must be an object', `${path}.is`);
  }
  if (response.proxy !== undefined && !isPlainObject(response.proxy)) {
    throw new WireValidationError('proxy must be an object', `${path}.proxy`);
  }
}

function validateStub(stub: unknown, path: string): void {
  if (!isPlainObject(stub)) {
    throw new WireValidationError('stub must be an object', path);
  }
  if (stub.predicates !== undefined) {
    if (!Array.isArray(stub.predicates)) {
      throw new WireValidationError('predicates must be an array', `${path}.predicates`);
    }
    stub.predicates.forEach((p, i) => validatePredicate(p, `${path}.predicates[${i}]`));
  }
  if (stub.responses !== undefined) {
    if (!Array.isArray(stub.responses)) {
      throw new WireValidationError('responses must be an array', `${path}.responses`);
    }
    stub.responses.forEach((r, i) => validateResponse(r, `${path}.responses[${i}]`));
  }
}

function validateImposter(imposter: unknown, path: string): void {
  if (!isPlainObject(imposter)) {
    throw new WireValidationError('imposter must be an object', path);
  }
  if ('port' in imposter && imposter.port !== undefined) {
    if (typeof imposter.port !== 'number' || !Number.isFinite(imposter.port)) {
      throw new WireValidationError('port must be a number', `${path}.port`);
    }
  }
  if (imposter.stubs !== undefined) {
    if (!Array.isArray(imposter.stubs)) {
      throw new WireValidationError('stubs must be an array', `${path}.stubs`);
    }
    imposter.stubs.forEach((s, i) => validateStub(s, `${path}.stubs[${i}]`));
  }
}

/**
 * Parse and validate raw imposter JSON (a `{ imposters: [...] }` envelope or a single
 * imposter), returning the structure verbatim. Throws {@link WireValidationError} on
 * malformed input.
 */
export function fromJson<T extends WireModel = WireModel>(input: string | unknown): T {
  let value: unknown = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch (err) {
      throw new WireValidationError(
        `invalid JSON: ${(err as Error).message}`,
        '$'
      );
    }
  }

  if (!isPlainObject(value)) {
    throw new WireValidationError('expected an imposter object or { imposters: [...] }', '$');
  }

  if ('imposters' in value) {
    if (!Array.isArray(value.imposters)) {
      throw new WireValidationError('imposters must be an array', '$.imposters');
    }
    value.imposters.forEach((imp, i) => validateImposter(imp, `$.imposters[${i}]`));
    return value as unknown as T;
  }

  validateImposter(value, '$');
  return value as unknown as T;
}

export type { ImpostersConfig, Imposter, Stub };
