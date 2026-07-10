# rift-node

Official Node.js / TypeScript SDK for [Rift](https://github.com/EtaCassiopeia/rift) — a
high-performance, Mountebank-compatible HTTP/HTTPS mock server written in Rust.

> **Status: design phase.** API design and milestones are tracked in the issues of this repo
> (milestones M7/M8, part of the [Rift SDK program](https://github.com/EtaCassiopeia/rift/issues/458)).
> The current `@rift-vs/rift` npm package (a Mountebank-compatible process wrapper) still ships
> from [`rift/packages/rift-node`](https://github.com/EtaCassiopeia/rift/tree/master/packages/rift-node)
> and migrates here — same package name, version line continues at 0.12.0.

## Requirements

- **Node ≥ 20.** The SDK uses the global `fetch`, `worker_threads`, and `await using`
  (`Symbol.asyncDispose`).
- **ESM-only.** The package ships as ES modules with no CommonJS build. Import it with `import`
  (or dynamic `import()` from a CommonJS module); `require('@rift-vs/rift')` is not supported.
- **Zero runtime dependencies.** `undici`, `vitest`, and `@rift-vs/rift-embedded` are *optional*
  peer dependencies, pulled in only if you use the intercept undici helper, the Vitest testkit, or
  the embedded transport, respectively.

## What it will look like

```ts
import { rift, imposter, onGet, onPost, okJson, created, status, times } from '@rift-vs/rift';

await using engine = await rift.embedded();       // or rift.connect(url) / rift.spawn()

const users = await engine.create(
  imposter('users').record()
    .stub(onGet('/api/users/1').willReturn(okJson({ id: 1, name: 'Alice' })))
    .stub(onPost('/api/users').willReturn(created().latency(50), status(503)))); // cycling

// point your SUT at users.url, then:
await users.verify(onGet('/api/users/1'), times(1));
```

Testkit (Vitest):

```ts
import { riftTest } from '@rift-vs/rift/testkit/vitest';   // engine shared per worker

riftTest('looks up user', async ({ engine }) => {
  const users = await engine.create(imposter('users').record()
    .stub(onGet('/api/users/1').willReturn(okJson({ id: 1 }))));  // auto-teardown
  await callSut(users.url);
  await users.verify(onGet('/api/users/1'), times(1));
});
```

## Artifacts

| Package | Node | Contents |
|---|---|---|
| `@rift-vs/rift` | 20+ | typed wire model + fluent DSL, remote (admin API) + spawn transports, verification, Mountebank-compat `create()` module. Zero runtime deps. |
| `@rift-vs/rift-embedded` | 20+ | in-process engine over `librift_ffi` C-ABI v2 (koffi `dlopen`, no native addon build) |
| `@rift-vs/rift/testkit` | 20+ | Vitest fixtures / Jest environment — shared engine per worker, imposter auto-teardown, `assertReceived` |

One client, three transports — embedded (in-process, no Docker, OS-assigned ports),
connect (any running Rift admin endpoint), spawn (managed `rift` binary). Full feature
surface on each: stubs/predicates/responses, response cycling, behaviors, proxy
record/playback, fault injection, stateful scenarios, spaces/flow-state, request
verification, and TLS-MITM intercept with CA/trust helpers for Node HTTP clients.

## Migrating from Mountebank

The existing drop-in story is preserved: `rift.create({ port, … })` remains available as a
thin compatibility module over the spawn transport, so current `@rift-vs/rift` (and
Mountebank) users upgrade without rewrites and adopt the typed DSL incrementally.

## Design

- RFC-003 — Rift Language SDKs, §12 Node/TS amendment (design vault)
- [Implementation plan / SDK program epic](https://github.com/EtaCassiopeia/rift/issues/458)
- Sibling SDKs: [rift-java](https://github.com/EtaCassiopeia/rift-java) ·
  [rift-scala](https://github.com/EtaCassiopeia/rift-scala) ·
  [rift-go](https://github.com/EtaCassiopeia/rift-go)

## License

MIT
