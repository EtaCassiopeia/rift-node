/**
 * Pure intercept rule builders (issue #11) — turn `InterceptHandle.serve`/`forward`/`redirectTo`'s
 * ergonomic arguments into the wire `wire.InterceptRule` shape. No I/O, no backend dependency;
 * `InterceptHandleImpl` (engine.ts) is the only caller.
 */

import type { InterceptRule, IsResponse, Predicate } from '../model/index.js';
import { InvalidDefinition } from '../errors.js';
import { ResponseBuilder } from '../dsl/response.js';
import type { ImposterHandle } from '../engine.js';

/** A `ResponseBuilder` is only valid here when it builds a plain `is` block — proxy/inject/native-fault
 * responses have no meaning as an intercept `serve` action. */
function toIsResponse(response: ResponseBuilder | IsResponse): IsResponse {
  if (!(response instanceof ResponseBuilder)) return response;
  const built = response.build();
  if (built.is === undefined) {
    throw new InvalidDefinition(
      'intercept serve() response must build an `is` block (status/headers/body) — proxy/inject/fault responses are not valid intercept actions'
    );
  }
  return built.is;
}

function toForwardPort(to: ImposterHandle | number): number {
  return typeof to === 'number' ? to : to.port;
}

/** `string` match = host shorthand; a `Predicate[]` match is AND-ed over the decrypted request. */
export function serveRule(match: string | Predicate[], response: ResponseBuilder | IsResponse): InterceptRule {
  const serve = toIsResponse(response);
  return typeof match === 'string' ? { host: match, action: { serve } } : { predicates: match, action: { serve } };
}

export function forwardRule(match: string | Predicate[], to: ImposterHandle | number): InterceptRule {
  const port = toForwardPort(to);
  return typeof match === 'string'
    ? { host: match, action: { forward: { port } } }
    : { predicates: match, action: { forward: { port } } };
}

/** A catch-all forward rule: no `host`/`predicates`, so it matches whatever no more specific rule did. */
export function redirectRule(imposter: ImposterHandle): InterceptRule {
  return { action: { forward: { port: imposter.port } } };
}
