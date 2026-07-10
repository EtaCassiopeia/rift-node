/**
 * Fluent stub builder + method-seeded entry points (`onGet`, `onPost`, ...).
 *
 * A path containing `:name` segments seeds BOTH the stub-level `route_pattern` (raw path, for
 * extraction — Rift's `route_pattern` never matches by itself) AND a derived anchored regex
 * `matches` predicate on `path`. Literal paths (or `{ params: false }`) seed a plain `equals`
 * predicate instead. Method-bound openers always AND a separate `equals(method)` predicate —
 * method and path are kept as two predicates, never combined into one `equals`.
 */

import type { Predicate, Stub, StubResponse } from '../model/index.js';
import type { ResponseBuilder } from './response.js';
import type { Matcher } from './matcher.js';
import { req } from './predicate.js';

export interface PathOpts {
  /** `false` treats `:` as a literal character instead of a param marker. Default `true`. */
  params?: boolean;
}

// Only whole `/:name` segments are params — this mirrors the runtime rule (`PARAM_SEGMENT`), so a
// mid-segment colon (`/files/v:id`, `/time/12:30`) yields no param, exactly as the router treats it.
type ParamKeys<P extends string> = P extends `${string}/:${infer Param}/${infer Rest}`
  ? Param | ParamKeys<`/${Rest}`>
  : P extends `${string}/:${infer Param}`
    ? Param
    : never;

/** Extracts `:name` path segments into a `{ [name]: string }` shape — compile-time only. */
export type PathParams<P extends string> = { [K in ParamKeys<P>]: string };

const PARAM_SEGMENT = /^:(.+)$/;
const REGEX_METACHARS = /[.*+?^${}()|[\]\\]/g;

function escapeRegExp(segment: string): string {
  return segment.replace(REGEX_METACHARS, '\\$&');
}

function hasPathParams(path: string): boolean {
  return path.split('/').some((segment) => PARAM_SEGMENT.test(segment));
}

/** Anchored regex for a `:name`-templated path; literal segments are regex-escaped. */
function pathToAnchoredRegex(path: string): string {
  const pattern = path
    .split('/')
    .map((segment) => (PARAM_SEGMENT.test(segment) ? '[^/]+' : escapeRegExp(segment)))
    .join('/');
  return `^${pattern}$`;
}

/** Seeds the method/path predicates (+ optional route_pattern) for a stub opener. */
function seedPath(
  path: string,
  opts: PathOpts | undefined,
  method?: string
): { predicates: Predicate[]; routePattern?: string } {
  const predicates: Predicate[] = [];
  if (method !== undefined) predicates.push({ equals: { method } });
  if (opts?.params !== false && hasPathParams(path)) {
    predicates.push({ matches: { path: pathToAnchoredRegex(path) } });
    return { predicates, routePattern: path };
  }
  predicates.push({ equals: { path } });
  return { predicates };
}

export class StubBuilder<P = Record<string, never>> {
  /** Phantom marker: carries `P` for editor hints only, never assigned or read at runtime. */
  declare readonly __params?: P;
  private readonly predicateList: Predicate[] = [];
  private responseList: StubResponse[] = [];
  private readonly routePatternValue: string | undefined;

  constructor(seeds?: Predicate[], routePattern?: string) {
    if (seeds !== undefined) this.predicateList.push(...seeds);
    this.routePatternValue = routePattern;
  }

  /** Appends another predicate; multiple calls accumulate as an implicit AND. */
  when(predicate: Predicate): this {
    this.predicateList.push(predicate);
    return this;
  }

  withMethod(m: string | Matcher): this {
    return this.when(req.method(m));
  }

  withPath(m: string | Matcher): this {
    return this.when(req.path(m));
  }

  withBody(m: string | object | Matcher): this {
    return this.when(req.body(m));
  }

  withHeader(name: string, m: string | Matcher): this {
    return this.when(req.header(name, m));
  }

  withQuery(name: string, m: string | number | Matcher): this {
    return this.when(req.query(name, m));
  }

  /** Sets the response cycle. Multiple responses are cycled by the engine in call order. */
  willReturn(...responses: ResponseBuilder[]): this {
    this.responseList = responses.map((r) => r.build());
    return this;
  }

  /** Alias of {@link willReturn}. */
  respond(...responses: ResponseBuilder[]): this {
    return this.willReturn(...responses);
  }

  build(): Stub {
    const out: Stub = {};
    if (this.predicateList.length > 0) out.predicates = [...this.predicateList];
    if (this.responseList.length > 0) out.responses = [...this.responseList];
    if (this.routePatternValue !== undefined) out.route_pattern = this.routePatternValue;
    return out;
  }
}

/** Bare stub with no seeded predicate. */
export function stub(): StubBuilder {
  return new StubBuilder();
}

/** Predicate for an explicit method + path, without a `method`/`path`-seeded helper. */
export function on<P extends string>(
  method: string,
  path: P,
  opts?: PathOpts
): StubBuilder<PathParams<P>> {
  const { predicates, routePattern } = seedPath(path, opts, method);
  return new StubBuilder(predicates, routePattern);
}

/** Predicate matching only on `path` (any method). */
export function onAny<P extends string>(path: P, opts?: PathOpts): StubBuilder<PathParams<P>> {
  const { predicates, routePattern } = seedPath(path, opts);
  return new StubBuilder(predicates, routePattern);
}

export function onGet<P extends string>(path: P, opts?: PathOpts): StubBuilder<PathParams<P>> {
  return on('GET', path, opts);
}

export function onPost<P extends string>(path: P, opts?: PathOpts): StubBuilder<PathParams<P>> {
  return on('POST', path, opts);
}

export function onPut<P extends string>(path: P, opts?: PathOpts): StubBuilder<PathParams<P>> {
  return on('PUT', path, opts);
}

export function onDelete<P extends string>(path: P, opts?: PathOpts): StubBuilder<PathParams<P>> {
  return on('DELETE', path, opts);
}

export function onPatch<P extends string>(path: P, opts?: PathOpts): StubBuilder<PathParams<P>> {
  return on('PATCH', path, opts);
}

export function onHead<P extends string>(path: P, opts?: PathOpts): StubBuilder<PathParams<P>> {
  return on('HEAD', path, opts);
}

export function onOptions<P extends string>(
  path: P,
  opts?: PathOpts
): StubBuilder<PathParams<P>> {
  return on('OPTIONS', path, opts);
}
