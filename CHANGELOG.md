# Changelog

All notable changes to `@rift-vs/rift` are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## Unreleased

### Added

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

### Fixed

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
