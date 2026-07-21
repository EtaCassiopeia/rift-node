---
layout: default
title: Home
nav_order: 1
permalink: /
---

# rift-node

Official Node.js / TypeScript SDK for [Rift](https://github.com/achird-labs/rift) — a
high-performance, Mountebank-compatible HTTP/HTTPS mock server written in Rust.

One client, three transports — **embedded** (in-process, no Docker), **spawn** (a managed engine
binary), and **connect** (any running admin endpoint) — with the same typed DSL on each: imposters,
stubs, predicates, responses, response cycling, behaviors, proxy record/playback, fault injection,
stateful scenarios, and request verification.

<!-- docs:embed hero -->
```ts
await using engine = await rift.embedded(); // or rift.connect(url) / rift.spawn()

const users = await engine.create(
  imposter('users')
    .record()
    .stub(onGet('/api/users/1').willReturn(okJson({ id: 1, name: 'Alice' })))
    .stub(onPost('/api/users').willReturn(created().latency(50), status(503)))); // cycling

await fetch(`${users.url}/api/users/1`);

await users.verify(onGet('/api/users/1'), times(1)); // throws VerificationError with a diff
```

`.record()` is what gives the imposter a journal — `verify()` and `recorded()` fail loudly on a
non-recording imposter rather than silently reporting zero calls.

## Install

```sh
npm install --save-dev @rift-vs/rift
```

Add `@rift-vs/rift-embedded` when you want the in-process transport:

```sh
npm install --save-dev @rift-vs/rift @rift-vs/rift-embedded
```

`@rift-vs/rift` has **zero runtime dependencies**. Requires **Node.js ≥ 20**, ESM only.

## Where to go next

| If you want to… | Read |
|---|---|
| Install it and create a first imposter | [Getting Started](getting-started/) |
| Decide between embedded, spawn and connect | [Transports](getting-started/transports.md) |
| Understand how the engine binary is found, or run air-gapped | [Engine binary resolution](getting-started/binary-resolution.md) |
| Build imposters, stubs, predicates and responses | [The typed DSL](guides/dsl.md) |
| Assert that your system under test called the mock | [Verification](guides/verification.md) |
| Model multi-step, stateful flows | [Scenarios & state](guides/scenarios.md) |
| Move an existing Mountebank suite across | [Mountebank compatibility](mountebank/) |
| Look up an exact type or signature | [API reference](reference/sdk-api.md) |

## Two packages

| Package | Purpose |
|---|---|
| [`@rift-vs/rift`](https://www.npmjs.com/package/@rift-vs/rift) | The SDK: typed DSL, all three transports, Mountebank-compatible `create()`. Zero runtime dependencies. |
| [`@rift-vs/rift-embedded`](https://www.npmjs.com/package/@rift-vs/rift-embedded) | Optional FFI transport (koffi → `librift_ffi`). Installing it is what opts a project into `rift.embedded()`. |

## Docs that don't rot

Every runnable snippet marked `<!-- docs:embed … -->` on this site is generated **from** a compiled
file in `examples/`, never hand-copied. `npm run docs:check` extracts each marked region, normalizes
both sides, and fails naming the anchor on any mismatch — so a snippet cannot silently drift from
the API it documents. `npm run typecheck:examples` keeps those examples compiling against the real
source. Both run in CI on every change to this site.
