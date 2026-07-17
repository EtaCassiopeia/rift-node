/**
 * Runtime smoke test for #47: a param-typed `StubBuilder` (`onGet('/api/users/:id')` returns
 * `StubBuilder<PathParams<'/api/users/:id'>>`) built and normalized through the consuming paths
 * produces the expected wire output at RUNTIME.
 *
 * This is NOT the compile gate: ts-jest here does not type-check (verified — a blatant type error
 * passes jest), and `npm run typecheck` excludes `test/`. The actual regression guard for the
 * type-level fix is `npm run typecheck:examples` over `examples/path-params.ts`, which exercises
 * the same param-typed builder in every consuming position. This file only pins runtime behavior.
 */
import { imposter, onGet, scenario, okJson } from '../../src/index.js';
import { predicatesOf } from '../../src/verify/index.js';

const paramStub = () => onGet('/api/users/:id').willReturn(okJson({}));

describe('param-typed StubBuilder composes (#47)', () => {
  it('passes into imposter().stub()', () => {
    const cfg = imposter('users').stub(paramStub()).build();
    expect(cfg.stubs?.length).toBe(1);
  });

  it('passes into scenario().when()', () => {
    const steps = scenario('users').when('start', paramStub()).respond(okJson({})).build();
    expect(steps).toHaveLength(1);
  });

  it('passes into verify() via RequestMatch (predicatesOf normalizes it)', () => {
    const predicates = predicatesOf(paramStub());
    expect(predicates.length).toBeGreaterThan(0);
  });
});
