# Moving from `rift/packages/rift-node`

The `@rift-vs/rift` npm package now ships from **this repository** (`rift-node`), not from
`rift/packages/rift-node` in the main [`rift`](https://github.com/achird-labs/rift) monorepo.

- **Same package name.** `npm install @rift-vs/rift` resolves to the same package either way —
  nothing changes in your `package.json`.
- **Same version line, continued.** This repo picks up at 0.12.0 and continues forward; it is not
  a fork or a rewrite-from-zero.
- **The monorepo copy is frozen.** `rift/packages/rift-node` no longer receives new features or
  releases. All Node/TypeScript SDK development — the full typed DSL, the three transports, the
  testkit, this documentation — happens here.
- **No action required for most users.** If you only ever `npm install`ed the package, nothing
  changes. If you had a `git submodule`/monorepo-path dependency directly on
  `rift/packages/rift-node` source, point it at this repo instead.

## Docs redirects

Links from the `rift` monorepo's own docs/README pointing at `packages/rift-node` are tracked as a
follow-up in the `rift` repo (not this one) — see that repo's issue tracker for the redirect work.
This repo's docs (this file, [`README.md`](../README.md), [`docs/migration.md`](migration.md)) are
the current source of truth in the meantime.
