/**
 * Native library (cdylib) resolution for the future `@rift-vs/rift-embedded` transport (issue #9).
 *
 * Mirrors `src/spawn/resolve.ts`'s shape — an injectable-IO resolver with an explicit-override →
 * cache → download resolution order — but for `librift_ffi`, the C-ABI cdylib the embedded
 * transport `dlopen`s in-process, instead of a spawned engine binary. Two differences from the
 * binary resolver are load-bearing, not accidental:
 *
 *   - The checksum is MANDATORY here. There is no `RIFT_SKIP_CHECKSUM`-equivalent escape hatch for
 *     the cdylib: a corrupt/tampered native library loaded in-process is a memory-safety hazard,
 *     not just a broken subprocess.
 *   - Concurrent resolutions (e.g. parallel Jest workers, parallel CI jobs sharing a cache volume)
 *     are guarded with a lock directory, because a torn write into the shared cache would be loaded
 *     directly into this process's address space rather than merely failing an exec().
 *
 * Reused as-is from `spawn/resolve.ts`: `verifySha256`, `parseSha256Sidecar`, `isAirGapped`, and the
 * `EnvRecord` type — no sha/air-gap logic is duplicated here.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { NativeLibraryError } from '../errors.js';
import { isAirGapped, parseSha256Sidecar, verifySha256, type EnvRecord } from '../spawn/resolve.js';

const DEFAULT_MANIFEST_REPO_BASE = 'https://github.com/achird-labs/rift';
const LIB_PREFIX = 'librift_ffi';

/**
 * Cdylib version to resolve when the caller doesn't pin one. Unlike `spawn/resolve.ts`'s
 * `DEFAULT_ENGINE_VERSION` (the latest engine release the SDK is tested against), the cdylib is
 * pinned to package.json's `minEngineVersion` — the FFI ABI is the compatibility-sensitive surface
 * for in-process embedding, so resolving anything newer than the SDK's floor risks an ABI the
 * embedded transport hasn't validated. Keep this in sync with package.json's `minEngineVersion`.
 */
export const DEFAULT_CDYLIB_VERSION = 'v0.12.0';

// ---------------------------------------------------------------------------------------------
// Platform classifier
// ---------------------------------------------------------------------------------------------

export interface ClassifierInfo {
  classifier: string;
  file: string;
  ext: '.so' | '.dylib' | '.dll';
}

export interface PlatformClassifierOptions {
  platform?: string;
  arch?: string;
  env?: EnvRecord;
  /** Injectable musl probe (no args, returns true when the runtime is musl-libc). Defaults to {@link detectMusl}. */
  isMusl?: () => boolean;
  /** Only consulted by the default `isMusl` (i.e. ignored if `isMusl` is overridden). */
  existsSync?: (p: string) => boolean;
}

/**
 * musl-libc probe: Node's `process.report` header carries `glibcVersionRuntime` on glibc builds;
 * its absence is the primary signal, corroborated by the Alpine release marker file as a fallback
 * for runtimes where `process.report` is unavailable or shaped unexpectedly.
 */
export function detectMusl(existsSync: (p: string) => boolean = fs.existsSync): boolean {
  try {
    const header = (process.report?.getReport() as { header?: Record<string, unknown> } | undefined)
      ?.header;
    // glibc runtimes report a `glibcVersionRuntime` value; its ABSENCE (key missing OR undefined)
    // means musl — including non-Alpine musl distros (Void, custom) where the file probe below
    // would otherwise misclassify as glibc and dlopen the wrong .so.
    if (header) {
      return header.glibcVersionRuntime === undefined;
    }
  } catch {
    // process.report unavailable/unsupported in this runtime; fall through to the file probe.
  }
  return existsSync('/etc/alpine-release');
}

/**
 * Maps a (platform, arch[, libc]) triple to its cdylib classifier, cache filename, and extension.
 * Six supported rows: linux x64 (glibc/musl), linux arm64 (glibc only — see below), darwin x64/arm64,
 * windows x64. linux/arm64 + musl (e.g. Alpine on arm64) has no published cdylib and throws.
 */
export function classifierInfo(opts: PlatformClassifierOptions = {}): ClassifierInfo {
  const platform = opts.platform ?? process.platform;
  const arch = opts.arch ?? process.arch;
  const isMusl = opts.isMusl ?? (() => detectMusl(opts.existsSync));

  let classifier: string;
  let ext: ClassifierInfo['ext'];

  if (platform === 'linux' && arch === 'x64') {
    classifier = isMusl() ? 'linux-x86_64-musl' : 'linux-x86_64';
    ext = '.so';
  } else if (platform === 'linux' && arch === 'arm64') {
    if (isMusl()) {
      throw new NativeLibraryError(
        'No published librift_ffi cdylib for linux/arm64 + musl (e.g. Alpine on arm64). Build ' +
          'librift_ffi from source for this target, or use a glibc-based (non-Alpine) arm64 image.',
        { classifier: 'linux-aarch64-musl' }
      );
    }
    classifier = 'linux-aarch64';
    ext = '.so';
  } else if (platform === 'darwin' && arch === 'x64') {
    classifier = 'darwin-x86_64';
    ext = '.dylib';
  } else if (platform === 'darwin' && arch === 'arm64') {
    classifier = 'darwin-aarch64';
    ext = '.dylib';
  } else if (platform === 'win32' && arch === 'x64') {
    classifier = 'windows-x86_64';
    ext = '.dll';
  } else {
    throw new NativeLibraryError(
      `Unsupported platform/arch for the Rift cdylib: ${platform}-${arch}. Supported: ` +
        'linux-x86_64(-musl), linux-aarch64, darwin-x86_64, darwin-aarch64, windows-x86_64.'
    );
  }

  return { classifier, file: `${LIB_PREFIX}-${classifier}${ext}`, ext };
}

/** Convenience wrapper over {@link classifierInfo} returning just the classifier string. */
export function platformClassifier(platform?: string, arch?: string, env?: EnvRecord): string {
  return classifierInfo({ platform, arch, env }).classifier;
}

// ---------------------------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------------------------

export interface NativeManifestArtifact {
  platform: string;
  file: string;
  sha256: string;
  url: string;
}

export interface NativeManifest {
  version: string;
  abi: string;
  artifacts: NativeManifestArtifact[];
}

function parseManifest(json: unknown, url: string): NativeManifest {
  const malformed = () =>
    new NativeLibraryError(`Malformed cdylib manifest at ${url}: expected {version, abi, artifacts[]}`);
  if (!json || typeof json !== 'object') throw malformed();
  const obj = json as Record<string, unknown>;
  if (typeof obj.version !== 'string' || typeof obj.abi !== 'string' || !Array.isArray(obj.artifacts)) {
    throw malformed();
  }
  const artifacts = obj.artifacts.map((entry) => {
    if (!entry || typeof entry !== 'object') throw malformed();
    const a = entry as Record<string, unknown>;
    if (
      typeof a.platform !== 'string' ||
      typeof a.file !== 'string' ||
      typeof a.sha256 !== 'string' ||
      typeof a.url !== 'string'
    ) {
      throw malformed();
    }
    return { platform: a.platform, file: a.file, sha256: a.sha256, url: a.url };
  });
  return { version: obj.version, abi: obj.abi, artifacts };
}

async function defaultFetchManifest(url: string): Promise<NativeManifest> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new NativeLibraryError(`Failed to fetch cdylib manifest from ${url}: HTTP ${response.status}`);
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch (err) {
    // A 200 with a non-JSON body (e.g. an HTML error page from a misconfigured mirror/CDN) — surface
    // it as a typed manifest error naming the URL, not a raw SyntaxError.
    throw new NativeLibraryError(`Malformed cdylib manifest at ${url}: response body is not valid JSON`, {
      cause: err,
    });
  }
  return parseManifest(json, url);
}

async function defaultFetchArtifact(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new NativeLibraryError(`Failed to download cdylib artifact from ${url}: HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

// ---------------------------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------------------------

/**
 * `RIFT_CACHE_DIR`/`XDG_CACHE_HOME` always win, on every platform. Only when BOTH are unset does
 * the platform matter: win32 has no XDG convention, so it defaults to `%LOCALAPPDATA%` (the
 * per-user, non-roaming cache location Windows tooling conventionally uses) instead of the
 * POSIX `~/.cache`; a win32 box without `LOCALAPPDATA` set (unusual, but not impossible under e.g.
 * a stripped CI container) falls back to `~/.cache` same as every other platform. `platform` is
 * injectable so this is testable without actually running on Windows.
 */
function cacheRoot(env: EnvRecord, platform: string = process.platform): string {
  if (env.RIFT_CACHE_DIR !== undefined) return env.RIFT_CACHE_DIR;
  if (env.XDG_CACHE_HOME !== undefined) return env.XDG_CACHE_HOME;
  if (platform === 'win32' && env.LOCALAPPDATA !== undefined) return env.LOCALAPPDATA;
  return path.join(os.homedir(), '.cache');
}

function cacheDirFor(env: EnvRecord, version: string, platform: string = process.platform): string {
  return path.join(cacheRoot(env, platform), 'rift-node', 'ffi', version);
}

function defaultReadFile(p: string): Buffer | null {
  try {
    return fs.readFileSync(p);
  } catch {
    // Absence (or unreadability) of a candidate cache file is a normal miss, not an error — the
    // caller (validateCache) treats `null` as "not cached", which is what triggers a re-download.
    return null;
  }
}

/**
 * A cache hit requires BOTH the artifact and its `.sha256` sidecar to be present and mutually
 * consistent. A missing/unparsable sidecar (corrupt) or a digest that doesn't match the artifact's
 * actual bytes (mismatched — e.g. a torn write) is treated as a miss, never as a "trust it anyway".
 */
function validateCache(
  destPath: string,
  sidecarPath: string,
  fileExists: (p: string) => boolean,
  readFile: (p: string) => Buffer | null
): string | null {
  if (!fileExists(destPath) || !fileExists(sidecarPath)) return null;
  const sidecarBuf = readFile(sidecarPath);
  if (!sidecarBuf) return null;
  const sha = parseSha256Sidecar(sidecarBuf.toString('utf8'));
  if (!sha) return null;
  const data = readFile(destPath);
  if (!data) return null;
  return verifySha256(data, sha) ? destPath : null;
}

function defaultTryLock(lockDir: string): boolean {
  try {
    fs.mkdirSync(lockDir, { recursive: false });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  }
}

function defaultUnlock(lockDir: string): void {
  try {
    fs.rmdirSync(lockDir);
  } catch (err) {
    // Best-effort cleanup of our own lock directory in a `finally`: resolution has already
    // succeeded or failed correctly by this point, and a stray lock dir only costs a future
    // resolver extra poll cycles, never correctness. But an ENOTEMPTY/EACCES here means the lock
    // is genuinely stuck — log it (not ENOENT, which just means it's already gone) so a resolver
    // mysteriously timing out later has a diagnostic trail pointing at the orphaned lock dir.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`rift: could not remove native-resolution lock ${lockDir}: ${String(err)}`);
    }
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollForCache(
  destPath: string,
  sidecarPath: string,
  fileExists: (p: string) => boolean,
  readFile: (p: string) => Buffer | null,
  sleep: (ms: number) => Promise<void>,
  attempts: number,
  intervalMs: number
): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    const hit = validateCache(destPath, sidecarPath, fileExists, readFile);
    if (hit) return hit;
    await sleep(intervalMs);
  }
  return validateCache(destPath, sidecarPath, fileExists, readFile);
}

// ---------------------------------------------------------------------------------------------
// resolveCdylib
// ---------------------------------------------------------------------------------------------

export interface ResolveCdylibOptions {
  /** Explicit override path; beats `env.RIFT_FFI_LIB`. Used verbatim, no checksum (user-owned). */
  libPath?: string;
  /** Engine version to resolve when falling through to cache/download. Defaults to {@link DEFAULT_CDYLIB_VERSION}. */
  version?: string;
  env?: EnvRecord;
  platform?: string;
  arch?: string;
  isMusl?: () => boolean;
  fileExists?: (p: string) => boolean;
  readFile?: (p: string) => Buffer | null;
  /** Full override of the cache-hit check; when omitted, defaults to sidecar-validated lookup via `fileExists`/`readFile`. */
  cacheLookup?: (destPath: string, sidecarPath: string) => string | null;
  /** `false` disables the download step outright (like air-gap, but explicit/unconditional). */
  download?: false;
  fetchManifest?: (url: string) => Promise<NativeManifest>;
  fetchArtifact?: (url: string) => Promise<Buffer>;
  writeFile?: (p: string, data: Buffer) => void;
  mkdirp?: (p: string) => void;
  rename?: (src: string, dest: string) => void;
  unlink?: (p: string) => void;
  tryLock?: (lockDir: string) => boolean;
  unlock?: (lockDir: string) => void;
  sleep?: (ms: number) => Promise<void>;
  /** Lock-contention poll bounds; defaults suit a real download (~5 min), overridden in tests. */
  lockPollAttempts?: number;
  lockPollIntervalMs?: number;
}

function airGapMessage(file: string, version: string, destPath: string, releaseUrl: string): string {
  return (
    `librift_ffi cdylib not found locally and downloads are disabled (air-gapped mode). ` +
    `To install it manually:\n` +
    `  1. Download ${file} from ${releaseUrl}\n` +
    `  2. Place it at: ${destPath}\n` +
    `Or set RIFT_FFI_LIB to point at an already-present ${file}, or unset RIFT_OFFLINE / ` +
    `RIFT_SKIP_BINARY_DOWNLOAD to allow downloading ${version}.`
  );
}

/**
 * Resolves a path to the `librift_ffi` cdylib for `@rift-vs/rift-embedded`.
 *
 * Resolution order:
 *   1. `opts.libPath ?? env.RIFT_FFI_LIB`, used verbatim (no checksum — user-owned); throws if missing.
 *   2. A previously-downloaded, sidecar-verified copy in the local version cache.
 *   3. If air-gapped (or `opts.download === false`), throw with copy-pasteable manual-install instructions.
 *   4. Otherwise: fetch the version's FFI manifest, resolve this platform's artifact, download it to a
 *      temp file, verify its SHA-256 against the manifest (mandatory — no skip flag), and atomically
 *      rename it into the cache alongside a `.sha256` sidecar. Guarded by a lock directory so
 *      concurrent resolvers (parallel workers/CI jobs) revalidate the cache instead of double-downloading.
 */
export async function resolveCdylib(opts: ResolveCdylibOptions = {}): Promise<string> {
  const env = opts.env ?? process.env;
  const version = opts.version ?? DEFAULT_CDYLIB_VERSION;
  const fileExists = opts.fileExists ?? fs.existsSync;
  const readFile = opts.readFile ?? defaultReadFile;
  const writeFile = opts.writeFile ?? ((p: string, data: Buffer) => fs.writeFileSync(p, data));
  const mkdirp = opts.mkdirp ?? ((p: string) => fs.mkdirSync(p, { recursive: true }));
  const rename = opts.rename ?? ((src: string, dest: string) => fs.renameSync(src, dest));
  const unlink = opts.unlink ?? ((p: string) => fs.unlinkSync(p));
  const tryLock = opts.tryLock ?? defaultTryLock;
  const unlock = opts.unlock ?? defaultUnlock;
  const sleep = opts.sleep ?? defaultSleep;
  const lockPollAttempts = opts.lockPollAttempts ?? 600;
  const lockPollIntervalMs = opts.lockPollIntervalMs ?? 500;

  // 1. Explicit override — verbatim, no checksum (the user owns this file).
  const explicit = opts.libPath ?? env.RIFT_FFI_LIB;
  if (explicit) {
    if (fileExists(explicit)) return explicit;
    throw new NativeLibraryError(`RIFT_FFI_LIB/libPath points to a missing file: ${explicit}`, {
      path: explicit,
    });
  }

  const { classifier, file } = classifierInfo({
    platform: opts.platform,
    arch: opts.arch,
    env,
    isMusl: opts.isMusl,
  });
  const dir = cacheDirFor(env, version, opts.platform);
  const destPath = path.join(dir, file);
  const sidecarPath = `${destPath}.sha256`;
  const cacheLookup = opts.cacheLookup ?? ((d, s) => validateCache(d, s, fileExists, readFile));

  // 2. Local cache (sidecar-validated).
  const cached = cacheLookup(destPath, sidecarPath);
  if (cached) return cached;

  // 3. Air-gapped / explicit opt-out: refuse the network, with copy-pasteable manual instructions.
  const manifestBase = env.RIFT_DOWNLOAD_URL ?? DEFAULT_MANIFEST_REPO_BASE;
  const manifestUrl = `${manifestBase}/releases/download/${version}/ffi-manifest.json`;
  if (opts.download === false || isAirGapped(env)) {
    // Point the manual-install step at the cdylib ASSET, not the manifest JSON — a user copy-pasting
    // the message must fetch the library itself. The asset follows the release-download convention.
    const assetUrl = `${manifestBase}/releases/download/${version}/${file}`;
    throw new NativeLibraryError(airGapMessage(file, version, destPath, assetUrl), {
      path: destPath,
      classifier,
    });
  }

  // 4. Download, guarded by a lock so concurrent resolvers revalidate instead of double-downloading.
  // The version dir must exist before the lock (a subdirectory of it) can be created inside it.
  mkdirp(dir);
  const lockDir = `${destPath}.lock`;
  const acquired = tryLock(lockDir);
  if (!acquired) {
    const revalidated = await pollForCache(
      destPath,
      sidecarPath,
      fileExists,
      readFile,
      sleep,
      lockPollAttempts,
      lockPollIntervalMs
    );
    if (revalidated) return revalidated;
    throw new NativeLibraryError(
      `Timed out waiting for a concurrent download of ${file} to finish (lock held at ${lockDir}). ` +
        `If no other resolver is running, a previous one likely crashed — remove the stale lock: rm -rf ${lockDir}`,
      { path: destPath, classifier }
    );
  }

  try {
    // Double-check: another resolver may have populated the cache between our first lookup and
    // acquiring the lock (e.g. it held the lock, finished, and released it just before we tried).
    const recheck = cacheLookup(destPath, sidecarPath);
    if (recheck) return recheck;

    const fetchManifest = opts.fetchManifest ?? defaultFetchManifest;
    const manifest = await fetchManifest(manifestUrl);

    if (manifest.abi !== 'v2') {
      throw new NativeLibraryError(
        `Unsupported FFI manifest ABI "${manifest.abi}" (expected "v2") at ${manifestUrl}. This SDK ` +
          `is pinned to engine ${version} (package.json minEngineVersion); upgrade @rift-vs/rift, or ` +
          `pin an engine release whose manifest declares abi "v2".`,
        { classifier }
      );
    }

    const entry = manifest.artifacts.find((a) => a.platform === classifier);
    if (!entry) {
      const available = manifest.artifacts.map((a) => a.platform).join(', ') || '(none)';
      throw new NativeLibraryError(
        `No cdylib artifact for platform "${classifier}" in the ${version} FFI manifest. ` +
          `Available: ${available}.`,
        { classifier }
      );
    }

    const fetchArtifact = opts.fetchArtifact ?? defaultFetchArtifact;
    const data = await fetchArtifact(entry.url);

    const tmpPath = `${destPath}.tmp-${process.pid}-${Date.now()}`;
    writeFile(tmpPath, data);

    // Mandatory verification — there is NO skip flag for the cdylib (unlike the binary path's
    // RIFT_SKIP_CHECKSUM): a corrupt/tampered library gets dlopen()'d in-process, not merely exec()'d.
    if (!verifySha256(data, entry.sha256)) {
      // Best-effort temp cleanup — a failing unlink must not mask the (more important) checksum error.
      try {
        unlink(tmpPath);
      } catch {
        // ignore; the checksum mismatch below is the error that matters
      }
      throw new NativeLibraryError(`Checksum mismatch for cdylib downloaded from ${entry.url}`, {
        path: destPath,
        classifier,
      });
    }

    rename(tmpPath, destPath);
    // Sidecar written only after the atomic rename, so a reader never observes a "hit" for a file
    // that isn't fully in place yet (validateCache requires both to exist).
    writeFile(sidecarPath, Buffer.from(`${entry.sha256}  ${file}\n`));
    return destPath;
  } finally {
    unlock(lockDir);
  }
}
