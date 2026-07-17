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

## Native resolution: engine binary + cdylib

The spawn transport resolves the `rift` engine binary, and the embedded transport resolves the
`librift_ffi` cdylib, the same way: an explicit override, then a local sidecar-verified cache, then
an on-demand, checksummed download — never a network call when air-gapped. Run `npx rift-fetch`
(or `rift-fetch --bin` / `rift-fetch --lib`) to resolve either or both ahead of time, e.g. to warm a
CI cache or prepare an air-gapped install (`--classifier <c>` cross-fetches a cdylib for a platform
other than the host's). The cdylib's checksum check has no opt-out — a corrupt library is loaded
in-process (`dlopen`), unlike a corrupt binary, which merely fails to exec.

| Variable | Applies to | Purpose |
|---|---|---|
| `RIFT_BINARY_PATH` | engine binary | explicit binary path override; skips PATH/cache/download |
| `RIFT_FFI_LIB` | cdylib | explicit cdylib path override; skips cache/download, **no checksum** (you own the file) |
| `RIFT_CACHE_DIR` | cdylib | overrides the cache root (defaults to `XDG_CACHE_HOME`, then `~/.cache`) |
| `RIFT_DOWNLOAD_URL` / `RIFT_MIRROR_URL` | both | alternate release mirror base |
| `RIFT_OFFLINE` / `RIFT_SKIP_BINARY_DOWNLOAD` | both | air-gapped mode: never reach the network; resolution throws with manual-install instructions (file name, release URL, and the exact cache path to place it at) if nothing local is found |
| `RIFT_SKIP_CHECKSUM` | engine binary only | opt out of a missing (not mismatched) checksum sidecar — **not available for the cdylib** |

## Isolation

By default, both the Vitest fixtures (`riftTest`) and the Jest helpers (`setupRift`) give each test
its own imposters: one engine is shared per worker (acquired once, closed when the worker tears
down), but every imposter a test `.create()`s is deleted automatically once that test ends — a
`.get()`-attached handle is left alone, since attaching to an already-existing imposter isn't
ownership. That's enough isolation for most suites without ever sharing state across tests.

For a shared, already-running engine (`rift.connect(url)`, e.g. one Rift instance shared by an
entire CI job) imposters generally can't be created/deleted per test without breaking other tests
still running against them. Use the **spaces** pattern instead: build the shared imposter with
`.flowIdFromHeader(...)` so Rift derives a per-request flow id from a header, then scope stub setup
and verification to a fresh id per test via `.space(flowId)` — no imposter create/delete, and no
cross-test bleed even though every test talks to the same imposter:

```ts
const users = await engine.get(sharedUsersPort); // a shared imposter, not created by this test
const flowId = crypto.randomUUID();
const space = users.space(flowId);

await space.addStub(onGet('/api/users/1').willReturn(okJson({ id: 1 })));
await callSut(users.url, { headers: { 'X-Flow-Id': flowId } });
await space.verify(onGet('/api/users/1'), times(1));
await space.delete(); // cleans up this test's slice only — the shared imposter itself lives on
```

(The imposter itself only needs `.flowIdFromHeader('X-Flow-Id')` set once, wherever it's created.)

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
