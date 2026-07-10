/**
 * Field-agnostic matcher grammar (issue #22, design §5.2).
 *
 * `equals(v)`, `contains(v)`, ... build immutable {@link Matcher} values that carry an operator,
 * a value, and optional params — but no field. They only become a wire {@link Predicate} once
 * bound to a field (`method`/`path`/`body`/`headers`/`query`) by the `req.*` binders in
 * `predicate.ts` or a `StubBuilder` `with*` refiner. Each modifier (`caseSensitive()`, ...)
 * returns a NEW Matcher — the base value is never mutated, so a matcher built once can be reused
 * and specialized in multiple places without surprises.
 */

import type { JsonValue, Predicate } from '../model/index.js';

export type MatcherOperator =
  | 'equals'
  | 'deepEquals'
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'matches'
  | 'exists';

interface MatcherParams {
  caseSensitive?: true;
  keyCaseSensitive?: true;
  except?: string;
  jsonpath?: { selector: string };
  xpath?: { selector: string; ns?: Record<string, string> };
}

/** `exists`/`notExists` carry a boolean; every other operator carries a `JsonValue`. */
type MatcherValue = JsonValue | boolean;

function toSource(re: string | RegExp): string {
  return typeof re === 'string' ? re : re.source;
}

export class Matcher {
  private constructor(
    private readonly op: MatcherOperator,
    private readonly value: MatcherValue,
    private readonly params: MatcherParams
  ) {}

  /** @internal factory used by the operator functions below. */
  static of(op: MatcherOperator, value: MatcherValue, params: MatcherParams = {}): Matcher {
    return new Matcher(op, value, params);
  }

  caseSensitive(): Matcher {
    return new Matcher(this.op, this.value, { ...this.params, caseSensitive: true });
  }

  keyCaseSensitive(): Matcher {
    return new Matcher(this.op, this.value, { ...this.params, keyCaseSensitive: true });
  }

  except(re: string | RegExp): Matcher {
    return new Matcher(this.op, this.value, { ...this.params, except: toSource(re) });
  }

  jsonpath(selector: string): Matcher {
    return new Matcher(this.op, this.value, { ...this.params, jsonpath: { selector } });
  }

  xpath(selector: string, ns?: Record<string, string>): Matcher {
    const xpath = ns !== undefined ? { selector, ns } : { selector };
    return new Matcher(this.op, this.value, { ...this.params, xpath });
  }

  /**
   * Compiles to a wire Predicate bound to `field` (simple: method/path/body) or `field[key]`
   * (keyed: headers/query, `key` is the header/query-param name). Params flatten alongside the
   * operator key, e.g. `{ contains: { headers: { Accept: 'json' } }, caseSensitive: true }`.
   */
  compile(field: string, key?: string): Predicate {
    const boundValue: JsonValue =
      key !== undefined ? { [key]: this.value as JsonValue } : (this.value as JsonValue);
    return { [this.op]: { [field]: boundValue }, ...this.params } as Predicate;
  }
}

export function equals(v: JsonValue): Matcher {
  return Matcher.of('equals', v);
}

export function deepEquals(v: JsonValue): Matcher {
  return Matcher.of('deepEquals', v);
}

export function contains(v: string): Matcher {
  return Matcher.of('contains', v);
}

export function startsWith(v: string): Matcher {
  return Matcher.of('startsWith', v);
}

export function endsWith(v: string): Matcher {
  return Matcher.of('endsWith', v);
}

export function matches(re: string | RegExp): Matcher {
  return Matcher.of('matches', toSource(re));
}

export function exists(): Matcher {
  return Matcher.of('exists', true);
}

export function notExists(): Matcher {
  return Matcher.of('exists', false);
}
