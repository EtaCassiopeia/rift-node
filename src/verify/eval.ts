/**
 * Client-side predicate evaluator (issue #6, design §6.2) — mirrors the engine's matcher semantics
 * with zero runtime dependencies, since Rift has no server-side verify endpoint (upstream
 * enhancement filed).
 *
 * Supports `equals`, `deepEquals`, `contains`, `startsWith`, `endsWith`, `matches`, `exists`,
 * `and`, `or`, `not`, honoring `caseSensitive` (default INsensitive, for both values and — via
 * `keyCaseSensitive`, itself default-insensitive — header/query key lookups) and `except` (a regex
 * stripped from the actual value before comparison). `body` gets Mountebank's field-wise
 * containment for `equals` vs exact structural equality for `deepEquals`. A hand-rolled `jsonpath`
 * subset (dot + bracket + numeric index) extracts a sub-value before the operator runs; wildcards,
 * filters and recursive descent — like `xpath`/`inject` — throw `UnsupportedPredicateError` naming
 * the operator (`xpath`/`inject` predicates are rift#494).
 */

import type { JsonValue, Predicate } from '../model/index.js';
import type { RecordedRequest } from './index.js';
import { UnsupportedPredicateError } from '../errors.js';

const KNOWN_OPERATORS = [
  'equals',
  'deepEquals',
  'contains',
  'startsWith',
  'endsWith',
  'matches',
] as const;
type KnownOperator = (typeof KNOWN_OPERATORS)[number];

const NON_OPERATOR_KEYS = new Set([
  'and',
  'or',
  'not',
  'exists',
  'caseSensitive',
  'keyCaseSensitive',
  'except',
  'jsonpath',
  'xpath',
]);

interface MatchParams {
  caseSensitive?: boolean;
  keyCaseSensitive?: boolean;
  except?: string;
  jsonpath?: { selector: string };
}

/** One evaluated leaf clause — a single (operator, field[, key]) check against one request. */
export interface LeafDetail {
  field: string;
  key?: string;
  operator: string;
  expected: JsonValue | boolean;
  actual: unknown;
  passed: boolean;
  /** The minimal wire predicate fragment this leaf came from, for `VerificationError.closest`. */
  predicate: Predicate;
}

// --- entry points ------------------------------------------------------------------------------

/** Evaluates a predicate (or an implicit-AND predicate list) against one recorded request. */
export function evalPredicates(predicates: Predicate | Predicate[], request: RecordedRequest): boolean {
  const list = Array.isArray(predicates) ? predicates : [predicates];
  return list.every((p) => evalPredicate(p, request));
}

function evalPredicate(pred: Predicate, request: RecordedRequest): boolean {
  if (pred.and !== undefined) return pred.and.every((p) => evalPredicate(p, request));
  if (pred.or !== undefined) return pred.or.some((p) => evalPredicate(p, request));
  if (pred.not !== undefined) return !evalPredicate(pred.not, request);
  return evalLeafPredicate(pred, request).passed;
}

/**
 * Flattens a predicate (or list) into every leaf clause it's built from, regardless of how
 * `and`/`or`/`not` combine them — used for the "closest non-match" heuristic (highest fraction of
 * leaf clauses satisfied) and its rendering, not for the pass/fail verdict itself.
 */
export function collectLeafDetails(predicates: Predicate | Predicate[], request: RecordedRequest): LeafDetail[] {
  const list = Array.isArray(predicates) ? predicates : [predicates];
  const out: LeafDetail[] = [];
  const walk = (pred: Predicate): void => {
    if (pred.and !== undefined) {
      pred.and.forEach(walk);
      return;
    }
    if (pred.or !== undefined) {
      pred.or.forEach(walk);
      return;
    }
    if (pred.not !== undefined) {
      // A `not` clause contributes the NEGATION of its inner result. Flattening the inner leaves
      // as-is would score a satisfied `not` as failing (and render a ✓ on the very clause that
      // made the verification fail), so collapse the negated group into one honest leaf.
      const innerLeaves = collectLeafDetails(pred.not, request);
      const head = innerLeaves[0];
      out.push({
        field: head?.field ?? 'predicate',
        key: head?.key,
        operator: `not ${head?.operator ?? ''}`.trim(),
        expected: head?.expected ?? (pred.not as JsonValue),
        actual: head?.actual,
        passed: !evalPredicate(pred.not, request),
        predicate: pred,
      });
      return;
    }
    out.push(...evalLeafPredicate(pred, request).details);
  };
  list.forEach(walk);
  return out;
}

/** The non-matching request satisfying the highest fraction of leaf clauses; ties → most recent
 * (by `timestamp`, falling back to array position). `undefined` when nothing was recorded. */
export function computeClosest(
  predicates: Predicate | Predicate[],
  recorded: RecordedRequest[]
): { request: RecordedRequest; failures: Array<{ predicate: Predicate; actual: unknown }> } | undefined {
  let best: { request: RecordedRequest; index: number; fraction: number; leaves: LeafDetail[] } | undefined;
  recorded.forEach((request, index) => {
    const leaves = collectLeafDetails(predicates, request);
    const fraction = leaves.length === 0 ? 1 : leaves.filter((l) => l.passed).length / leaves.length;
    const better =
      best === undefined ||
      fraction > best.fraction ||
      (fraction === best.fraction && isMoreRecent(request, index, best.request, best.index));
    if (better) best = { request, index, fraction, leaves };
  });
  if (best === undefined) return undefined;
  return {
    request: best.request,
    failures: best.leaves.filter((l) => !l.passed).map((l) => ({ predicate: l.predicate, actual: l.actual })),
  };
}

function isMoreRecent(a: RecordedRequest, aIndex: number, b: RecordedRequest, bIndex: number): boolean {
  if (a.timestamp !== '' && b.timestamp !== '' && a.timestamp !== b.timestamp) {
    return a.timestamp > b.timestamp;
  }
  return aIndex > bIndex;
}

// --- leaf predicate evaluation -------------------------------------------------------------------

function evalLeafPredicate(pred: Predicate, request: RecordedRequest): { passed: boolean; details: LeafDetail[] } {
  if (pred.inject !== undefined) {
    throw new UnsupportedPredicateError('inject', 'inject predicates are not supported client-side (rift#494)');
  }
  if (pred.xpath !== undefined) {
    throw new UnsupportedPredicateError('xpath', 'xpath predicates are not supported client-side (rift#494)');
  }

  const params: MatchParams = {
    caseSensitive: pred.caseSensitive,
    keyCaseSensitive: pred.keyCaseSensitive,
    except: pred.except,
    jsonpath: pred.jsonpath,
  };

  if (pred.exists !== undefined) {
    const details = Object.entries(pred.exists).map(([field, expected]) => {
      const actual = fieldPresence(field, request);
      return leafDetail('exists', field, undefined, expected, actual, actual === expected);
    });
    return { passed: details.every((d) => d.passed), details };
  }

  const operator = KNOWN_OPERATORS.find((op) => pred[op] !== undefined);
  if (operator !== undefined) {
    const fieldMatch = pred[operator] as Record<string, JsonValue>;
    const details = expandFieldMatch(fieldMatch).map(({ field, key, expected }) =>
      evalField(operator, field, key, expected, request, params)
    );
    return { passed: details.every((d) => d.passed), details };
  }

  const keys = Object.keys(pred);
  // An empty predicate legitimately matches every request (mirrors an empty predicate list).
  if (keys.length === 0) return { passed: true, details: [] };
  const unknownKey = keys.find((k) => !NON_OPERATOR_KEYS.has(k));
  if (unknownKey !== undefined) {
    throw new UnsupportedPredicateError(unknownKey, `predicate operator "${unknownKey}" is not supported client-side`);
  }
  // Only modifier keys (jsonpath/except/caseSensitive/...) with no operator or `exists` — the
  // constraint would silently match EVERY request, turning verify() into a false positive. A
  // classifier that cannot evaluate its input must fail loudly, never match by default.
  throw new UnsupportedPredicateError(
    keys.join(','),
    `predicate has no operator — [${keys.join(', ')}] require an accompanying equals/contains/matches/exists clause`
  );
}

function expandFieldMatch(fieldMatch: Record<string, JsonValue>): Array<{ field: string; key?: string; expected: JsonValue }> {
  const out: Array<{ field: string; key?: string; expected: JsonValue }> = [];
  for (const [field, value] of Object.entries(fieldMatch)) {
    if ((field === 'headers' || field === 'query') && isPlainObject(value)) {
      for (const [key, v] of Object.entries(value)) out.push({ field, key, expected: v });
    } else {
      out.push({ field, expected: value });
    }
  }
  return out;
}

function evalField(
  operator: KnownOperator,
  field: string,
  key: string | undefined,
  expected: JsonValue,
  request: RecordedRequest,
  params: MatchParams
): LeafDetail {
  const keyCaseSensitive = params.keyCaseSensitive ?? false;
  const rawActual = lookupActual(field, key, request, keyCaseSensitive);
  const actual = params.jsonpath !== undefined ? applyJsonPath(params.jsonpath.selector, rawActual as JsonValue | undefined) : rawActual;

  let passed: boolean;
  if (field === 'body' && (operator === 'equals' || operator === 'deepEquals') && isComposite(expected) && params.jsonpath === undefined) {
    passed = compareBody(actual as JsonValue | undefined, expected, operator === 'deepEquals', params);
  } else if ((field === 'headers' || field === 'query') && Array.isArray(actual)) {
    passed = actual.some((v) => stringCompare(operator, toStr(v), toStr(expected), params));
  } else {
    passed = stringCompare(operator, toStr(actual as JsonValue | undefined), toStr(expected), params);
  }
  return leafDetail(operator, field, key, expected, actual, passed);
}

function leafDetail(
  operator: string,
  field: string,
  key: string | undefined,
  expected: JsonValue | boolean,
  actual: unknown,
  passed: boolean
): LeafDetail {
  const value = key !== undefined ? { [key]: expected } : expected;
  const predicate = { [operator]: { [field]: value } } as Predicate;
  return { field, key, operator, expected, actual, passed, predicate };
}

function fieldPresence(field: string, request: RecordedRequest): boolean {
  switch (field) {
    case 'method':
    case 'path':
      return true;
    case 'headers':
      return Object.keys(request.headers).length > 0;
    case 'query':
      return Object.keys(request.query).length > 0;
    case 'body':
      return request.body !== undefined;
    default:
      return false;
  }
}

function lookupActual(
  field: string,
  key: string | undefined,
  request: RecordedRequest,
  keyCaseSensitive: boolean
): unknown {
  switch (field) {
    case 'method':
      return request.method;
    case 'path':
      return request.path;
    case 'body':
      return request.body;
    case 'headers':
      return key !== undefined ? findKeyValue(request.headers, key, keyCaseSensitive) : undefined;
    case 'query':
      return key !== undefined ? findKeyValue(request.query, key, keyCaseSensitive) : undefined;
    default:
      return undefined;
  }
}

function findKeyValue(
  obj: Record<string, string | string[]>,
  key: string,
  keyCaseSensitive: boolean
): string | string[] | undefined {
  if (keyCaseSensitive) return obj[key];
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(obj)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

function findObjectKey(obj: Record<string, JsonValue>, key: string, keyCaseSensitive: boolean): string | undefined {
  if (keyCaseSensitive) return key in obj ? key : undefined;
  const lower = key.toLowerCase();
  return Object.keys(obj).find((k) => k.toLowerCase() === lower);
}

// --- body comparison: field-wise containment (equals) vs exact structural equality (deepEquals) --

function isPlainObject(v: unknown): v is Record<string, JsonValue> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isComposite(v: JsonValue): boolean {
  return v !== null && typeof v === 'object';
}

function compareBody(actual: JsonValue | undefined, expected: JsonValue, exact: boolean, params: MatchParams): boolean {
  if (expected === null) return actual === null;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false;
    if (exact && actual.length !== expected.length) return false;
    if (!exact && expected.length > actual.length) return false;
    return expected.every((v, i) => compareBody(actual[i], v, exact, params));
  }
  if (isPlainObject(expected)) {
    if (!isPlainObject(actual)) return false;
    const expectedEntries = Object.entries(expected);
    if (exact && Object.keys(actual).length !== expectedEntries.length) return false;
    return expectedEntries.every(([k, v]) => {
      const foundKey = findObjectKey(actual, k, params.keyCaseSensitive ?? false);
      return foundKey !== undefined && compareBody(actual[foundKey], v, exact, params);
    });
  }
  if (typeof expected === 'string') return stringCompare('equals', toStr(actual), expected, params);
  return actual === expected;
}

// --- string-level comparison ---------------------------------------------------------------------

function toStr(v: JsonValue | undefined): string {
  if (v === undefined) return '';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

function applyExcept(s: string, except: string | undefined): string {
  return except === undefined ? s : s.replace(new RegExp(except, 'g'), '');
}

function stringCompare(operator: KnownOperator, actualRaw: string, expectedRaw: string, params: MatchParams): boolean {
  const actual = applyExcept(actualRaw, params.except);
  if (operator === 'matches') {
    const flags = params.caseSensitive === true ? '' : 'i';
    return new RegExp(expectedRaw, flags).test(actual);
  }
  const caseSensitive = params.caseSensitive === true;
  const a = caseSensitive ? actual : actual.toLowerCase();
  const e = caseSensitive ? expectedRaw : expectedRaw.toLowerCase();
  switch (operator) {
    case 'equals':
    case 'deepEquals':
      return a === e;
    case 'contains':
      return a.includes(e);
    case 'startsWith':
      return a.startsWith(e);
    case 'endsWith':
      return a.endsWith(e);
    default:
      return a === e;
  }
}

// --- hand-rolled JSONPath subset: dot + bracket + numeric index -----------------------------------

type PathSegment = { type: 'key'; name: string } | { type: 'index'; index: number };

function parseJsonPath(selector: string): PathSegment[] {
  if (!selector.startsWith('$')) {
    throw new UnsupportedPredicateError('jsonpath', `JSONPath selector "${selector}" must start with "$"`);
  }
  const segments: PathSegment[] = [];
  let i = 1;
  while (i < selector.length) {
    const c = selector[i];
    if (c === '.') {
      if (selector[i + 1] === '.') {
        throw new UnsupportedPredicateError('jsonpath', `recursive descent is not supported in selector "${selector}"`);
      }
      i++;
      let name = '';
      while (i < selector.length && selector[i] !== '.' && selector[i] !== '[') {
        name += selector[i];
        i++;
      }
      if (name === '*') {
        throw new UnsupportedPredicateError('jsonpath', `wildcard is not supported in selector "${selector}"`);
      }
      if (name === '') {
        throw new UnsupportedPredicateError('jsonpath', `malformed selector "${selector}"`);
      }
      segments.push({ type: 'key', name });
    } else if (c === '[') {
      const close = selector.indexOf(']', i);
      if (close === -1) throw new UnsupportedPredicateError('jsonpath', `malformed selector "${selector}"`);
      const inner = selector.slice(i + 1, close);
      if (/^\d+$/.test(inner)) {
        segments.push({ type: 'index', index: Number(inner) });
      } else if (/^'[^']*'$/.test(inner) || /^"[^"]*"$/.test(inner)) {
        segments.push({ type: 'key', name: inner.slice(1, -1) });
      } else if (inner === '*') {
        throw new UnsupportedPredicateError('jsonpath', `wildcard is not supported in selector "${selector}"`);
      } else if (inner.startsWith('?')) {
        throw new UnsupportedPredicateError('jsonpath', `filter expressions are not supported in selector "${selector}"`);
      } else {
        throw new UnsupportedPredicateError('jsonpath', `unsupported segment "[${inner}]" in selector "${selector}"`);
      }
      i = close + 1;
    } else {
      throw new UnsupportedPredicateError('jsonpath', `malformed selector "${selector}"`);
    }
  }
  return segments;
}

function applyJsonPath(selector: string, value: JsonValue | undefined): JsonValue | undefined {
  const segments = parseJsonPath(selector);
  let current: JsonValue | undefined = value;
  for (const seg of segments) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    if (seg.type === 'index') {
      if (!Array.isArray(current)) return undefined;
      current = current[seg.index];
    } else {
      if (Array.isArray(current)) return undefined;
      current = current[seg.name];
    }
  }
  return current;
}
