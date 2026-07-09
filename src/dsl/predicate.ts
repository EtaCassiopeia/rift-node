/**
 * Predicate helper functions. Unlike the response/stub/imposter builders, these return plain
 * wire {@link Predicate} objects directly — a predicate is already a flat, immutable value with
 * no incremental state to accumulate, so a builder class would add ceremony without benefit.
 */

import type { FieldMatch, JsonValue, Predicate } from '../model/index.js';

function fieldMatch(field: string, value: JsonValue): FieldMatch {
  return { [field]: value };
}

export function equals(field: string, value: JsonValue): Predicate {
  return { equals: fieldMatch(field, value) };
}

export function deepEquals(field: string, value: JsonValue): Predicate {
  return { deepEquals: fieldMatch(field, value) };
}

export function matches(field: string, value: JsonValue): Predicate {
  return { matches: fieldMatch(field, value) };
}

export function contains(field: string, value: JsonValue): Predicate {
  return { contains: fieldMatch(field, value) };
}

export function startsWith(field: string, value: JsonValue): Predicate {
  return { startsWith: fieldMatch(field, value) };
}

export function endsWith(field: string, value: JsonValue): Predicate {
  return { endsWith: fieldMatch(field, value) };
}

export function exists(field: string): Predicate {
  return { exists: { [field]: true } };
}

export function and(...predicates: Predicate[]): Predicate {
  return { and: predicates };
}

export function or(...predicates: Predicate[]): Predicate {
  return { or: predicates };
}

export function not(predicate: Predicate): Predicate {
  return { not: predicate };
}
