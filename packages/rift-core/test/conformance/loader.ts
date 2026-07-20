/**
 * Conformance corpus loader (issue #7).
 *
 * A `Fixture` pairs one wire imposter with the interactions replayed against it. Two sources feed
 * `Fixture`s:
 *  - the shared `sdk-conformance-<version>` corpus (rift#460): `manifest.json` + one directory per
 *    fixture under `fixtures/<name>/{imposter.json, interactions.jsonl}`. Not yet shipped, so
 *    {@link fetchCorpusTarball} exists but is exercised by nothing at unit-test time — it is
 *    network/binary-gated infrastructure for when the corpus lands.
 *  - the 6 local `test/fixtures/mb/*.json` files, loaded imposter-only (no interactions) via
 *    {@link loadMbFixture} for the DSL expressibility gate, which only needs the wire shape.
 *
 * `Fixture.imposterJson` is always a SINGLE imposter's JSON text (never the `{ imposters: [...] }`
 * envelope) — `driver.ts`'s `replayFixture` feeds it straight to `fromJson` and on to
 * `engine.create`, which takes one `Imposter`. A corpus/local file that uses the envelope form is
 * unwrapped at load time, requiring it to carry exactly one imposter.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import type { JsonValue } from '../../src/model/index.js';
import { isAirGapped, verifySha256, type EnvRecord } from '../../src/spawn/resolve.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The 6 fixtures the expressibility gate always accounts for, regardless of the corpus. */
export const MB_FIXTURES_DIR = path.join(here, '..', 'fixtures', 'mb');

export interface InteractionRequest {
  method: string;
  path: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: JsonValue;
}

export interface InteractionExpectation {
  status: number;
  headers?: Record<string, string>;
  body?: JsonValue;
  bodyContains?: string;
}

export interface Interaction {
  request: InteractionRequest;
  expect: InteractionExpectation;
}

export interface Fixture {
  name: string;
  /** A single wire `Imposter`'s JSON text — never the `{ imposters: [...] }` envelope. */
  imposterJson: string;
  interactions: Interaction[];
}

export interface CorpusManifest {
  version: string;
  fixtures: string[];
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Unwraps a parsed imposter.json body to a single imposter's JSON text. Accepts either a bare
 * imposter object or a `{ imposters: [...] }` envelope carrying exactly one entry — any other
 * shape (zero or multiple imposters in an envelope) is a fixture-authoring error, not a value to
 * silently pick from, so it throws naming the fixture.
 */
function toSingleImposterJson(fixtureName: string, parsed: unknown): string {
  if (isPlainRecord(parsed) && Array.isArray(parsed['imposters'])) {
    const imposters = parsed['imposters'];
    if (imposters.length !== 1) {
      throw new Error(
        `fixture "${fixtureName}": expected exactly one imposter in the envelope, found ${imposters.length}`
      );
    }
    return JSON.stringify(imposters[0]);
  }
  return JSON.stringify(parsed);
}

/**
 * Loads one of the 6 local `test/fixtures/mb/*.json` files as an imposter-only `Fixture` (no
 * interactions) for the DSL expressibility gate — those fixtures predate rift#460 and carry no
 * `interactions.jsonl`.
 */
export function loadMbFixture(fileName: string): Fixture {
  const raw = fs.readFileSync(path.join(MB_FIXTURES_DIR, fileName), 'utf8');
  const parsed: unknown = JSON.parse(raw);
  return {
    name: fileName,
    imposterJson: toSingleImposterJson(fileName, parsed),
    interactions: [],
  };
}

/** Loads all 6 local mb fixtures, imposter-only (no interactions). */
export function loadAllMbFixtures(): Fixture[] {
  return fs
    .readdirSync(MB_FIXTURES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map(loadMbFixture);
}

/** The raw parsed JSON of a local mb fixture file, envelope included — for comparing a DSL
 * reconstruction against the fixture exactly as authored (see `conformance.test.ts`'s gate). */
export function readMbFixtureJson(fileName: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(MB_FIXTURES_DIR, fileName), 'utf8'));
}

// --- sdk-conformance-<version> corpus (rift#460) --------------------------------------------

function readManifest(corpusDir: string): CorpusManifest {
  const raw = fs.readFileSync(path.join(corpusDir, 'manifest.json'), 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (
    !isPlainRecord(parsed) ||
    typeof parsed['version'] !== 'string' ||
    !Array.isArray(parsed['fixtures'])
  ) {
    throw new Error(`${corpusDir}/manifest.json does not match { version, fixtures: [...] }`);
  }
  return { version: parsed['version'], fixtures: parsed['fixtures'] as string[] };
}

function parseInteractionsJsonl(fixtureName: string, text: string): Interaction[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => {
      const parsed: unknown = JSON.parse(line);
      if (!isPlainRecord(parsed) || !isPlainRecord(parsed['request']) || !isPlainRecord(parsed['expect'])) {
        throw new Error(
          `fixture "${fixtureName}" interactions.jsonl line ${index + 1}: expected { request, expect }`
        );
      }
      return parsed as unknown as Interaction;
    });
}

/** Loads one fixture directory (`fixtures/<name>/{imposter.json,interactions.jsonl}`) from an
 * already-materialized corpus directory. */
export function loadCorpusFixture(corpusDir: string, name: string): Fixture {
  const dir = path.join(corpusDir, 'fixtures', name);
  const imposterRaw: unknown = JSON.parse(fs.readFileSync(path.join(dir, 'imposter.json'), 'utf8'));
  const interactionsText = fs.readFileSync(path.join(dir, 'interactions.jsonl'), 'utf8');
  return {
    name,
    imposterJson: toSingleImposterJson(name, imposterRaw),
    interactions: parseInteractionsJsonl(name, interactionsText),
  };
}

/** Loads every fixture named in the corpus manifest. */
export function loadCorpus(corpusDir: string): Fixture[] {
  const manifest = readManifest(corpusDir);
  return manifest.fixtures.map((name) => loadCorpusFixture(corpusDir, name));
}

export interface FetchCorpusOptions {
  env?: EnvRecord;
  /** Release mirror base; defaults to the same base the engine binary is fetched from. */
  mirror?: string;
  cacheDir?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_CORPUS_MIRROR = 'https://github.com/achird-labs/rift/releases/download';

function defaultCorpusCacheDir(): string {
  return path.join(here, '..', '..', '.cache', 'conformance-corpus');
}

/**
 * Fetches and caches `sdk-conformance-<version>.tar.gz` (rift#460), verifying it against its
 * `.sha256` sidecar before extracting — mirrors `spawn/resolve.ts`'s binary download discipline
 * (mandatory checksum, injectable IO, air-gap aware). Honors `RIFT_OFFLINE` /
 * `RIFT_SKIP_BINARY_DOWNLOAD` by refusing the network rather than silently returning nothing, same
 * as `resolveBinary`. Not called at unit-test time — the corpus doesn't exist yet (rift#460); this
 * is the ready slot the loader drops into once it ships.
 */
export async function fetchCorpusTarball(
  version: string,
  opts: FetchCorpusOptions = {}
): Promise<string> {
  const env = opts.env ?? process.env;
  const cacheDir = opts.cacheDir ?? defaultCorpusCacheDir();
  const destDir = path.join(cacheDir, `sdk-conformance-${version}`);
  if (fs.existsSync(path.join(destDir, 'manifest.json'))) {
    return destDir;
  }

  if (isAirGapped(env)) {
    throw new Error(
      `sdk-conformance-${version} corpus not cached locally and downloads are disabled ` +
        '(RIFT_OFFLINE or RIFT_SKIP_BINARY_DOWNLOAD is set).'
    );
  }

  const base = opts.mirror ?? env.RIFT_DOWNLOAD_URL ?? env.RIFT_MIRROR_URL ?? DEFAULT_CORPUS_MIRROR;
  const archiveName = `sdk-conformance-${version}.tar.gz`;
  const url = `${base}/${version}/${archiveName}`;
  const doFetch = opts.fetchImpl ?? fetch;

  const response = await doFetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download conformance corpus from ${url}: HTTP ${response.status}`);
  }
  const data = Buffer.from(await response.arrayBuffer());

  const shaResponse = await doFetch(`${url}.sha256`);
  if (!shaResponse.ok) {
    throw new Error(`No SHA-256 checksum available for ${url}; refusing to use an unverified download.`);
  }
  const sha = (await shaResponse.text()).trim().split(/\s+/)[0];
  if (sha === undefined || !/^[0-9a-fA-F]{64}$/.test(sha) || !verifySha256(data, sha)) {
    throw new Error(`Checksum mismatch for conformance corpus downloaded from ${url}`);
  }

  fs.mkdirSync(destDir, { recursive: true });
  const archivePath = path.join(cacheDir, archiveName);
  fs.writeFileSync(archivePath, data);
  try {
    const { execSync } = await import('child_process');
    execSync(`tar -xzf "${archivePath}" -C "${destDir}" --strip-components=1`, { stdio: 'pipe' });
  } finally {
    fs.unlinkSync(archivePath);
  }
  return destDir;
}

/** True when the corpus for `version` is already cached locally, without touching the network. */
export function corpusCached(version: string, cacheDir?: string): boolean {
  const dir = path.join(cacheDir ?? defaultCorpusCacheDir(), `sdk-conformance-${version}`);
  return fs.existsSync(path.join(dir, 'manifest.json'));
}
