/**
 * Fluent stub builder + method-seeded entry points (`onGet`, `onPost`, ...).
 */

import type { Predicate, Stub, StubResponse } from '../model/index.js';
import type { ResponseBuilder } from './response.js';

export class StubBuilder {
  private readonly predicateList: Predicate[] = [];
  private responseList: StubResponse[] = [];

  constructor(seed?: Predicate) {
    if (seed !== undefined) this.predicateList.push(seed);
  }

  /** Appends another predicate; multiple `.when()` calls accumulate as an implicit AND. */
  when(predicate: Predicate): this {
    this.predicateList.push(predicate);
    return this;
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
    return out;
  }
}

/** Bare stub with no seeded predicate. */
export function stub(): StubBuilder {
  return new StubBuilder();
}

/** Predicate for an explicit method + path, without a `method`/`path`-seeded helper. */
export function on(method: string, path: string): StubBuilder {
  return new StubBuilder({ equals: { method, path } });
}

/** Predicate matching only on `path` (any method). */
export function onAny(path: string): StubBuilder {
  return new StubBuilder({ equals: { path } });
}

export function onGet(path: string): StubBuilder {
  return on('GET', path);
}

export function onPost(path: string): StubBuilder {
  return on('POST', path);
}

export function onPut(path: string): StubBuilder {
  return on('PUT', path);
}

export function onDelete(path: string): StubBuilder {
  return on('DELETE', path);
}

export function onPatch(path: string): StubBuilder {
  return on('PATCH', path);
}

export function onHead(path: string): StubBuilder {
  return on('HEAD', path);
}

export function onOptions(path: string): StubBuilder {
  return on('OPTIONS', path);
}
