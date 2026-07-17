/**
 * `assertReceived` — testkit sugar for `ImposterHandle.verify()` (issue #6, #12).
 *
 * A one-line delegation, not a separate diff/renderer: it must throw the exact same
 * `VerificationError` `imposter.verify()` itself throws, rendered by the same `render.ts` (issue
 * #6) — keeping a second copy here would only risk the two drifting apart.
 */

import type { ImposterHandle } from '../engine.js';
import type { CountMatcher, RequestMatch } from '../verify/index.js';

export async function assertReceived(
  imposter: ImposterHandle,
  match: RequestMatch,
  count?: CountMatcher
): Promise<void> {
  await imposter.verify(match, count);
}
