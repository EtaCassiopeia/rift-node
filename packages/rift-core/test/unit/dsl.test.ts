/**
 * Fluent DSL gate (issue #3)
 *
 * Chainable builders that produce the typed wire model from #2. The gate pins:
 *  - the RFC §12 sample builds the EXACT wire imposter it should (acceptance #1);
 *  - each response / predicate / behavior / scenario-FSM builder emits known wire;
 *  - every DSL-built imposter validates through `fromJson` and round-trips identically;
 *  - corpus accountability (acceptance #2): every rift example fixture is either expressible
 *    via the DSL (rebuilt + asserted) or explicitly documented as `fromJson`-only.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fromJson, toWireJson } from '../../src/model/index.js';
import {
  imposter,
  onGet,
  onPost,
  on,
  onAny,
  stub,
  okJson,
  ok,
  created,
  status,
  json,
  text,
  notFound,
  noContent,
  onPut,
  onDelete,
  equals,
  deepEquals,
  matches,
  and,
  or,
  not,
  exists,
  req,
  scenario,
  fault,
  proxyTo,
  inject,
} from '../../src/dsl/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, '..', 'fixtures', 'mb');

describe('DSL — RFC §12 sample builds the exact wire imposter', () => {
  it('compiles as written and produces the expected wire model', () => {
    const users = imposter('users')
      .record()
      .stub(onGet('/api/users/1').willReturn(okJson({ id: 1, name: 'Alice' })))
      .stub(onPost('/api/users').willReturn(created().latency(50), status(503)));

    expect(toWireJson(users.build())).toEqual({
      name: 'users',
      recordRequests: true,
      stubs: [
        {
          predicates: [{ equals: { method: 'GET' } }, { equals: { path: '/api/users/1' } }],
          responses: [
            {
              is: {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: { id: 1, name: 'Alice' },
              },
            },
          ],
        },
        {
          predicates: [{ equals: { method: 'POST' } }, { equals: { path: '/api/users' } }],
          responses: [
            { is: { statusCode: 201 }, _behaviors: { wait: 50 } },
            { is: { statusCode: 503 } },
          ],
        },
      ],
    });
  });
});

describe('DSL — response builders', () => {
  it('okJson sets 200 + application/json + body', () => {
    expect(okJson({ a: 1 }).build()).toEqual({
      is: { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: { a: 1 } },
    });
  });
  it('ok / created / status / notFound / noContent status codes', () => {
    expect(ok().build()).toEqual({ is: { statusCode: 200 } });
    expect(ok('hi').build()).toEqual({ is: { statusCode: 200, body: 'hi' } });
    expect(created().build()).toEqual({ is: { statusCode: 201 } });
    expect(status(503).build()).toEqual({ is: { statusCode: 503 } });
    expect(notFound().build()).toEqual({ is: { statusCode: 404 } });
    expect(noContent().build()).toEqual({ is: { statusCode: 204 } });
  });
  it('json / text set content-type', () => {
    expect(json(422, { e: 'bad' }).build()).toEqual({
      is: { statusCode: 422, headers: { 'Content-Type': 'application/json' }, body: { e: 'bad' } },
    });
    expect(text(200, 'pong').build()).toEqual({
      is: { statusCode: 200, headers: { 'Content-Type': 'text/plain' }, body: 'pong' },
    });
  });
  it('response modifiers: header, latency, repeat, fault', () => {
    expect(okJson({ a: 1 }).header('X-Trace', 'abc').build()).toEqual({
      is: {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'X-Trace': 'abc' },
        body: { a: 1 },
      },
    });
    expect(status(200).latency(250).build()).toEqual({
      is: { statusCode: 200 },
      _behaviors: { wait: 250 },
    });
    expect(status(200).repeat(3).build()).toEqual({
      is: { statusCode: 200 },
      _behaviors: { repeat: 3 },
    });
    expect(status(200).fault('ECONNRESET').build()).toEqual({
      is: { statusCode: 200 },
      _rift: { fault: { tcp: 'ECONNRESET' } },
    });
  });
});

describe('DSL — predicate entry + helpers', () => {
  it('method helpers seed separate equals(method) + equals(path) predicates', () => {
    expect(onGet('/x').willReturn(ok()).build().predicates).toEqual([
      { equals: { method: 'GET' } },
      { equals: { path: '/x' } },
    ]);
    expect(onPost('/y').willReturn(ok()).build().predicates).toEqual([
      { equals: { method: 'POST' } },
      { equals: { path: '/y' } },
    ]);
    expect(on('DELETE', '/z').willReturn(ok()).build().predicates).toEqual([
      { equals: { method: 'DELETE' } },
      { equals: { path: '/z' } },
    ]);
    expect(onAny('/any').willReturn(ok()).build().predicates).toEqual([
      { equals: { path: '/any' } },
    ]);
  });
  it('bare stub().when() adds explicit predicates; and/or/not/matches/exists helpers', () => {
    const s = stub()
      .when(and(req.method(equals('GET')), req.path(matches('/u/\\d+'))))
      .willReturn(okJson({ id: 1 }))
      .build();
    expect(s.predicates).toEqual([
      { and: [{ equals: { method: 'GET' } }, { matches: { path: '/u/\\d+' } }] },
    ]);
    expect(or(req.method(equals('PUT')), req.method(equals('PATCH')))).toEqual({
      or: [{ equals: { method: 'PUT' } }, { equals: { method: 'PATCH' } }],
    });
    expect(not(req.path(exists()))).toEqual({ not: { exists: { path: true } } });
  });
  it('multiple .when() calls accumulate as separate predicates (implicit AND)', () => {
    const s = onGet('/x').when(req.header('Authorization', exists())).willReturn(ok()).build();
    expect(s.predicates).toEqual([
      { equals: { method: 'GET' } },
      { equals: { path: '/x' } },
      { exists: { headers: { Authorization: true } } },
    ]);
  });
});

describe('DSL — response cycling', () => {
  it('willReturn with multiple responses cycles them', () => {
    const s = onGet('/flap').willReturn(ok('a'), status(500), ok('b')).build();
    expect(s.responses).toEqual([
      { is: { statusCode: 200, body: 'a' } },
      { is: { statusCode: 500 } },
      { is: { statusCode: 200, body: 'b' } },
    ]);
  });
});

describe('DSL — fault / proxy / inject builders', () => {
  it('fault() builds a tcp fault response', () => {
    expect(fault('ETIMEDOUT').build()).toEqual({ _rift: { fault: { tcp: 'ETIMEDOUT' } } });
  });
  it('proxyTo() builds a proxy response', () => {
    expect(proxyTo('http://up', { mode: 'proxyOnce' }).build()).toEqual({
      proxy: { to: 'http://up', mode: 'proxyOnce' },
    });
  });
  it('inject() builds an inject response', () => {
    expect(inject('function (req) { return { statusCode: 200 }; }').build()).toEqual({
      inject: 'function (req) { return { statusCode: 200 }; }',
    });
  });
});

describe('DSL — scenario FSM builder', () => {
  it('builds stubs with scenarioName + required/new scenario state', () => {
    const stubs = scenario('checkout')
      .startingAt('empty')
      .when('empty', onPost('/cart')).respond(created()).goTo('has-items')
      .when('has-items', onPost('/checkout')).respond(ok('done')).goTo('done')
      .build();

    expect(stubs).toEqual([
      {
        scenarioName: 'checkout',
        required_scenario_state: 'empty',
        new_scenario_state: 'has-items',
        predicates: [{ equals: { method: 'POST' } }, { equals: { path: '/cart' } }],
        responses: [{ is: { statusCode: 201 } }],
      },
      {
        scenarioName: 'checkout',
        required_scenario_state: 'has-items',
        new_scenario_state: 'done',
        predicates: [{ equals: { method: 'POST' } }, { equals: { path: '/checkout' } }],
        responses: [{ is: { statusCode: 200, body: 'done' } }],
      },
    ]);
  });
});

describe('DSL — output always validates + round-trips through the wire model', () => {
  it('every built imposter passes fromJson and re-serializes identically', () => {
    const imp = imposter('rt')
      .port(3000)
      .stub(onGet('/a').willReturn(okJson({ x: 1 })))
      .stub(onPost('/b').willReturn(created().latency(10), status(503)))
      .build();
    const wire = toWireJson(imp);
    expect(toWireJson(fromJson(wire))).toEqual(wire);
  });
});

describe('DSL — conformance corpus accountability (acceptance #2)', () => {
  // Every rift example fixture is EITHER expressible via the DSL (rebuilt + asserted) OR
  // explicitly documented as fromJson-only. Broader byte-exact corpus coverage is #7.
  // Accurate capability limits only — a fixture is fromJson-only iff it needs a wire feature
  // the DSL does not (yet) expose as a builder.
  const FROMJSON_ONLY: Record<string, string> = {
    'authentication-api.json': 'stub-level scenarioName grouping (no FSM transition) — no builder method',
    'feature-flags-api.json': 'stub-level scenarioName grouping (no FSM transition) — no builder method',
    'task-management-api.json': 'jsonpath selector predicates — no jsonpath builder helper',
    'latency-testing.json': 'wait:{inject} random-delay behavior — latency() takes a fixed number only',
  };

  it('rebuilds basic-api.json exactly via the DSL', () => {
    const original = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'basic-api.json'), 'utf8'));
    // basic-api.json is a captured real-world Mountebank fixture that pairs method+path into a
    // single `equals` predicate (rather than the DSL openers' new split predicates) — reproduced
    // here via the raw-predicate escape hatch (`when(literal)`) to keep the byte-exact rebuild.
    const built = {
      imposters: [
        imposter('Basic REST API')
          .port(4545)
          .protocol('http')
          .stub(
            stub()
              .when({ equals: { method: 'GET', path: '/health' } })
              .willReturn(status(200, 'OK'))
          )
          .stub(
            stub()
              .when({ equals: { method: 'GET', path: '/api/users' } })
              .willReturn(
                okJson([
                  { id: 1, name: 'Alice' },
                  { id: 2, name: 'Bob' },
                ])
              )
          )
          .stub(
            stub()
              .when(and(req.method(equals('GET')), req.path(matches('/api/users/\\d+'))))
              .willReturn(okJson({ id: 1, name: 'Alice', email: 'alice@example.com' }))
          )
          .stub(
            stub()
              .when({ equals: { method: 'POST', path: '/api/users' } })
              .willReturn(okJson({ id: 999, message: 'Created' }).status(201))
          )
          .build(),
      ],
    };
    expect(toWireJson(built)).toEqual(original);
  });

  it('rebuilds error-testing.json exactly via the DSL', () => {
    const original = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, 'error-testing.json'), 'utf8')
    );
    const err = json;
    const built = {
      imposters: [
        imposter('Error Testing')
          .port(4545)
          .protocol('http')
          .stub(onAny('/success').willReturn(err(200, { status: 'ok' })))
          .stub(onAny('/error/400').willReturn(err(400, { error: 'Bad Request', code: 'INVALID_INPUT' })))
          .stub(
            onAny('/error/401').willReturn(
              err(401, { error: 'Unauthorized' }).header('WWW-Authenticate', 'Bearer realm="api"')
            )
          )
          .stub(onAny('/error/403').willReturn(err(403, { error: 'Forbidden' })))
          .stub(onAny('/error/404').willReturn(err(404, { error: 'Not Found' })))
          .stub(
            onAny('/error/429').willReturn(
              err(429, { error: 'Too Many Requests', retry_after: 60 }).header('Retry-After', '60')
            )
          )
          .stub(onAny('/error/500').willReturn(err(500, { error: 'Internal Server Error' })))
          .stub(onAny('/error/502').willReturn(err(502, { error: 'Bad Gateway' })))
          .stub(
            onAny('/error/503').willReturn(
              err(503, { error: 'Service Unavailable' }).header('Retry-After', '30')
            )
          )
          .stub(onAny('/error/504').willReturn(err(504, { error: 'Gateway Timeout' })))
          .build(),
      ],
    };
    expect(toWireJson(built)).toEqual(original);
  });

  it('accounts for every fixture (expressible or documented fromJson-only)', () => {
    const files = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.json'));
    const rebuildable = new Set(['basic-api.json', 'error-testing.json']);
    for (const f of files) {
      const accounted = rebuildable.has(f) || f in FROMJSON_ONLY;
      expect(accounted).toBe(true);
    }
    // Documented fromJson-only fixtures are genuinely loadable via the escape hatch.
    for (const f of Object.keys(FROMJSON_ONLY)) {
      const text = fs.readFileSync(path.join(fixturesDir, f), 'utf8');
      expect(() => fromJson(text)).not.toThrow();
    }
  });
});

describe('DSL — additional builder coverage', () => {
  it('deepEquals matcher binds via req.method', () => {
    expect(req.method(deepEquals('GET'))).toEqual({ deepEquals: { method: 'GET' } });
  });

  it('onPut / onDelete seed the right method', () => {
    expect(onPut('/x').willReturn(ok()).build().predicates).toEqual([
      { equals: { method: 'PUT' } },
      { equals: { path: '/x' } },
    ]);
    expect(onDelete('/x').willReturn(noContent()).build().predicates).toEqual([
      { equals: { method: 'DELETE' } },
      { equals: { path: '/x' } },
    ]);
  });

  it('imposter flags: allowCORS / recordMatches / host / protocol', () => {
    expect(
      imposter('m').port(4547).protocol('https').host('127.0.0.1').allowCORS().recordMatches().build()
    ).toEqual({
      name: 'm',
      port: 4547,
      protocol: 'https',
      host: '127.0.0.1',
      allowCORS: true,
      recordMatches: true,
    });
  });

  it('imposter without protocol omits the key (no silent default)', () => {
    expect(imposter('p').port(25).build()).toEqual({ name: 'p', port: 25 });
  });

  it('defaultResponse with an is-response is set; proxy/inject/fault throw', () => {
    expect(imposter('d').defaultResponse(notFound()).build().defaultResponse).toEqual({
      statusCode: 404,
    });
    expect(() => imposter('d').defaultResponse(proxyTo('http://up'))).toThrow();
    expect(() => imposter('d').defaultResponse(inject('f'))).toThrow();
    expect(() => imposter('d').defaultResponse(fault('ECONNRESET'))).toThrow();
  });

  it('respond() is an alias of willReturn(); headers() merges plural', () => {
    expect(onGet('/x').respond(ok('a'), status(500)).build().responses).toEqual([
      { is: { statusCode: 200, body: 'a' } },
      { is: { statusCode: 500 } },
    ]);
    expect(status(200).headers({ A: '1', B: '2' }).build()).toEqual({
      is: { statusCode: 200, headers: { A: '1', B: '2' } },
    });
  });
});

describe('DSL — scenario FSM robustness', () => {
  it('keeps a terminal state that has no goTo() (no silent drop)', () => {
    const stubs = scenario('s')
      .startingAt('a')
      .when('a', onPost('/x')).respond(created()).goTo('b')
      .when('b', onGet('/y')).respond(ok('done')) // terminal: no goTo
      .build();
    expect(stubs).toEqual([
      {
        scenarioName: 's',
        required_scenario_state: 'a',
        new_scenario_state: 'b',
        predicates: [{ equals: { method: 'POST' } }, { equals: { path: '/x' } }],
        responses: [{ is: { statusCode: 201 } }],
      },
      {
        scenarioName: 's',
        required_scenario_state: 'b',
        predicates: [{ equals: { method: 'GET' } }, { equals: { path: '/y' } }],
        responses: [{ is: { statusCode: 200, body: 'done' } }],
      },
    ]);
  });

  it('throws on respond()/goTo() without a preceding when()', () => {
    expect(() => scenario('s').respond(ok())).toThrow();
    expect(() => scenario('s').goTo('x')).toThrow();
  });

  it('throws when startingAt() disagrees with the first when() state', () => {
    expect(() =>
      scenario('s').startingAt('empty').when('start', onGet('/x')).respond(ok()).build()
    ).toThrow();
  });
});
