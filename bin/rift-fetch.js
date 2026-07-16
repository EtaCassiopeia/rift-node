#!/usr/bin/env node

/**
 * rift-fetch: on-demand Rift engine binary + cdylib fetcher (issues #5, #9).
 *
 * Replaces the old postinstall-time download: instead of downloading on every `npm install`,
 * consumers run `npx rift-fetch` (or add it to their own setup step) to force-resolve/download
 * the engine binary and/or the `librift_ffi` cdylib ahead of time — including cross-fetching a
 * classifier that isn't the host's own, for CI cache warming or preparing an air-gapped install.
 * Imports the built resolvers from dist/, so `npm run build` must have run first (true for a
 * published package; for a local checkout, `npm run build`).
 *
 * Usage:
 *   rift-fetch                          fetch both the binary and the cdylib
 *   rift-fetch --bin                    fetch only the engine binary
 *   rift-fetch --lib                    fetch only the cdylib
 *   rift-fetch --version v0.13.0        pin the version (applies to whichever of --bin/--lib runs)
 *   rift-fetch --classifier linux-x86_64-musl   cross-fetch the cdylib for a specific classifier
 */

import { resolveBinary } from '../dist/spawn/index.js';
import { resolveCdylib } from '../dist/natives/index.js';

function parseArgs(argv) {
  const flags = { bin: false, lib: false, version: undefined, classifier: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--bin') flags.bin = true;
    else if (arg === '--lib') flags.lib = true;
    else if (arg === '--version') flags.version = argv[++i];
    else if (arg === '--classifier') flags.classifier = argv[++i];
    else {
      console.error(`rift-fetch: unrecognized argument '${arg}'`);
      process.exitCode = 1;
      return null;
    }
  }
  // No flag = both.
  if (!flags.bin && !flags.lib) {
    flags.bin = true;
    flags.lib = true;
  }
  return flags;
}

function baseEnv() {
  // Force-resolve even if the environment is otherwise configured to skip downloads: this
  // command's entire purpose is to fetch, so RIFT_OFFLINE/RIFT_SKIP_BINARY_DOWNLOAD (meant to
  // guard *implicit* downloads during `create()`/`spawn()`) don't apply here.
  const env = { ...process.env };
  delete env.RIFT_OFFLINE;
  delete env.RIFT_SKIP_BINARY_DOWNLOAD;
  return env;
}

async function fetchBin(env, version) {
  try {
    const binaryPath = await resolveBinary({ env, ...(version ? { version } : {}) });
    console.log(binaryPath);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`rift-fetch: could not resolve a Rift engine binary.\n${message}`);
    console.error(
      '\nYou can install one manually and point RIFT_BINARY_PATH at it, or check your network ' +
        'connection / RIFT_DOWNLOAD_URL / RIFT_MIRROR_URL and try again.'
    );
    return false;
  }
}

async function fetchLib(env, version, classifier) {
  try {
    const opts = { env, ...(version ? { version } : {}) };
    if (classifier) {
      const [platform, arch] = classifierToPlatformArch(classifier);
      opts.platform = platform;
      opts.arch = arch;
      // Cross-fetching a foreign classifier bypasses the host musl probe entirely — the caller
      // picked the classifier explicitly (e.g. warming a musl artifact into a glibc CI cache).
      opts.isMusl = () => classifier.endsWith('-musl');
    }
    const libPath = await resolveCdylib(opts);
    console.log(libPath);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`rift-fetch: could not resolve the Rift cdylib (librift_ffi).\n${message}`);
    console.error(
      '\nYou can install it manually and point RIFT_FFI_LIB at it, or check your network ' +
        'connection / RIFT_DOWNLOAD_URL and try again.'
    );
    return false;
  }
}

/**
 * Maps a classifier string (e.g. `linux-x86_64-musl`, `darwin-aarch64`, `windows-x86_64`) back to
 * the `[platform, arch]` pair `resolveCdylib`'s `platform`/`arch` options expect, so `--classifier`
 * can cross-fetch an artifact for a platform other than the host's.
 */
function classifierToPlatformArch(classifier) {
  const table = {
    'linux-x86_64': ['linux', 'x64'],
    'linux-x86_64-musl': ['linux', 'x64'],
    'linux-aarch64': ['linux', 'arm64'],
    'darwin-x86_64': ['darwin', 'x64'],
    'darwin-aarch64': ['darwin', 'arm64'],
    'windows-x86_64': ['win32', 'x64'],
  };
  const found = table[classifier];
  if (!found) {
    const known = Object.keys(table).join(', ');
    throw new Error(`Unknown classifier '${classifier}'. Known classifiers: ${known}`);
  }
  return found;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (!flags) return;

  const env = baseEnv();
  let ok = true;

  if (flags.bin) {
    if (flags.classifier) {
      console.error('rift-fetch: --classifier only applies to --lib (the engine binary is host-only).');
      process.exitCode = 1;
      return;
    }
    ok = (await fetchBin(env, flags.version)) && ok;
  }
  if (flags.lib) {
    ok = (await fetchLib(env, flags.version, flags.classifier)) && ok;
  }

  if (!ok) process.exitCode = 1;
}

main();
