# Changelog

All notable changes to `@rift-vs/rift` are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- **TLS-MITM intercept surface** (`@rift-vs/rift`, issue #11): `engine.intercept(options?)` returns
  an `InterceptHandle` — `serve(match, response)`/`forward(match, to)`/`redirectTo(imposter)` build
  `wire.InterceptRule`s (host shorthand or AND-ed predicates), plus `addRule`/`rules`/`clearRules`,
  `caPem`/`caFile`/`exportTruststore`, and `env()` (`HTTPS_PROXY`/`HTTP_PROXY`/`NODE_EXTRA_CA_CERTS`)
  for pointing a SUT's proxy at Rift. Implemented once over an `InterceptBackend` seam (embedded
  adapts the issue #8 FFI calls; remote/spawn adapt new `RemoteClient` HTTP routes:
  `POST/GET/DELETE /intercept/rules`, `GET /intercept/ca.pem`, `GET /intercept/truststore.{p12,jks}`),
  so the whole handle is unit-testable against a fake backend with no cdylib/koffi/live engine.
  Per-transport availability is typed and documented: embedded starts via `rift_start_intercept`
  (idempotent handle reuse; a second call with options throws `InterceptUnavailable`); spawn requires
  `rift.spawn({ intercept: true | InterceptOptions })` (`--intercept-port` + optional
  `--intercept-ca-cert`/`--intercept-ca-key`), else `InterceptUnavailable` names the fix; remote
  attaches by probing `GET /intercept/rules`, surfacing a 404 as `InterceptUnavailable` naming
  `--intercept-port`. The optional `@rift-vs/rift/intercept-undici` subpath exports
  `interceptDispatcher(handle)`, dynamically importing the optional peer `undici` to build a
  `ProxyAgent` wired with the intercept CA — core stays undici-free.

- **`rift.embedded()` in-process transport** (`@rift-vs/rift`): returns the same `RiftEngine` as
  `connect`/`spawn`, backed by the embedded worker binding — no Docker, engine-assigned ports.
  Resolves the cdylib, runs a version + feature preflight (`versionCheck: 'fail'|'warn'|'off'`,
  `requireFeatures`), and drives an FFI-first `AdminApi`: imposters/stubs/recorded/flow-state/spaces
  go straight over FFI (so `inject`/scripted stubs work with no `allowInjection` flag), while the few
  operations lacking an FFI symbol (scenarios, enable/disable, saved-request/proxy-response deletion,
  logs) lazily start a loopback admin plane (started at most once, key-guarded). Multiple embedded
  engines per process are independent. The embedded module is dynamically imported, so core stays
  zero-dep for `connect`/`spawn` users.

- **Embedded transport FFI binding + worker** (`@rift-vs/rift/embedded`, issue #8): a koffi-backed
  `NativeEngine` facade over `librift_ffi` (C-ABI v2, all 26 symbols), split into a pure,
  koffi-free `handleCall` discipline (last-error read + decode + free, unit-tested against a fake
  `NativeBinding`) and a thin `worker_threads` wrapper that runs it. `koffi` is an
  `optionalDependency`, dynamically imported only when the embedded transport is actually loaded —
  its (or a cdylib's) absence surfaces as a rejected `NativeEngine.load()`, never at `import`. An
  ambient `koffi.d.ts` shim keeps `tsc --noEmit` green without koffi installed. Subpath-only
  (`@rift-vs/rift/embedded`); wiring it into `rift.embedded()` is issue #10.
- **cdylib (native library) resolution** (`@rift-vs/rift`, issue #9): `resolveCdylib`/`platformClassifier`
  (from `src/natives`, exported at the package root) resolve `librift_ffi` for the future
  `@rift-vs/rift-embedded` transport — explicit override (`RIFT_FFI_LIB`) → sidecar-verified local
  cache → manifest-driven, mandatorily-checksummed download (no skip flag, unlike the engine
  binary's `RIFT_SKIP_CHECKSUM`), guarded by a concurrent-download lock. Six platform classifiers
  (linux x86_64 glibc/musl, linux aarch64, darwin x86_64/aarch64, windows x86_64); linux
  aarch64+musl has no published artifact and fails with a clear gap error. `rift-fetch` gains
  `--bin`/`--lib`/`--version`/`--classifier` flags to prefetch either artifact (or cross-fetch a
  foreign classifier for CI cache warming / air-gapped installs).
- **Recorded-request async iteration** (`@rift-vs/rift`): `handle.requests({ pollIntervalMs, signal, match })`
  returns an `AsyncIterableIterator<RecordedRequest>` that polls the journal (default 250ms) and yields
  each newly-recorded request exactly once, de-duplicated via a raw-list cursor that resets on a
  cleared journal. Completes cleanly on `signal` abort or imposter deletion; requires `.record()` like
  `verify()`/`recorded()`. Push-based delivery over SSE is future work (rift#461).
- **Verification API** (`@rift-vs/rift`): `imposter.verify(match, times(n))` with WireMock-style
  near-miss diffs. Typed `RecordedRequest`, `handle.recorded(filter)` / `clearRecorded()`, and count
  matchers `times`/`atLeast`/`atMost`/`between`/`never` (exported from the package root). A zero-dep
  client-side predicate evaluator mirrors the engine's matcher semantics (all operators + params, a
  jsonpath subset); unsupported operators (`xpath`/`inject`/jsonpath wildcards) and operator-less
  predicates throw `UnsupportedPredicateError` rather than matching silently. `renderVerificationFailure`
  is a standalone renderer the testkits reuse. `SpaceHandle.recorded()/verify()` scope by flow id.
- **DSL response completion** (`@rift-vs/rift`): the response side of the fluent DSL now reaches
  every engine feature. New on `ResponseBuilder`: `badRequest()`, multi-value `header(name, string[])`,
  `binaryBody()` (base64 + `_mode: 'binary'`), `templated()`, full `_behaviors`
  (`latency(number | {min,max} | fn-string)`, `decorate()`, `shellTransform()`, `copy()`, `lookup()`,
  `behavior()` escape hatch), and `raw()` for last-wins patches. New `Fault` helper for typed chaos
  faults (`Fault.latency/error/tcp`, merged via `withFault()`); new `Script` builder
  (`Script.rhai/js/rhaiFile/jsFile/ref`) wrapped by `script()`; and a full `proxyTo()` `ProxyBuilder`
  (`proxyOnce/Always/Transparent`, `generatePredicates`, `addWaitBehavior`, `addDecorateBehavior`,
  `injectHeader`, `rewritePath`, `clientCert`).
- `willReturn(...)` now **appends** across calls (response cycling), matching the sibling SDKs;
  `respond(...)` stays an alias.
- **DSL imposter/stub/scenario completion** (`@rift-vs/rift`): `ImposterBuilder` now reaches every
  engine field — `https({cert,key,mutualAuth})` (HTTPS/mTLS), `strictBehaviors()`,
  `defaultForward()`, `serviceName()`/`serviceInfo()`, and the imposter-level `_rift` config
  (`flowState()`/`flowIdFromHeader()`, `metrics()`, `scriptEngine()`, `registerScript()` — merging
  across calls). `scenario(builder)` appends its FSM stubs in call order (interleaves with `stub()`).
  `StubBuilder` gains `id()`, `inSpace()`, and `routePattern()`. Scenario `respond(...)` is now
  variadic (response cycling within a state).

### Changed

- **Native-library cache directory on Windows** now defaults to `%LOCALAPPDATA%/rift-node` (was
  `~/.cache/rift-node`, which is not meaningful on Windows). `RIFT_CACHE_DIR` and `XDG_CACHE_HOME`
  still override on every platform; non-Windows behavior is unchanged. The conformance corpus now
  runs over the embedded transport as well (binary-gated), with an experimental Windows CI lane.

### Fixed

- **Scenario steps snapshot at `when()`.** A `when(state, stub)` step now builds the stub
  immediately, so mutating/reusing the same builder afterward no longer silently rewrites the
  committed step. `defaultResponse` rejects a proxy/inject/fault (or empty raw) response with
  `InvalidDefinition` instead of a plain `Error` or a stray empty default.
- **Proxy/inject responses no longer silently drop `_behaviors`/`_rift`.** `proxyTo(url).latency(500)`
  (and `inject(...).repeat(n)`) now emit their behaviors instead of discarding them. Invalid
  combinations fail loudly with `InvalidDefinition` rather than dropping data: an `is` body set
  alongside a proxy/inject/native fault, a `tcp` fault set via both `fault()` and `withFault()`, a
  case-variant near-miss of a native fault kind, or a script spec that isn't exactly one of
  code/file/ref.

### Changed

- **Default engine version is now v0.14.0** (`DEFAULT_ENGINE_VERSION`): the version the spawn
  transport downloads when the caller doesn't pin one. `minEngineVersion` stays at `0.12.0` —
  the SDK does not depend on any post-0.12 engine behavior.

### Fixed

- **Engine binary download actually works.** Release archives (v0.12.0+) nest their binaries
  under `rift-<version>-<target>/bin/`, and the engine binary inside is named `rift` — the
  extractor only probed for `rift-http-proxy` at the archive root or directly under the
  versioned directory, so every download failed with "archive did not contain the expected
  binary". Extraction now probes the real layout (preferring `bin/`, falling back to the
  legacy locations) and caches the binary under its canonical name as before.
- **`spawn()` no longer aborts the engine at startup.** The spawn transport defaulted `host` to
  `localhost` and always passed it as `--host` — but the engine parses `--host` into a socket
  address and rejects hostnames with "invalid socket address syntax" (all engine versions), so
  every default `spawn()` died at startup. The default is now `127.0.0.1`; an explicit `host`
  must be an IP literal.

### Changed (breaking)

- **Root exports are now the typed layer only.** The legacy weak types `Predicate`, `Response`,
  `Stub`, `ImposterConfig`, `Imposter`, and `ServerInfo` are no longer exported from the package
  root — they shadowed the real wire model. Use the `wire` namespace instead
  (`import { wire } from '@rift-vs/rift'` → `wire.Imposter`, `wire.Stub`, `wire.Predicate`, …), or
  the fluent DSL builders.
- **Error hierarchy moved to the package root.** All error classes now live in one module and are
  exported from the root (`RiftError` and subclasses). `./remote/errors.js` re-exports them for one
  release with a deprecation notice. `WireValidationError` now extends `RiftError` (previously
  extended `Error` directly).
- **`isBinaryInstalled()` removed** from `./binary.js` (it was buggy — it always returned `true`).
  `findBinary` / `downloadBinary` / `getBinaryVersion` remain as thin, deprecated wrappers over the
  reworked resolver (`resolveBinary`), which enforces SHA-256 verification.
- **`PLATFORM_MAP` and `getPlatformKey` removed** from `./binary.js` (part of the retired legacy
  download stack).

### Added

- **`@rift-vs/rift/compat` subpath** exposing the Mountebank-compatible `create()` surface
  (`create`, `CreateOptions`, `RedisOptions`, `RiftServer`, and the default export). `create()`
  remains available from the root as well and is a permanent, first-class compat surface.
- New error classes for upcoming milestones: `VerificationError`, `UnsupportedPredicateError`,
  `EngineVersionError`, `NativeLibraryError`, `InterceptUnavailable`.
- Package `exports` map for the planned subpaths `./testkit/vitest`, `./testkit/jest`, and
  `./intercept-undici` (placeholder modules until their features land).
- `wire.RecordedRequest` now names the `_mode?: 'binary'` marker the engine (≥ 0.13.6) sets on
  recorded requests whose non-UTF-8 body it base64-encoded. Additive — absent for text bodies,
  and unknown fields already round-tripped via the index signature.

### Removed

- **`axios` runtime dependency.** The compat `create()` readiness poll now uses the global `fetch`
  (same semantics: any HTTP response — including an error status — counts as ready). The package now
  has **zero runtime dependencies**. `undici`, `vitest`, and `@rift-vs/rift-embedded` are optional
  peer dependencies.

### Documentation

- README now documents the runtime contract explicitly: **ESM-only, Node ≥ 20**, zero runtime
  dependencies.
