# rift-node SDK — Complete API Design

Status: **approved for issue filing** · elaborates RFC-003 §12 (Node/TS amendment) · 2026-07-09

This document is the single source of truth for the `@rift-vs/rift` public API. It was produced
from a full survey of: the Rift engine wire grammar and admin API (`rift-core`, `rift-http-proxy`,
`docs/`), the `librift_ffi` C-ABI v2 (25 symbols, `crates/rift-ffi`), RFC-003 and its §12
amendment, the landed rift-node code (PRs #16–#19), the sibling SDKs (rift-java merged DSL,
rift-scala design), and prior art (WireMock, MSW, nock, Testcontainers, Playwright/Vitest
fixtures). Every implementation issue carries the slice of this design it delivers; this doc holds
the cross-cutting decisions and the full grammar reference.

## 0. Reading example (the target DX)

```ts
import {
  rift, imposter, onGet, onPost, okJson, created, status,
  contains, times, Fault,
} from '@rift-vs/rift';

await using engine = await rift.embedded();            // or rift.connect(url) / rift.spawn()

const users = await engine.create(
  imposter('users').record()
    .stub(onGet('/api/users/:id').willReturn(okJson({ id: 1, name: 'Alice' })))
    .stub(onPost('/api/users')
      .withHeader('content-type', contains('json'))
      .willReturn(created().latency(50), status(503))) // two responses = cycling
    .stub(onGet('/api/health').willReturn(okJson({ ok: true }).withFault(
      Fault.latency({ min: 100, max: 500 }, { probability: 0.3 })))));

await callSut(users.url);

await users.verify(onGet('/api/users/1'), times(1));   // throws VerificationError with a diff
```

## 1. Principles

1. **`when(request) → respond(responses…)`** — the RFC-003 shared mental model. Builders are
   synchronous and pure; `await` appears at exactly two places: engine acquisition and
   `engine.create(...)` (the Testcontainers pattern).
2. **The API is total** — every engine feature is reachable from the typed layer on every
   transport. Where a transport lacks a native path (FFI gaps), the SDK bridges internally;
   the user never sees a difference.
3. **Wire model is the escape hatch, never the fight** — `fromJson` / `.raw()` accept raw JSON
   verbatim (explicit ports respected); every builder `build()`s to plain wire types.
4. **Cross-SDK consistent, Node-idiomatic** — grammar verbs match rift-java (`onGet`,
   `willReturn`, `scenario().startingAt().when().respond().goTo()`, `verify(match, times(1))`);
   spelling is Node-idiomatic (`okJson(object)`, `.latency(ms)`, `handle.url`,
   `await using`).
5. **Failures are self-diagnosing** — verification failures render a WireMock-style near-miss
   diff; startup failures carry engine stderr; native-library failures name the exact file,
   version, and fix.

## 2. Packaging and module format (decision)

- **ESM-only**, Node ≥ 20. No CJS build. Rationale: zero-dep + global `fetch` + `worker_threads`
  + `await using` all target modern Node; both testkit targets are ESM-native. CJS consumers use
  dynamic `import()`. This is now an explicit decision, not an accident of the build.
- `package.json` exports (note `types` **first** in each condition block — the current map has it
  second, which is wrong per TS docs):

```jsonc
{
  "name": "@rift-vs/rift",
  "type": "module",
  "exports": {
    ".":                { "types": "./dist/index.d.ts",           "import": "./dist/index.js" },
    "./compat":         { "types": "./dist/compat/index.d.ts",    "import": "./dist/compat/index.js" },
    "./testkit/vitest": { "types": "./dist/testkit/vitest.d.ts",  "import": "./dist/testkit/vitest.js" },
    "./testkit/jest":   { "types": "./dist/testkit/jest.d.ts",    "import": "./dist/testkit/jest.js" },
    "./intercept-undici": { "types": "./dist/intercept-undici.d.ts", "import": "./dist/intercept-undici.js" }
  },
  "peerDependencies": { "undici": ">=6", "vitest": ">=1", "@rift-vs/rift-embedded": "*" },
  "peerDependenciesMeta": {
    "undici": { "optional": true }, "vitest": { "optional": true },
    "@rift-vs/rift-embedded": { "optional": true }
  }
}
```

- `@rift-vs/rift-embedded` is a separate package holding the koffi dependency and the worker; the
  core package dynamic-imports it from `rift.embedded()` and throws
  `EngineUnavailable('embedded transport requires @rift-vs/rift-embedded — npm i -D @rift-vs/rift-embedded')`
  if absent.
- **Root export hygiene** (breaking, pre-publish so free): the legacy weak types
  (`Predicate`/`Response`/`Stub`/`Imposter`/`ImposterConfig`/`ServerInfo` from `src/types.ts`)
  leave the root — root names must belong to the DSL + wire model. The Mountebank-compat surface
  (`create`, `CreateOptions`, `RiftServer`, default export `{ create }`) stays at the root (it is
  a permanent product surface) and is also importable from `./compat`.

## 3. Client API — engine facade and handles

### 3.1 Entry points

```ts
export const rift: {
  connect(url: string, options?: ConnectOptions): Promise<RiftEngine>;
  spawn(options?: SpawnOptions): Promise<RiftEngine>;
  embedded(options?: EmbeddedOptions): Promise<RiftEngine>;  // dynamic import of @rift-vs/rift-embedded
};

interface ConnectOptions {
  apiKey?: string;                    // Authorization header for the admin plane
  headers?: Record<string, string>;
  timeoutMs?: number;                 // per-request; default 30_000
  versionCheck?: 'fail' | 'warn' | 'off';  // default 'fail'; compares GET /config to minEngineVersion
}
```

`connect` becomes async (it performs the version preflight). All three return the same
`RiftEngine` interface — transports differ only in acquisition options.

### 3.2 `RiftEngine`

```ts
interface RiftEngine extends AsyncDisposable {
  readonly transport: 'remote' | 'spawn' | 'embedded';

  create(def: ImposterBuilder | wire.Imposter): Promise<ImposterHandle>;
  get(port: number): Promise<ImposterHandle>;               // attach to an existing imposter
  list(): Promise<ImposterSummary[]>;                       // { port, protocol, name?, numberOfRequests }
  deleteAll(): Promise<void>;
  replaceAll(defs: Array<ImposterBuilder | wire.Imposter>): Promise<ImposterHandle[]>;

  buildInfo(): Promise<BuildInfo>;   // { version, commit?, builtAt?, features: string[] }
  adminUrl(): Promise<string>;       // embedded: lazily starts the in-process admin plane

  intercept(options?: InterceptOptions): Promise<InterceptHandle>;   // §7

  readonly admin: AdminApi;          // typed low-level admin surface (escape hatch), §3.5
  close(): Promise<void>;            // idempotent
  readonly closed: boolean;
}
```

### 3.3 `ImposterHandle`

Returned by `create`/`get`. All mutators are `Promise<void>` unless noted.

```ts
interface ImposterHandle extends AsyncDisposable {
  readonly port: number;
  readonly url: string;              // `${protocol}://${reachableHost}:${port}` — 0.0.0.0 → 127.0.0.1
  readonly name?: string;
  readonly protocol: 'http' | 'https';

  // stub surgery
  addStub(stub: StubBuilder | wire.Stub, opts?: { index?: number }): Promise<void>;
  replaceStubs(...stubs: Array<StubBuilder | wire.Stub>): Promise<void>;
  updateStub(ref: number | { id: string }, stub: StubBuilder | wire.Stub): Promise<void>;
  deleteStub(ref: number | { id: string }): Promise<void>;
  stubs(): Promise<wire.Stub[]>;

  // verification (§6)
  recorded(filter?: RecordedFilter): Promise<RecordedRequest[]>;
  clearRecorded(): Promise<void>;
  verify(match: RequestMatch, count?: CountMatcher): Promise<void>;  // default atLeast(1)

  // scenarios (§5.8)
  scenarios(flowId?: string): Promise<Array<{ name: string; state: string }>>;
  setScenarioState(name: string, state: string, flowId?: string): Promise<void>;
  resetScenarios(flowId?: string): Promise<void>;

  // spaces & flow state (§5.9)
  space(flowId: string): SpaceHandle;
  flowState(flowId: string): FlowStateHandle;

  // lifecycle & export
  enable(): Promise<void>;
  disable(): Promise<void>;
  clearProxyRecordings(): Promise<void>;   // DELETE savedProxyResponses
  toJson(opts?: { replayable?: boolean; removeProxies?: boolean }): Promise<wire.Imposter>;
  delete(): Promise<void>;                 // [Symbol.asyncDispose] delegates here (idempotent)
}
```

`SpaceHandle` scopes the same verbs to one flow id; `delete()` is the one-call teardown:

```ts
interface SpaceHandle {
  readonly flowId: string;
  addStub(stub: StubBuilder | wire.Stub): Promise<void>;   // POST spaces/{flowId}/stubs
  stubs(): Promise<wire.Stub[]>;
  recorded(): Promise<RecordedRequest[]>;
  verify(match: RequestMatch, count?: CountMatcher): Promise<void>;
  scenarios(): Promise<Array<{ name: string; state: string }>>;
  setScenarioState(name: string, state: string): Promise<void>;
  resetScenarios(): Promise<void>;
  state: FlowStateHandle;
  delete(): Promise<void>;                 // stubs + recorded + scenario state, never global
}

interface FlowStateHandle {
  get<T = unknown>(key: string): Promise<T | undefined>;   // undefined = absent (not an error)
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}
```

### 3.4 Layering

```
testkit (vitest/jest)                 — fixtures over the client API
client API: RiftEngine + handles      — transport-agnostic sugar, one implementation
AdminApi (typed, total)               — per-transport: HTTP (remote/spawn) | FFI+loopback (embedded)
wire model + DSL                      — pure data
```

`RiftEngine`/handles are implemented **once** over the `AdminApi` interface; transports provide
`AdminApi` implementations. This kills the current split where spawn returns `{url, port, client}`
and remote returns a bare client.

### 3.5 `AdminApi` (escape hatch, total wire-level surface)

Today's `RemoteClient` grows to cover the full admin route table and becomes the interface both
transports implement: imposter CRUD (`?replayable`/`removeProxies`), stub CRUD by index and by id,
`savedRequests` get/delete with `match=` filters, `savedProxyResponses` delete, enable/disable,
scenarios get/put/reset, spaces, flow-state KV, `config`/`logs`/`metrics`, `reload`. Exact
signatures are in issue #15 (client API).

## 4. Error model

```ts
class RiftError extends Error                    // base
class InvalidDefinition extends RiftError        // client-side validation or engine 400
class ImposterNotFound extends RiftError         // 404
class EngineError extends RiftError              // other engine failure; .code
class EngineUnavailable extends RiftError        // spawn/connect/load failure; .cause
class CommunicationError extends RiftError       // transport-level (HTTP/FFI)
class WireValidationError extends RiftError      // fromJson shape errors; .path
// new:
class VerificationError extends RiftError        // verify() miss; .expected .count .recorded .closest
class UnsupportedPredicateError extends RiftError// client-side verify hit xpath/inject
class EngineVersionError extends RiftError       // preflight: engine < minEngineVersion; .found .required
class NativeLibraryError extends RiftError       // cdylib resolution/ABI failure; .path? .classifier?
class InterceptUnavailable extends RiftError     // intercept not started/startable on this transport
```

All SDK-thrown errors are `RiftError` subclasses (the compat `create()` keeps its historical plain
`Error`s). `WireValidationError` is re-parented under `RiftError` (currently standalone).

## 5. DSL — full grammar

### 5.1 Stub openers

```ts
stub(): StubBuilder                                   // bare (catch-all until refined)
on(method: string, path?: string | PathOpts): StubBuilder
onGet/onPost/onPut/onDelete/onPatch/onHead/onOptions(path?: string, opts?: PathOpts): StubBuilder
onAny(path: string, opts?: PathOpts): StubBuilder     // any method
```

**Path params**: a path containing `:name` segments (e.g. `/users/:id`) compiles to BOTH the
stub-level `routePattern` (param extraction for templates/scripts — Rift's `routePattern` is
extraction-only, it never matches) AND a derived anchored regex path predicate
(`{ matches: { path: "^/users/[^/]+$" } }`). Opt out with `{ params: false }` to treat `:` as a
literal. Param names are captured at the type level (`StubBuilder<{ id: string }>`) for editor
hints; purely compile-time.

### 5.2 Matchers (field-agnostic, bind via `with*` or field binders)

```ts
equals(v: JsonValue): Matcher          deepEquals(v: JsonValue): Matcher
contains(v: string): Matcher           startsWith(v: string): Matcher
endsWith(v: string): Matcher           matches(re: string | RegExp): Matcher
exists(): Matcher                      notExists(): Matcher      // exists: false

interface Matcher {
  caseSensitive(): Matcher;            // wire: caseSensitive: true
  keyCaseSensitive(): Matcher;         // wire: keyCaseSensitive: true
  except(re: string | RegExp): Matcher;// wire: except
  jsonpath(selector: string): Matcher; // wire: jsonpath: { selector }
  xpath(selector: string, ns?: Record<string, string>): Matcher; // wire: xpath: { selector, ns }
}
```

This replaces the current field-first free functions (`equals('path', v)`) — breaking but
unpublished. A bare `string`/`object` anywhere a `Matcher` is accepted means `equals`.

### 5.3 Predicates (composition) and stub refinement

```ts
// field binders — grouped under `req` to avoid clashing with node:path etc.
export const req: {
  method(m: string | Matcher): wire.Predicate;
  path(m: string | Matcher): wire.Predicate;
  body(m: string | object | Matcher): wire.Predicate;
  header(name: string, m: string | Matcher): wire.Predicate;
  query(name: string, m: string | number | Matcher): wire.Predicate;
};
and(...ps: wire.Predicate[]): wire.Predicate
or(...ps: wire.Predicate[]): wire.Predicate
not(p: wire.Predicate): wire.Predicate
injectPredicate(jsFn: string): wire.Predicate         // { inject: "function (config) {...}" }

// StubBuilder refiners (each ANDs one predicate; mirrors rift-java)
interface StubBuilder<P = {}> {
  withMethod(m: string | Matcher): this;
  withPath(m: string | Matcher): this;
  withBody(m: string | object | Matcher): this;
  withHeader(name: string, m: string | Matcher): this;
  withQuery(name: string, m: string | number | Matcher): this;
  when(p: wire.Predicate): this;                      // raw-predicate escape (kept)
  // stub-level fields
  id(id: string): this;                               // wire: id
  inSpace(flowId: string): this;                      // wire: space
  routePattern(pattern: string): this;                // explicit override
  // responses
  willReturn(...rs: Array<ResponseBuilder | wire.StubResponse>): this;  // APPENDS (cycling)
  raw(patch: Partial<wire.Stub>): this;               // shallow-merged last
  build(): wire.Stub;
}
```

**Semantics fix**: `willReturn` now **appends** on repeated calls (rift-java parity) — it currently
replaces while `when` accumulates. `respond` stays as an alias. Never name anything `then` (builders
must not be thenables).

### 5.4 Response builders

```ts
// constructors
ok(body?): R            okJson(body: JsonValue): R      created(body?): R
noContent(): R          notFound(body?): R              badRequest(body?): R
status(code: number, body?): R                          json(code, body): R    text(code, body): R
fault(kind: TcpFaultKind): R                            // bare top-level fault response
proxyTo(to: string): ProxyBuilder                        // §5.6
inject(jsFn: string): R                                  // Mountebank JS inject
script(spec: ScriptSpec): R                              // _rift.script-only response, §5.7

interface ResponseBuilder /* R */ {
  status(code: number): this;
  header(name: string, value: string | string[]): this;  // string[] = multi-value (Set-Cookie)
  headers(h: Record<string, string | string[]>): this;
  body(v: JsonValue): this;
  binaryBody(data: Uint8Array | string): this;           // base64-encodes; wire: _mode: "binary"
  templated(): this;                                     // wire: _rift.templated: true

  // behaviors (_behaviors) — execution order in-engine: copy → lookup → decorate → wait
  latency(ms: number | { min: number; max: number } | string): this;
      // number → wait: N; range → wait: {min,max}; string = JS fn source → wait: "function() {...}"
      // NEVER emit {"inject": ...} — docs show it but the engine's WaitBehavior parser rejects it
  repeat(n: number): this;
  decorate(jsFn: string): this;
  shellTransform(...commands: string[]): this;           // string per command; array = chained
  copy(spec: CopySpec | CopySpec[]): this;
  lookup(spec: LookupSpec | LookupSpec[]): this;
  behavior(raw: wire.Behaviors): this;                   // merge escape hatch

  withFault(f: RiftFault): this;                         // _rift.fault, §5.5
  raw(patch: Partial<wire.StubResponse>): this;
  build(): wire.StubResponse;
}

interface CopySpec {
  from: 'path' | 'method' | 'body' | { query: string } | { headers: string };
  into: string;                                          // "${TOKEN}"
  using: { method: 'regex' | 'jsonpath' | 'xpath'; selector: string;
           options?: { ignoreCase?: boolean; multiline?: boolean } };
}
interface LookupSpec {
  key: { from: CopySpec['from']; using: CopySpec['using'] };
  fromDataSource: { csv: { path: string; keyColumn: string; delimiter?: string } };
  into: string;
}
```

### 5.5 Faults

```ts
type TcpFaultKind = 'CONNECTION_RESET_BY_PEER' | 'EMPTY_RESPONSE'
                  | 'RANDOM_DATA_THEN_CLOSE' | 'MALFORMED_RESPONSE_CHUNK';

export const Fault: {
  CONNECTION_RESET: 'CONNECTION_RESET_BY_PEER';
  EMPTY_RESPONSE: 'EMPTY_RESPONSE';
  RANDOM_DATA: 'RANDOM_DATA_THEN_CLOSE';
  MALFORMED_CHUNK: 'MALFORMED_RESPONSE_CHUNK';
  // _rift.fault builders (probabilistic, composable on any is-response)
  latency(ms: number | { min: number; max: number }, opts?: { probability?: number }): RiftFault;
  error(spec: { status?: number; body?: string; headers?: Record<string, string> },
        opts?: { probability?: number }): RiftFault;
  tcp(kind: TcpFaultKind, opts?: { probability?: number }): RiftFault;
};
```

`fault(Fault.CONNECTION_RESET)` → top-level `{ fault: "CONNECTION_RESET_BY_PEER" }` response.
`ok().withFault(Fault.latency(1000))` → `_rift.fault.latency`. Multiple `withFault` calls merge
into one `_rift.fault` block (latency + error + tcp coexist; engine precedence latency → tcp → error).

### 5.6 Proxy

```ts
interface ProxyBuilder {
  proxyOnce(): this; proxyAlways(): this; proxyTransparent(): this;   // wire: mode
  generatePredicates(...gens: PredicateGenerator[]): this;            // wire: predicateGenerators
  addWaitBehavior(on?: boolean): this;
  addDecorateBehavior(jsFn: string): this;
  injectHeader(name: string, value: string): this;                    // wire: injectHeaders
  rewritePath(from: string, to: string): this;                        // wire: pathRewrite (Rift ext)
  clientCert(pem: { key: string; cert: string }): this;               // mTLS to upstream
  latency(...) / repeat(...) / decorate(...) etc.                     // _behaviors now legal on proxy
  raw(patch: Partial<wire.StubResponse>): this;
  build(): wire.StubResponse;
}
interface PredicateGenerator {
  matches: { method?: true; path?: true; query?: true; body?: true; headers?: Record<string, true> };
  caseSensitive?: boolean; except?: string;
}
```

Fixes the current silent-drop bug where `proxyTo(...).latency(500)` discards the behavior.

### 5.7 Scripts

```ts
export const Script: {
  rhai(code: string): ScriptSpec;          js(code: string): ScriptSpec;
  rhaiFile(path: string): ScriptSpec;      jsFile(path: string): ScriptSpec;
  ref(name: string): ScriptSpec;           // named registry (_rift.scripts)
};
// wire: _rift.script: { engine?, code | file | ref }
```

Used by `script(spec)` (response generator), `imposter().registerScript(name, spec)` (registry).

### 5.8 Scenarios

```ts
scenario(name: string): ScenarioBuilder
interface ScenarioBuilder {
  startingAt(state: string): this;                       // must equal first step's state (checked)
  when(state: string, stub: StubBuilder): this;          // SNAPSHOTS the stub at call time
  respond(...rs: Array<ResponseBuilder | wire.StubResponse>): this;  // variadic → cycling in-state
  goTo(next: string): this;                              // omit = gate without transition
  build(): wire.Stub[];
}
// sugar so users don't spread:
imposter('x').scenario(scenario('checkout').startingAt('Started')...)
```

Fix: `when` snapshots (`build()`s) the stub immediately — later mutation of the passed builder no
longer silently rewrites committed steps. `respond` becomes variadic (was single).

### 5.9 Imposter builder

```ts
imposter(name?: string): ImposterBuilder
interface ImposterBuilder {
  port(n: number): this;                    // explicit ports ALWAYS respected
  host(h: string): this;
  protocol(p: 'http' | 'https'): this;
  https(tls?: { cert?: string; key?: string; mutualAuth?: boolean }): this;  // protocol + PEM
  record(): this;  recordMatches(): this;  allowCORS(): this;
  strictBehaviors(): this;
  defaultResponse(r: ResponseBuilder | wire.IsResponse): this;
  defaultForward(url: string): this;        // Rift: transparent forward for unmatched
  serviceName(s: string): this;  serviceInfo(v: JsonValue): this;
  stub(...stubs: Array<StubBuilder | wire.Stub>): this;
  scenario(s: ScenarioBuilder): this;       // appends s.build() stubs
  // _rift config
  flowState(cfg: { backend?: 'inmemory' | 'redis'; ttlSeconds?: number;
                   flowIdSource?: 'imposter_port' | `header:${string}`;
                   redis?: { url: string; poolSize?: number; keyPrefix?: string } }): this;
  flowIdFromHeader(name: string): this;     // sugar: flowIdSource: `header:${name}`
  metrics(port?: number): this;
  scriptEngine(cfg: { defaultEngine?: 'rhai' | 'javascript'; timeoutMs?: number }): this;
  registerScript(name: string, spec: ScriptSpec): this;
  raw(patch: Partial<wire.Imposter>): this;
  build(): wire.Imposter;
}
```

`defaultResponse` stops throwing on non-`is` builders at call time with a plain `Error`; it now
throws `InvalidDefinition` and accepts a raw `wire.IsResponse`.

## 6. Verification

### 6.1 Types

```ts
interface RecordedRequest {
  method: string;
  path: string;
  query: Record<string, string | string[]>;
  headers: Record<string, string | string[]>;
  body?: unknown;                 // string, or parsed JSON when the engine recorded it as such
  from: string;                   // wire: request_from (client addr)
  timestamp: string;              // RFC3339
  raw: wire.RecordedRequest;      // untouched wire object
}
type RequestMatch = StubBuilder | wire.Predicate | wire.Predicate[];
interface CountMatcher { readonly min: number; readonly max: number; describe(): string }
times(n): CountMatcher   atLeast(n): CountMatcher   atMost(n): CountMatcher
between(min, max): CountMatcher                     never(): CountMatcher  // times(0)
```

A `StubBuilder` used as a match contributes only its predicates (responses ignored).

### 6.2 Client-side predicate evaluation

Rift has no server-side verify endpoint (upstream enhancement filed), so `verify`/`recorded(filter)`
evaluate predicates in the SDK against recorded requests: `equals`, `deepEquals`, `contains`,
`startsWith`, `endsWith`, `matches`, `exists`, `and`, `or`, `not`, honoring `caseSensitive`
(default insensitive), `keyCaseSensitive`, `except`, plus a built-in `jsonpath` subset
(dot + bracket + numeric index: `$.a.b[0].c`; filters/wildcards unsupported). `xpath` and `inject`
predicates throw `UnsupportedPredicateError` naming the operator. Semantics mirror the engine
(string coercion for query/header scalars, object-containment for `equals` on JSON bodies).

### 6.3 Failure rendering (`VerificationError`)

"Closest" = the recorded request satisfying the highest fraction of leaf predicate clauses; ties →
most recent. Message format (snapshot-tested):

```
Verification failed for imposter "users" (port 55123)

Expected  GET /api/users/1        times(1)
Actual    0 of 3 recorded requests matched

Closest non-match — request #2 at 2026-07-09T10:12:03Z from 127.0.0.1:52114:
  method  GET                       ✓
  path    /api/users/2              ✗  expected equals "/api/users/1"
  header  accept: application/json  ✓
```

`error.expected` (predicates), `error.count` (`{ matched, total, matcher }`), `error.recorded`,
`error.closest` are machine-readable. The testkit's `assertReceived` reuses this renderer.

## 7. Intercept (TLS-MITM)

```ts
interface InterceptOptions { host?: string; port?: number; caCertPath?: string; caKeyPath?: string }
interface InterceptHandle {
  readonly url: string;             // http://host:port — set as the SUT's HTTPS proxy
  readonly port: number;
  serve(match: string | wire.Predicate[], response: ResponseBuilder | wire.IsResponse): Promise<void>;
      // string = host shorthand → { host, action: { serve } }
  forward(match: string | wire.Predicate[], to: ImposterHandle | number): Promise<void>;
  redirectTo(imposter: ImposterHandle): Promise<void>;    // catch-all forward rule
  rules(): Promise<wire.InterceptRule[]>;
  addRule(rule: wire.InterceptRule | wire.InterceptRule[]): Promise<void>;
  clearRules(): Promise<void>;
  caPem(): Promise<string>;
  caFile(dir?: string): Promise<string>;                  // writes PEM, returns path (for NODE_EXTRA_CA_CERTS)
  exportTruststore(opts: { format: 'pkcs12' | 'jks'; path: string; password?: string }): Promise<void>;
  env(): Promise<Record<string, string>>;                 // { HTTPS_PROXY, HTTP_PROXY, NODE_EXTRA_CA_CERTS }
}
```

Per-transport availability (documented, typed):
- **embedded** — `engine.intercept(opts)` calls `rift_start_intercept` (idempotent handle reuse).
- **spawn** — must be requested at spawn: `rift.spawn({ intercept: true | InterceptOptions })`
  maps to `--intercept-port` (+ CA flags). `engine.intercept()` without it throws
  `InterceptUnavailable` with the fix in the message.
- **remote** — attach-only: probes `GET /intercept/rules`; 404 → `InterceptUnavailable`
  ("start the server with --intercept-port"). Upstream issue filed for runtime start parity.

Trust helpers: `handle.env()` covers child-process SUTs; for in-process undici/fetch, the optional
subpath `@rift-vs/rift/intercept-undici` (peer-dep `undici`) exports
`interceptDispatcher(handle): Promise<ProxyAgent>` wired with proxy URL + CA.

## 8. Transports

### 8.1 Remote / spawn

Spawn extends today's implementation with first-class engine flags:

```ts
interface SpawnOptions {
  port?: number; host?: string; loglevel?: 'debug'|'info'|'warn'|'error'; logfile?: string;
  version?: string; binaryPath?: string; env?: Record<string, string>; mirror?: string;
  startupTimeoutMs?: number; shutdownTimeoutMs?: number;
  allowInjection?: boolean;                       // --allow-injection
  apiKey?: string;                                // --api-key (also used by the client)
  localOnly?: boolean; ipWhitelist?: string[]; origin?: string;
  datadir?: string; configfile?: string;
  defaultTls?: { cert: string; key: string };     // --default-tls-cert/key
  metricsPort?: number;
  intercept?: boolean | InterceptOptions;         // --intercept-port (+ CA paths)
}
```

`SpawnedEngine.close()` also closes its `AdminApi` client (fixes the current leak of a usable
client against a dead process).

### 8.2 Embedded

- One dedicated `worker_threads` Worker owns the koffi handle. Protocol and per-symbol binding are
  specified in issue #8. Every native call runs synchronously on the worker and is atomically
  paired with `rift_last_error()` on that thread (the ABI's error slot is per-OS-thread).
- **FFI-first with lazy loopback bridge**: operations with FFI symbols use them; the admin
  long-tail (scenario get/set/reset, `savedRequests`/`savedProxyResponses` clear, enable/disable)
  routes through a lazily started in-process admin plane (`rift_serve_admin` on `127.0.0.1:0`,
  random `apiKey`). Imposter **creation always goes through FFI** — this bypasses the admin
  plane's `allowInjection: false` default, so script/inject stubs work embedded with no flag.
  `list()`/`get()` are served from a local registry (port → submitted config) merged with
  `rift_recorded` counts. Upstream issues filed to close the FFI gaps and retire the bridge.
- Preflight: `rift_build_info` missing symbol → `NativeLibraryError` ("ABI v1 library, need v2");
  version < `minEngineVersion` → `EngineVersionError` (or `console.warn` with
  `versionCheck: 'warn'`). `requireFeatures: ['javascript']` asserts compiled-in features.

```ts
interface EmbeddedOptions {
  libPath?: string;                 // wins over everything; also RIFT_FFI_LIB
  version?: string;                 // natives version pin; default = package minEngineVersion
  cacheDir?: string;
  download?: boolean;               // default true; false = resolve offline or throw
  versionCheck?: 'fail' | 'warn' | 'off';
  requireFeatures?: string[];
}
```

### 8.3 Natives resolution (cdylib + spawn binary)

Order: `libPath`/`RIFT_FFI_LIB` → cache
(`${RIFT_CACHE_DIR ?? $XDG_CACHE_HOME ?? ~/.cache}/rift-node/ffi/<version>/librift_ffi-<classifier>.<ext>`)
→ download via `ffi-manifest.json` from the release (mirror base: `RIFT_DOWNLOAD_URL`), SHA-256
from the manifest **mandatory** (no skip). Air-gap: `RIFT_OFFLINE=1` → no network, error lists the
exact file+URL+destination to place manually. Classifiers: `linux-x86_64[-musl]`, `linux-aarch64`,
`darwin-{x86_64,aarch64}`, `windows-x86_64`; musl detected via `process.report` glibc absence.
`npx rift-fetch [--bin] [--lib] [--version <v>]` prefetches (default: both artifacts).

## 9. Testkit

### Vitest (`@rift-vs/rift/testkit/vitest`)

```ts
export const riftTest = createRiftTest();          // default: embedded if installed, else spawn
export function createRiftTest(opts?: {
  transport?: 'embedded' | 'spawn' | { connect: string };
  engine?: EmbeddedOptions | SpawnOptions | ConnectOptions;
}): TestAPI<{ engine: RiftEngine }>;
```

- `engine` is a **worker-scoped** fixture (one engine per Vitest worker — cheap for embedded and
  spawn; this is the isolation decision: per-worker engine, not spaces. Spaces remain a documented
  pattern for shared `connect` engines).
- The test-scoped `engine` the test receives is a proxy that records every `create()`; created
  imposters are disposed after each test (auto-teardown).
- `assertReceived(imposter, match, count?)` re-exported = `imposter.verify` (shared renderer).

### Jest (`@rift-vs/rift/testkit/jest`)

Jest has no fixture system; ship explicit helpers (no custom environment — ESM-hostile):

```ts
const rift = setupRift({ transport: 'spawn' });    // registers beforeAll/afterAll/afterEach
test('looks up user', async () => {
  const users = await rift.engine.create(imposter('users')...);   // auto-teardown afterEach
  ...
});
```

## 10. Mountebank compat (permanent)

`create(options)` / default export `{ create }` keep their exact contract (including
accepted-but-ignored `redis`/`impostersRepository`, any-HTTP-response readiness poll, EventEmitter
events, SIGTERM→SIGKILL close). Internals migrate to `fetch` + `spawn/resolve.ts` (axios and the
duplicate `binary.ts` stack retire; `findBinary`/`downloadBinary`/`getBinaryVersion` stay as
deprecated delegating wrappers).

## 11. Conformance

Corpus (rift#460) replay harness: for each fixture, `fromJson` → create over each transport →
replay recorded interactions → byte-compare responses. **Expressibility gate**: every fixture name
must have an entry in `test/conformance/dsl-coverage.ts` mapping it to a DSL reconstruction whose
`build()` output deep-equals the fixture (modulo defaults); a missing/failing entry fails CI
naming the gap. Details in issues #7/#13.

## 12. Issue map

| Issue | Delivers |
|---|---|
| #21 | §3 engine facade + handles + AdminApi completion (M7) |
| #22 | §5.1–5.3 matcher/predicate grammar (M7) |
| #23 | §5.4–5.7 responses/behaviors/faults/scripts/proxy (M7) |
| #24 | §5.8–5.9 imposter/stub/scenario completion (M7) |
| #25 | §2/§10 export hygiene + legacy retirement (M7) |
| #6 | §6 verification (M7) |
| #7, #13 | §11 conformance (M7/M8) |
| #8 | §8.2 koffi worker binding (M8) |
| #9 | §8.3 natives resolution (M8) |
| #10 | §8.2 `rift.embedded()` wiring + preflight (M8) |
| #11 | §7 intercept (M8) |
| #12 | §9 testkit (M8) |
| #14 | docs (M8) |
| #26 | recorded-request async iteration, backlog (polling → SSE when rift#461 lands) |
| rift#491 | upstream: FFI admin long-tail symbols (retires #10's loopback bridge) |
| rift#492 | upstream: `allowInjection` option on `rift_serve_admin` |
| rift#493 | upstream: runtime intercept lifecycle endpoints |
| rift#494 | upstream: server-side verification endpoint (full-fidelity `verify`) |

Suggested implementation order: #25 → #21 → #22/#23/#24 (parallel) → #6 → #7 ‖ #8/#9 → #10 → #11/#12 → #13 → #14.
