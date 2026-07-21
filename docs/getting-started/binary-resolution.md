---
layout: default
title: Engine binary resolution
parent: Getting Started
nav_order: 2
permalink: /getting-started/binary-resolution/
---

# Engine binary resolution

`rift.spawn()` needs a runnable `rift` engine binary. There is **no postinstall script** —
`npm install` never touches the network or the filesystem beyond what npm itself does. Resolution
happens **on demand, at first use**: the first time you call `rift.spawn()` (or run `npx rift-fetch`
explicitly), the SDK works through a fixed order and stops at the first hit.

## Resolution order

1. **Explicit override.** `opts.binaryPath` (passed to `rift.spawn({ binaryPath })`), or else the
   `RIFT_BINARY_PATH` environment variable, used as-is if the path exists on disk.
2. **`PATH` lookup.** The first of `rift-http-proxy` / `rift` / `mb` found on `PATH`
   (`rift-http-proxy.exe` / `rift.exe` / `mb.exe` on Windows) — but only if it **`--version`-probes
   as Rift**. `mb` is checked because Mountebank-migration setups commonly have it on `PATH`, but
   Homebrew's Mountebank also installs a binary named `mb` — running it in place of Rift would be
   silently wrong. Rift reports `rift <version>` for `--version`; Mountebank reports a bare
   `<version>`. A candidate whose output doesn't match, or that fails to run at all, is skipped
   (not treated as an error) and the next candidate is tried. This means a Mountebank `mb` sitting
   on `PATH` is **skipped, not run**.
3. **Local version cache.** A previously-downloaded binary for the resolved version, under the
   cache directory (`~/.cache/rift-node/binaries/rift-<version>/` by default).
4. **Air-gap check.** If `RIFT_OFFLINE` or `RIFT_SKIP_BINARY_DOWNLOAD` is set, resolution stops
   here and throws — it never falls through to a download. The thrown error names the resolved
   version and tells you to set `RIFT_BINARY_PATH` to an existing binary, install one to `PATH`, or
   unset the air-gap override.
5. **Download.** Only reached if nothing above matched and the environment isn't air-gapped: fetch
   the release archive for the resolved version, verify its checksum, extract it, and cache the
   binary for next time.

Steps 1–3 never touch the network. Only step 5 does, and only after steps 1–4 have all missed.

## Environment variables

Faithfully reproduced from the `rift-core` package README:

| Variable | Applies to | Purpose |
|---|---|---|
| `RIFT_BINARY_PATH` | engine binary | explicit binary path override; skips PATH/cache/download |
| `RIFT_FFI_LIB` | cdylib | explicit cdylib path override; skips cache/download, **no checksum** (you own the file) |
| `RIFT_CACHE_DIR` | cdylib | overrides the cache root (defaults to `XDG_CACHE_HOME`, then `%LOCALAPPDATA%` on Windows, else `~/.cache`) |
| `RIFT_DOWNLOAD_URL` | both | alternate release mirror base (also the FFI manifest base for the cdylib) |
| `RIFT_MIRROR_URL` | engine binary | alternate release mirror base (binary only; `RIFT_DOWNLOAD_URL` wins if both are set) |
| `RIFT_OFFLINE` / `RIFT_SKIP_BINARY_DOWNLOAD` | both | air-gapped mode: never reach the network; resolution throws with manual-install instructions (file name, release URL, and the exact cache path to place it at) if nothing local is found |
| `RIFT_SKIP_CHECKSUM` | engine binary only | opt out of a missing (not mismatched) checksum sidecar — **not available for the cdylib** |

Two asymmetries are load-bearing, not oversights:

- `RIFT_CACHE_DIR` is documented against the cdylib cache; the engine binary's cache root is
  currently fixed at `~/.cache/rift-node/binaries` and isn't reconfigurable via this variable.
- `RIFT_SKIP_CHECKSUM` only exists for the engine **binary**. The cdylib's checksum check has no
  opt-out at all — a corrupt library is `dlopen`'d in-process (a memory-safety hazard), whereas a
  corrupt binary merely fails to `exec`.

A missing checksum sidecar (as opposed to a checksum that fails to verify) is fatal for the binary
too, unless `RIFT_SKIP_CHECKSUM` is set — downloads never run unverified silently by default.

## Air-gapped / offline usage

Set `RIFT_OFFLINE=1` (or `RIFT_SKIP_BINARY_DOWNLOAD=1`) to guarantee resolution never reaches the
network. In that mode, resolution still tries the explicit override, `PATH`, and the local cache —
only the final download step is disabled. If none of those hit, the thrown error is actionable: it
names the version that was being resolved and tells you to either point `RIFT_BINARY_PATH` at an
existing binary, install one onto `PATH`, or unset the air-gap variable. Run `npx rift-fetch` ahead
of time (e.g. as part of building an air-gapped image, or warming a CI cache) so the binary is
already in the local cache by the time `rift.spawn()` runs air-gapped.

## Alpine / musl

On Linux, the release archives ship both glibc and musl builds. The resolver detects the running
C library flavor and selects the `*-unknown-linux-musl` target on musl hosts (e.g. Alpine) instead
of the default `*-unknown-linux-gnu` — the glibc build won't run there without `gcompat`. Detection
prefers Node's own report (`process.report`'s `glibcVersionRuntime` field, present only on glibc
builds); its absence is corroborated by checking for `/etc/alpine-release` as a secondary signal.
This only matters for the host actually running `rift.spawn()` — cross-fetching a binary for a
*different* platform (e.g. `npx rift-fetch` preparing an image for another target) requires passing
the target's libc explicitly, since the host's own probe can't observe a platform it isn't running.

## Version pinning

The version resolved when nothing pins one explicitly is `DEFAULT_ENGINE_VERSION`, currently
`v0.15.0` — the latest Rift engine release this SDK is tested against. This is deliberately a
**separate** value from two other version markers that can look similar but serve different
purposes:

- **`DEFAULT_CDYLIB_VERSION`** (currently `v0.12.0`) — the default version resolved for the
  embedded transport's `librift_ffi` cdylib. It's pinned to `minEngineVersion`, not to the latest
  release, because the FFI ABI is the compatibility-sensitive surface for in-process embedding:
  resolving anything newer than the SDK's floor risks an ABI the embedded transport hasn't
  validated.
- **`package.json`'s `minEngineVersion`** (currently `0.12.0`) — the floor `rift.connect()`'s
  version preflight enforces against a remote engine's reported `/config` version. It only rises
  when the SDK starts depending on newer engine behavior; `DEFAULT_ENGINE_VERSION` moves
  independently and is always `>=` it.

If you need a specific engine version for `rift.spawn()`, pass `{ version }` rather than relying on
the default.
