# rift-node

npm-workspaces monorepo for the Rift Node.js SDK (#39):

| Package | Path | Publishes as |
|---------|------|--------------|
| Core SDK (zero-dependency) | [`packages/rift-core`](packages/rift-core) | [`@rift-vs/rift`](https://www.npmjs.com/package/@rift-vs/rift) |
| Embedded FFI transport (koffi + `librift_ffi`) | [`packages/rift-embedded`](packages/rift-embedded) | `@rift-vs/rift-embedded` |

`@rift-vs/rift` stays dependency-free; installing `@rift-vs/rift-embedded` (which carries the
`koffi` dependency) is what opts a project into the in-process embedded engine behind
`rift.embedded()`. Docs live in [`packages/rift-core/docs`](packages/rift-core/docs); start with
the [API reference](packages/rift-core/docs/design/sdk-api.md) and the core package
[README](packages/rift-core/README.md).

Repo-wide commands (`npm run build` / `test` / `lint` / `docs:check`) fan out to the workspaces.
