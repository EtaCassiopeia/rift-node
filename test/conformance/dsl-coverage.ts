/**
 * DSL expressibility coverage for the conformance corpus (issue #7).
 *
 * `dslCoverage` maps a fixture file name to a builder that reconstructs it — `conformance.test.ts`
 * asserts `normalize(toWireJson({ imposters: [build()] })) deepEquals normalize(fixtureJson)`.
 * `fromJsonOnly` documents fixtures the DSL cannot (yet) express, with the specific wire feature
 * missing a builder. This is an accountability gate, not a backlog: adding a DSL method to close a
 * `fromJsonOnly` gap is out of scope for this issue (it belongs to the DSL issue named in the
 * reason string) — this module only has to keep the map honest as the DSL grows.
 */

import type { Imposter } from '../../src/model/index.js';
import {
  and,
  equals,
  imposter,
  json,
  matches,
  okJson,
  req,
  status,
  stub,
  type ImposterBuilder,
} from '../../src/dsl/index.js';

function basicApi(): Imposter {
  return imposter('Basic REST API')
    .port(4545)
    .protocol('http')
    .stub(stub().when({ equals: { method: 'GET', path: '/health' } }).willReturn(status(200, 'OK')))
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
    .build();
}

function errorTesting(): Imposter {
  const err = json;
  return imposter('Error Testing')
    .port(4545)
    .protocol('http')
    .stub(stub().when(req.path('/success')).willReturn(err(200, { status: 'ok' })))
    .stub(
      stub()
        .when(req.path('/error/400'))
        .willReturn(err(400, { error: 'Bad Request', code: 'INVALID_INPUT' }))
    )
    .stub(
      stub()
        .when(req.path('/error/401'))
        .willReturn(
          err(401, { error: 'Unauthorized' }).header('WWW-Authenticate', 'Bearer realm="api"')
        )
    )
    .stub(stub().when(req.path('/error/403')).willReturn(err(403, { error: 'Forbidden' })))
    .stub(stub().when(req.path('/error/404')).willReturn(err(404, { error: 'Not Found' })))
    .stub(
      stub()
        .when(req.path('/error/429'))
        .willReturn(
          err(429, { error: 'Too Many Requests', retry_after: 60 }).header('Retry-After', '60')
        )
    )
    .stub(
      stub().when(req.path('/error/500')).willReturn(err(500, { error: 'Internal Server Error' }))
    )
    .stub(stub().when(req.path('/error/502')).willReturn(err(502, { error: 'Bad Gateway' })))
    .stub(
      stub()
        .when(req.path('/error/503'))
        .willReturn(err(503, { error: 'Service Unavailable' }).header('Retry-After', '30'))
    )
    .stub(stub().when(req.path('/error/504')).willReturn(err(504, { error: 'Gateway Timeout' })))
    .build();
}

// A "DSL reconstruction" must be a genuinely TYPED build — using `raw()`/`raw({ stubs })` to splice
// arbitrary wire in would let any fixture masquerade as expressible and hollow out this gate (raw()
// accepts any wire), so raw()-injected wire features do NOT count. task-management-api.json is
// therefore fromJson-only for the SAME bare-scenarioName reason as auth/feature-flags below — even
// though its jsonpath predicates (`exists().jsonpath('$.name')`) ARE typed-expressible, the bare
// scenarioName grouping has no builder, so the imposter as a whole cannot be built through the
// typed layer without the raw() escape hatch.

export const dslCoverage: Record<string, () => Imposter | ImposterBuilder> = {
  'basic-api.json': basicApi,
  'error-testing.json': errorTesting,
};

export const fromJsonOnly: Record<string, string> = {
  'latency-testing.json':
    'wait:{inject} random-delay behavior — latency() deliberately never emits the inject form (#23)',
  'authentication-api.json':
    'stub-level scenarioName grouping (no FSM transition) — no builder method (#24 gap, #36)',
  'feature-flags-api.json':
    'stub-level scenarioName grouping (no FSM transition) — no builder method (#24 gap, #36)',
  'task-management-api.json':
    'stub-level scenarioName grouping (no FSM transition) — no builder method (#24 gap, #36); jsonpath predicates are otherwise typed-expressible',
};
