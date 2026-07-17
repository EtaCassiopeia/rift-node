/**
 * Gate for issue #22 — field-agnostic matcher grammar + predicate composition + path params.
 * Pins the exact wire JSON each matcher/binder/refiner compiles to (design #20 §5.1–5.3).
 */

import {
  equals,
  deepEquals,
  contains,
  startsWith,
  endsWith,
  matches,
  exists,
  notExists,
  req,
  and,
  or,
  not,
  injectPredicate,
  onGet,
  onPost,
  stub,
} from '../../src/dsl/index.js';
import type { Predicate } from '../../src/model/index.js';
import type { PathParams } from '../../src/dsl/stub.js';

type Expect<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

describe('issue #22 — matchers compile to wire predicates when bound to a field', () => {
  it('bare operators via req.header/body/query/method/path', () => {
    expect(req.header('Accept', contains('json'))).toEqual({ contains: { headers: { Accept: 'json' } } });
    expect(req.body(equals('x'))).toEqual({ equals: { body: 'x' } });
    expect(req.method(equals('GET'))).toEqual({ equals: { method: 'GET' } });
    expect(req.query('page', equals('2'))).toEqual({ equals: { query: { page: '2' } } });
    expect(req.path(startsWith('/api'))).toEqual({ startsWith: { path: '/api' } });
    expect(req.body(deepEquals({ a: 1 }))).toEqual({ deepEquals: { body: { a: 1 } } });
    expect(req.path(endsWith('.json'))).toEqual({ endsWith: { path: '.json' } });
    expect(req.path(matches('^/u/\\d+$'))).toEqual({ matches: { path: '^/u/\\d+$' } });
  });

  it('exists / notExists', () => {
    expect(req.query('page', exists())).toEqual({ exists: { query: { page: true } } });
    expect(req.path(notExists())).toEqual({ exists: { path: false } });
  });

  it('a bare string/object means equals', () => {
    expect(req.path('/exact')).toEqual({ equals: { path: '/exact' } });
    expect(req.body({ a: 1 })).toEqual({ equals: { body: { a: 1 } } });
  });

  it('modifiers: caseSensitive, keyCaseSensitive, except, jsonpath, xpath', () => {
    expect(req.header('Accept', contains('json').caseSensitive())).toEqual({
      contains: { headers: { Accept: 'json' } },
      caseSensitive: true,
    });
    expect(req.body(equals('admin').jsonpath('$.user.role'))).toEqual({
      equals: { body: 'admin' },
      jsonpath: { selector: '$.user.role' },
    });
    expect(req.body(equals('ok').xpath('//ns:status', { ns: 'http://example.com' }))).toEqual({
      equals: { body: 'ok' },
      xpath: { selector: '//ns:status', ns: { ns: 'http://example.com' } },
    });
    expect(req.path(matches('/x').except('\\d+'))).toEqual({ matches: { path: '/x' }, except: '\\d+' });
    expect(req.header('K', equals('v').keyCaseSensitive())).toEqual({
      equals: { headers: { K: 'v' } },
      keyCaseSensitive: true,
    });
  });

  it('matches and except accept a RegExp (using its .source)', () => {
    expect(req.path(matches(/^\/u\/\d+$/))).toEqual({ matches: { path: '^\\/u\\/\\d+$' } });
    expect(req.path(matches('/x').except(/\d+/))).toEqual({ matches: { path: '/x' }, except: '\\d+' });
  });

  it('matcher modifiers are immutable (do not mutate a shared matcher)', () => {
    const base = contains('json');
    const cs = base.caseSensitive();
    expect(req.header('A', base)).toEqual({ contains: { headers: { A: 'json' } } });
    expect(req.header('A', cs)).toMatchObject({ caseSensitive: true });
  });
});

describe('issue #22 — composition', () => {
  it('and / or / not', () => {
    const p = and(req.method(equals('GET')), req.path(startsWith('/v1')));
    expect(p).toEqual({ and: [{ equals: { method: 'GET' } }, { startsWith: { path: '/v1' } }] });
    expect(or(req.path('/a'), req.path('/b')) as Predicate).toHaveProperty('or');
    expect(not(req.path('/x'))).toEqual({ not: { equals: { path: '/x' } } });
  });

  it('injectPredicate emits an inject predicate', () => {
    expect(injectPredicate('function (config) { return true; }')).toEqual({
      inject: 'function (config) { return true; }',
    });
  });
});

describe('issue #22 — StubBuilder refiners', () => {
  it('withHeader/withMethod/withPath/withBody/withQuery each AND a predicate', () => {
    const s = stub()
      .withMethod(equals('POST'))
      .withPath(startsWith('/api'))
      .withHeader('content-type', contains('json'))
      .withBody(deepEquals({ ok: true }))
      .withQuery('page', equals('2'))
      .build();
    expect(s.predicates).toEqual([
      { equals: { method: 'POST' } },
      { startsWith: { path: '/api' } },
      { contains: { headers: { 'content-type': 'json' } } },
      { deepEquals: { body: { ok: true } } },
      { equals: { query: { page: '2' } } },
    ]);
  });
});

describe('issue #22 — path parameters in openers', () => {
  it('a :param path compiles to routePattern + anchored regex path predicate (method kept)', () => {
    const s = onGet('/users/:id/orders/:orderId').willReturn().build();
    expect(s.route_pattern).toBe('/users/:id/orders/:orderId');
    expect((s as Record<string, unknown>)['routePattern']).toBeUndefined();
    // one equals(method) predicate AND one matches(path) predicate
    const preds = s.predicates ?? [];
    expect(preds).toContainEqual({ equals: { method: 'GET' } });
    expect(preds).toContainEqual({ matches: { path: '^/users/[^/]+/orders/[^/]+$' } });
  });

  it('literal segments are regex-escaped (dots do not become wildcards)', () => {
    const s = onGet('/v1.0/:id').willReturn().build();
    const preds = s.predicates ?? [];
    expect(preds).toContainEqual({ matches: { path: '^/v1\\.0/[^/]+$' } });
  });

  it('{ params: false } treats : as a literal (no routePattern, exact path)', () => {
    const s = onPost('/a/:notparam', { params: false }).willReturn().build();
    expect((s as Record<string, unknown>)['route_pattern']).toBeUndefined();
    expect((s as Record<string, unknown>)['routePattern']).toBeUndefined();
    const preds = s.predicates ?? [];
    expect(preds).toContainEqual({ equals: { path: '/a/:notparam' } });
  });

  it('a plain path (no params) still seeds an exact method+path match', () => {
    const s = onGet('/health').willReturn().build();
    const preds = s.predicates ?? [];
    expect(preds).toContainEqual({ equals: { method: 'GET' } });
    expect(preds.some((p) => JSON.stringify(p).includes('/health'))).toBe(true);
  });

  it('PathParams<P> extracts only whole :segment params (compile-time)', () => {
    // A false Equal makes Expect<false> violate `T extends true`, failing tsc under ts-jest.
    const checks: [
      Expect<Equal<PathParams<'/users/:id/orders/:orderId'>, { id: string; orderId: string }>>,
      Expect<Equal<PathParams<'/health'>, Record<never, string>>>,
      // mid-segment colon is NOT a param — mirrors the runtime router (the type/runtime alignment fix)
      Expect<Equal<PathParams<'/files/v:id'>, Record<never, string>>>,
      Expect<Equal<PathParams<'/time/12:30'>, Record<never, string>>>,
    ] = [true, true, true, true];
    expect(checks).toHaveLength(4);
  });
});
