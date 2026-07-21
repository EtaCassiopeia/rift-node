# rift-node

Official Node.js / TypeScript SDK for [Rift](https://github.com/achird-labs/rift) — a
high-performance, Mountebank-compatible HTTP/HTTPS mock server written in Rust.

**[📖 Documentation](https://achird-labs.github.io/rift-node/)** ·
[npm](https://www.npmjs.com/package/@rift-vs/rift) ·
[Migrating from Mountebank](https://achird-labs.github.io/rift-node/mountebank/migration/) ·
[API reference](https://achird-labs.github.io/rift-node/reference/sdk-api/)

One client, three transports — **embedded** (in-process, no Docker), **spawn** (a managed engine
binary), and **connect** (any running admin endpoint) — with the same typed DSL on each: imposters,
stubs, predicates, responses, response cycling, behaviors, proxy record/playback, fault injection,
stateful scenarios, and request verification.

```sh
npm install --save-dev @rift-vs/rift
```

```ts
import { rift, imposter, onGet, onPost, okJson, created, status, times } from '@rift-vs/rift';

await using engine = await rift.embedded(); // or rift.connect(url) / rift.spawn()

const users = await engine.create(
  imposter('users')
    .record()
    .stub(onGet('/api/users/1').willReturn(okJson({ id: 1, name: 'Alice' })))
    .stub(onPost('/api/users').willReturn(created().latency(50), status(503)))); // cycling

// point your system under test at users.url, then:
await users.verify(onGet('/api/users/1'), times(1));
```

Requires **Node.js ≥ 20**, ESM only. `@rift-vs/rift` has **zero runtime dependencies**.

## Packages

This is an npm-workspaces monorepo.

| Package | Path | Publishes as |
|---------|------|--------------|
| Core SDK (zero-dependency) | [`packages/rift-core`](packages/rift-core) | [`@rift-vs/rift`](https://www.npmjs.com/package/@rift-vs/rift) |
| Embedded FFI transport (koffi + `librift_ffi`) | [`packages/rift-embedded`](packages/rift-embedded) | [`@rift-vs/rift-embedded`](https://www.npmjs.com/package/@rift-vs/rift-embedded) |

`@rift-vs/rift` stays dependency-free; installing `@rift-vs/rift-embedded` (which carries the
`koffi` dependency) is what opts a project into the in-process engine behind `rift.embedded()`.

## You do not have to migrate

The Mountebank-compatible `create()` surface is **permanent**, not a deprecation shim. A raw
Mountebank imposter JSON round-trips through `fromJson()` and can be mixed with DSL-built imposters
on the same engine, so the typed DSL can be adopted stub by stub — see the
[migration guide](https://achird-labs.github.io/rift-node/mountebank/migration/).

## Development

```sh
npm ci              # install (workspaces)
npm run build       # build both packages
npm test            # full suite
npm run lint
npm run typecheck
npm run docs:check  # verify every embedded doc snippet still matches its examples/*.ts source
```

Repo-wide commands fan out to the workspaces. Run `npm run build` before `npm test` in a fresh
checkout — the unit suite loads the built `@rift-vs/rift-embedded` sibling.

### Documentation

The published site is built from [`docs/`](docs) by
[`.github/workflows/docs.yml`](.github/workflows/docs.yml) (Jekyll + just-the-docs, matching the
engine repo) and served at <https://achird-labs.github.io/rift-node/>.

Every snippet marked `<!-- docs:embed <anchor> -->` is generated **from** a compiled file in
[`packages/rift-core/examples`](packages/rift-core/examples), never hand-copied —
`npm run docs:check` fails naming the anchor if the two drift, and `npm run typecheck:examples`
keeps those examples compiling against the real source. Both run in CI, so a published page cannot
silently rot.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow.

## License

MIT — see [LICENSE](LICENSE).
