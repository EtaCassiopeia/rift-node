---
layout: default
title: Getting Started
nav_order: 2
has_children: true
permalink: /getting-started/
---

# Getting Started

`@rift-vs/rift` is the official Node.js / TypeScript SDK for [Rift](https://github.com/achird-labs/rift),
a high-performance, Mountebank-compatible HTTP/HTTPS mock server written in Rust. A typed, fluent
DSL builds imposters/stubs/predicates/responses; three transports hand back the same `RiftEngine`
client.

## Install

```
npm i -D @rift-vs/rift
```

That's enough for `rift.spawn()` and `rift.connect(url)` — both talk to a `rift` engine binary or
process over HTTP. If you also want `rift.embedded()` (in-process, no child process, no Docker),
install the companion package too:

```
npm i -D @rift-vs/rift-embedded
```

`@rift-vs/rift-embedded` carries [`koffi`](https://koffi.dev) (FFI bindings) with it; the core
package stays dependency-free either way. See [Transports](transports.md) for why you'd pick one
over another.

## Requirements

- **Node ≥ 20.** The SDK uses the global `fetch`, `worker_threads`, and `await using`
  (`Symbol.asyncDispose`).
- **ESM-only.** The package ships as ES modules with no CommonJS build. Import it with `import`
  (or dynamic `import()` from a CommonJS module); `require('@rift-vs/rift')` is not supported.
- **Zero runtime dependencies** for the core package. `@rift-vs/rift-embedded` (koffi), `undici`
  (in-process intercept), and `vitest` (Vitest testkit) are only pulled in if you use that feature.

## Your first imposter

A complete, runnable example — an imposter with one stub, a request against it, and a verification
that the request arrived:

```ts
import { rift, imposter, onGet, okJson } from '@rift-vs/rift';

await using engine = await rift.embedded();

const users = await engine.create(
  imposter('users').stub(onGet('/api/users/1').willReturn(okJson({ id: 1, name: 'Alice' }))));

await fetch(`${users.url}/api/users/1`);
```

`await using` disposes the engine automatically at the end of the scope (closing it and, for
`spawn()`, killing the child process) — no `try`/`finally` needed. Swap `rift.embedded()` for
`rift.spawn()` or `rift.connect(url)` and the rest of the snippet is unchanged: every transport
hands back the same `RiftEngine`/`ImposterHandle` surface.

## Which transport?

`rift.embedded()`, `rift.spawn()`, and `rift.connect(url)` differ in what they require and when
you'd reach for each — see [Transports](transports.md) for the full comparison and one example per
transport. If you're spawning or embedding and want to know exactly how the engine binary or cdylib
gets found (and what to do offline/air-gapped), see
[Engine binary resolution](binary-resolution.md).

Already on Mountebank? The Mountebank-compatible `create()` stays available as a permanent drop-in
— see [Migrating from Mountebank](../mountebank/migration.md).
