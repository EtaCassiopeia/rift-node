# @rift-vs/rift-embedded

Embedded (in-process) engine transport for [`@rift-vs/rift`](https://www.npmjs.com/package/@rift-vs/rift)
— a [koffi](https://koffi.dev) FFI binding to the Rift engine's `librift_ffi` shared library.

**You do not import this package directly.** Installing it is what opts a project into
`rift.embedded()`; the SDK loads it dynamically at that call and reports
`EngineUnavailable` with an install hint if it is missing.

## Install

```sh
npm install --save-dev @rift-vs/rift @rift-vs/rift-embedded
```

## Use

```ts
import { rift, imposter, onGet, okJson } from '@rift-vs/rift';

// No child process, no Docker, OS-assigned ports — the engine runs inside this Node process.
await using engine = await rift.embedded();

const users = await engine.create(
  imposter('users').stub(onGet('/api/users/1').willReturn(okJson({ id: 1, name: 'Alice' }))));

await fetch(`${users.url}/api/users/1`);
```

## Why embedded

| Transport | Call | Trade-off |
|---|---|---|
| Embedded | `rift.embedded()` | Fastest startup, no port/process management — needs this package's native library |
| Spawn | `rift.spawn()` | Runs the engine binary as a child process; no native FFI dependency |
| Connect | `rift.connect()` | Talks to an already-running engine over its admin port |

## Requirements

- Node.js ≥ 20, ESM only
- A platform with a published `librift_ffi` build (resolved on demand — see the SDK's
  binary-resolution docs for `RIFT_BINARY_PATH`, air-gap, and mirror options)

The native library pin is tracked separately from the spawn transport's engine pin, because the
FFI ABI is the compatibility-sensitive surface.

## Links

- [SDK documentation and quick starts](https://github.com/achird-labs/rift-node#readme)
- [Migrating from Mountebank](https://github.com/achird-labs/rift-node/blob/master/packages/rift-core/docs/migration.md)
- [Issues](https://github.com/achird-labs/rift-node/issues)

## License

MIT — see [LICENSE](./LICENSE).
