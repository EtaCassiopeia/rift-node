/**
 * undici trust helper for the intercept (TLS-MITM) surface (issue #11).
 *
 * In-process `fetch`/undici `Agent`s do not read `HTTPS_PROXY`/`HTTP_PROXY` env vars (unlike most
 * other HTTP clients — see `InterceptHandle.env()` for those), so intercepting an in-process fetch
 * needs an explicit `ProxyAgent` wired with the intercept CA. `undici` is an optional peer
 * dependency (not installed by default, including in this worktree): the import stays dynamic so
 * `@rift-vs/rift` core never depends on it, and this module is safely importable — just not
 * *callable* without undici — when it's absent.
 */

import type { InterceptHandle } from './engine.js';

export interface ProxyAgentConfig {
  uri: string;
  requestTls: { ca: string };
  proxyTls: Record<string, never>;
}

export interface InterceptDispatcherOptions {
  /** Overrides the default `new undici.ProxyAgent(config)` construction. Lets callers (and this
   * module's own unit tests, run where undici is NOT installed) assert the resolved config shape
   * without ever importing undici. */
  proxyAgentFactory?: (config: ProxyAgentConfig) => unknown;
}

// A non-literal specifier so `tsc` never tries to resolve undici's type declarations (there may be
// none installed) — this is the one intentional `any` boundary in the module (see the class rule).
const UNDICI_MODULE = 'undici';

async function loadProxyAgent(): Promise<new (config: ProxyAgentConfig) => unknown> {
  let mod: { ProxyAgent?: new (config: ProxyAgentConfig) => unknown };
  try {
    mod = await import(UNDICI_MODULE);
  } catch (cause) {
    throw new Error(
      "@rift-vs/rift/intercept-undici requires the optional peer dependency 'undici' (>=6) to be " +
        'installed — install it, or pass { proxyAgentFactory } to construct the dispatcher yourself.',
      { cause }
    );
  }
  if (typeof mod.ProxyAgent !== 'function') {
    throw new Error("the installed 'undici' package does not export a ProxyAgent constructor");
  }
  return mod.ProxyAgent;
}

/**
 * Resolves to `new ProxyAgent({ uri: handle.url, requestTls: { ca: await handle.caPem() }, proxyTls:
 * {} })` — pass it as `{ dispatcher }` to `fetch`/undici's `request` so the call is transparently
 * routed through the intercept with no TLS errors.
 */
export async function interceptDispatcher(
  handle: InterceptHandle,
  opts: InterceptDispatcherOptions = {}
): Promise<unknown> {
  const config: ProxyAgentConfig = {
    uri: handle.url,
    requestTls: { ca: await handle.caPem() },
    proxyTls: {},
  };
  if (opts.proxyAgentFactory !== undefined) {
    return opts.proxyAgentFactory(config);
  }
  const ProxyAgent = await loadProxyAgent();
  return new ProxyAgent(config);
}
