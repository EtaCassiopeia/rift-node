/**
 * Spawn transport gate (issue #5)
 *
 * Manifest-driven binary discovery (RIFT_BINARY_PATH -> PATH -> version+sha cache -> download),
 * mirror/air-gap env overrides, sha256 verification, ephemeral-port spawn arg building, and the
 * Mountebank-compat create() surface. The resolver takes injectable IO deps so the resolution
 * order and env overrides are verified without touching the real fs/network.
 */

import { jest } from '@jest/globals';
import { createHash } from 'crypto';
import {
  resolveBinary,
  binaryDownloadUrl,
  platformTarget,
  isAirGapped,
  verifySha256,
  parseSha256Sidecar,
  fetchAndVerifyChecksum,
  buildSpawnArgs,
} from '../../src/spawn/index.js';

const DEFAULT_BASE = 'https://github.com/EtaCassiopeia/rift/releases/download';

describe('spawn — platform target mapping', () => {
  it('maps known platforms to rust target triples + archive ext', () => {
    expect(platformTarget('linux', 'x64')).toMatchObject({
      target: 'x86_64-unknown-linux-gnu',
      ext: 'tar.gz',
    });
    expect(platformTarget('darwin', 'arm64')).toMatchObject({
      target: 'aarch64-apple-darwin',
      ext: 'tar.gz',
    });
    expect(platformTarget('win32', 'x64')).toMatchObject({
      target: 'x86_64-pc-windows-msvc',
      ext: 'zip',
    });
  });

  it('throws on an unsupported platform', () => {
    expect(() => platformTarget('sunos', 'sparc')).toThrow();
  });
});

describe('spawn — download URL (mirror / air-gap overrides)', () => {
  it('defaults to the GitHub releases base', () => {
    const url = binaryDownloadUrl('v0.12.0', { env: {}, platform: 'linux', arch: 'x64' });
    expect(url).toBe(`${DEFAULT_BASE}/v0.12.0/rift-v0.12.0-x86_64-unknown-linux-gnu.tar.gz`);
  });

  it('honors a mirror via RIFT_DOWNLOAD_URL', () => {
    const url = binaryDownloadUrl('v0.12.0', {
      env: { RIFT_DOWNLOAD_URL: 'https://mirror.internal/rift' },
      platform: 'darwin',
      arch: 'arm64',
    });
    expect(url).toBe('https://mirror.internal/rift/v0.12.0/rift-v0.12.0-aarch64-apple-darwin.tar.gz');
  });

  it('an explicit opts.mirror beats the env var', () => {
    const url = binaryDownloadUrl('v0.12.0', {
      env: { RIFT_DOWNLOAD_URL: 'https://env.example' },
      mirror: 'https://explicit.example',
      platform: 'linux',
      arch: 'x64',
    });
    expect(url.startsWith('https://explicit.example/')).toBe(true);
  });
});

describe('spawn — air-gap detection', () => {
  it('true when RIFT_OFFLINE or RIFT_SKIP_BINARY_DOWNLOAD set', () => {
    expect(isAirGapped({ RIFT_OFFLINE: '1' })).toBe(true);
    expect(isAirGapped({ RIFT_SKIP_BINARY_DOWNLOAD: '1' })).toBe(true);
    expect(isAirGapped({})).toBe(false);
  });
});

describe('spawn — sha256 verification', () => {
  it('accepts a matching digest and rejects a mismatch (case-insensitive hex)', () => {
    const data = Buffer.from('hello rift');
    const digest = createHash('sha256').update(data).digest('hex');
    expect(verifySha256(data, digest)).toBe(true);
    expect(verifySha256(data, digest.toUpperCase())).toBe(true);
    expect(verifySha256(data, 'deadbeef')).toBe(false);
  });
});

describe('spawn — buildSpawnArgs', () => {
  it('always sets the admin port; adds host/loglevel when given', () => {
    expect(buildSpawnArgs(2525, {})).toEqual(['--port', '2525']);
    expect(buildSpawnArgs(0, { host: '127.0.0.1', loglevel: 'debug' })).toEqual([
      '--port',
      '0',
      '--host',
      '127.0.0.1',
      '--loglevel',
      'debug',
    ]);
  });
});

describe('spawn — resolveBinary resolution order (injected IO)', () => {
  const okPath = '/opt/rift/rift';

  it('1) returns RIFT_BINARY_PATH when set and present — no PATH/cache/download consulted', async () => {
    const lookupPath = jest.fn(() => '/should/not/be/used');
    const download = jest.fn(async () => '/downloaded');
    const got = await resolveBinary({
      env: { RIFT_BINARY_PATH: okPath },
      fileExists: (p) => p === okPath,
      lookupPath: lookupPath as unknown as (n: string) => string | null,
      download: download as unknown as (u: string, s: string | null) => Promise<string>,
    });
    expect(got).toBe(okPath);
    expect(lookupPath).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it('2) falls back to a PATH lookup', async () => {
    const download = jest.fn(async () => '/downloaded');
    const got = await resolveBinary({
      env: {},
      fileExists: () => false,
      lookupPath: (name) => (name === 'rift' ? '/usr/local/bin/rift' : null),
      download: download as unknown as (u: string, s: string | null) => Promise<string>,
    });
    expect(got).toBe('/usr/local/bin/rift');
    expect(download).not.toHaveBeenCalled();
  });

  it('3) uses the version+sha cache before downloading', async () => {
    const download = jest.fn(async () => '/downloaded');
    const got = await resolveBinary({
      env: {},
      version: 'v0.12.0',
      fileExists: () => false,
      lookupPath: () => null,
      cacheLookup: (v) => (v === 'v0.12.0' ? '/cache/rift-v0.12.0' : null),
      download: download as unknown as (u: string, s: string | null) => Promise<string>,
    });
    expect(got).toBe('/cache/rift-v0.12.0');
    expect(download).not.toHaveBeenCalled();
  });

  it('4) downloads (via the resolved URL) when nothing local is found', async () => {
    const download = jest.fn(async () => '/cache/rift-downloaded');
    const got = await resolveBinary({
      env: {},
      version: 'v0.12.0',
      platform: 'linux',
      arch: 'x64',
      fileExists: () => false,
      lookupPath: () => null,
      cacheLookup: () => null,
      download: download as unknown as (u: string, s: string | null) => Promise<string>,
    });
    expect(got).toBe('/cache/rift-downloaded');
    expect(download).toHaveBeenCalledTimes(1);
    const url = (download.mock.calls[0] as unknown[])[0] as string;
    expect(url).toContain('/v0.12.0/rift-v0.12.0-x86_64-unknown-linux-gnu.tar.gz');
  });

  it('air-gapped + nothing local → throws naming the override, never downloads', async () => {
    const download = jest.fn(async () => '/downloaded');
    await expect(
      resolveBinary({
        env: { RIFT_OFFLINE: '1' },
        version: 'v0.12.0',
        fileExists: () => false,
        lookupPath: () => null,
        cacheLookup: () => null,
        download: download as unknown as (u: string, s: string | null) => Promise<string>,
      })
    ).rejects.toThrow(/air-?gap|offline|RIFT_OFFLINE|RIFT_SKIP_BINARY_DOWNLOAD/i);
    expect(download).not.toHaveBeenCalled();
  });
});

describe('compat — create() surface is preserved', () => {
  it('still exports create and default.create', async () => {
    const mod = await import('../../src/index.js');
    expect(typeof mod.create).toBe('function');
    expect(typeof mod.default.create).toBe('function');
  });
});

describe('spawn — sha256 sidecar parsing + checksum enforcement', () => {
  it('parses a bare digest and a "<hex>  file" sidecar; rejects garbage', () => {
    const hex = 'a'.repeat(64);
    expect(parseSha256Sidecar(hex)).toBe(hex);
    expect(parseSha256Sidecar(`${hex}  rift-v0.12.0-x86_64-unknown-linux-gnu.tar.gz\n`)).toBe(hex);
    expect(parseSha256Sidecar('not-a-digest')).toBeNull();
  });

  it('verifies a matching sidecar, throws on mismatch, and refuses a missing checksum', async () => {
    const data = Buffer.from('rift-archive-bytes');
    const good = createHash('sha256').update(data).digest('hex');
    const okFetch = ((_url: string) =>
      Promise.resolve(new Response(`${good}  archive.tar.gz`, { status: 200 }))) as unknown as typeof fetch;
    await expect(
      fetchAndVerifyChecksum('http://x/archive.tar.gz', data, { env: {}, fetchImpl: okFetch })
    ).resolves.toBeUndefined();

    const badFetch = ((_url: string) =>
      Promise.resolve(new Response('b'.repeat(64), { status: 200 }))) as unknown as typeof fetch;
    await expect(
      fetchAndVerifyChecksum('http://x/archive.tar.gz', data, { env: {}, fetchImpl: badFetch })
    ).rejects.toThrow(/mismatch/i);

    const missingFetch = ((_url: string) =>
      Promise.resolve(new Response('', { status: 404 }))) as unknown as typeof fetch;
    await expect(
      fetchAndVerifyChecksum('http://x/archive.tar.gz', data, { env: {}, fetchImpl: missingFetch })
    ).rejects.toThrow(/refusing.*unverified|no sha-256/i);
    // opt-out lets a missing checksum through
    await expect(
      fetchAndVerifyChecksum('http://x/archive.tar.gz', data, {
        env: { RIFT_SKIP_CHECKSUM: '1' },
        fetchImpl: missingFetch,
      })
    ).resolves.toBeUndefined();
  });
});

describe('spawn — remaining env overrides', () => {
  it('honors RIFT_MIRROR_URL when RIFT_DOWNLOAD_URL is absent', () => {
    const url = binaryDownloadUrl('v0.12.0', {
      env: { RIFT_MIRROR_URL: 'https://mirror2.internal' },
      platform: 'linux',
      arch: 'x64',
    });
    expect(url.startsWith('https://mirror2.internal/')).toBe(true);
  });

  it('RIFT_SKIP_BINARY_DOWNLOAD air-gaps resolveBinary (throws, no download)', async () => {
    const download = jest.fn(async () => '/x');
    await expect(
      resolveBinary({
        env: { RIFT_SKIP_BINARY_DOWNLOAD: '1' },
        version: 'v0.12.0',
        fileExists: () => false,
        lookupPath: () => null,
        cacheLookup: () => null,
        download: download as unknown as (u: string, s: string | null) => Promise<string>,
      })
    ).rejects.toThrow(/air-?gap|RIFT_SKIP_BINARY_DOWNLOAD|offline/i);
    expect(download).not.toHaveBeenCalled();
  });
});
