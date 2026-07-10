# Changelog

All notable changes to `@rift-vs/rift` are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## Unreleased

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

### Removed

- **`axios` runtime dependency.** The compat `create()` readiness poll now uses the global `fetch`
  (same semantics: any HTTP response — including an error status — counts as ready). The package now
  has **zero runtime dependencies**. `undici`, `vitest`, and `@rift-vs/rift-embedded` are optional
  peer dependencies.

### Documentation

- README now documents the runtime contract explicitly: **ESM-only, Node ≥ 20**, zero runtime
  dependencies.
