/**
 * Spawn transport (issue #5): launches a Rift engine as a child process and hands back a
 * connected {@link RemoteClient} bound to its (ephemeral, by default) admin port.
 *
 * Mirrors the lifecycle of `create()` in ../index.ts (resolve binary, spawn, poll until ready,
 * SIGTERM-then-SIGKILL on close) but talks to the engine over the fetch-based remote client
 * instead of the legacy axios-based `RiftServerImpl`.
 */

import { type ChildProcess, spawn as spawnProcess } from 'child_process';
import net from 'net';
import { RemoteClient } from '../remote/index.js';
import { resolveBinary, type EnvRecord } from './resolve.js';

const DEFAULT_HOST = 'localhost';
const DEFAULT_STARTUP_TIMEOUT_MS = 30000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5000;
const HEALTH_CHECK_INTERVAL_MS = 100;

/** Builds the Rift engine CLI args for a given admin port. */
export function buildSpawnArgs(
  port: number,
  opts: {
    host?: string;
    loglevel?: string;
    allowInjection?: boolean;
    apiKey?: string;
    localOnly?: boolean;
    ipWhitelist?: string[];
    origin?: string;
    datadir?: string;
    configfile?: string;
    defaultTls?: { cert: string; key: string };
    metricsPort?: number;
    intercept?: boolean | { port?: number };
  } = {}
): string[] {
  const args = ['--port', String(port)];
  if (opts.host) {
    args.push('--host', opts.host);
  }
  if (opts.loglevel) {
    args.push('--loglevel', opts.loglevel);
  }
  if (opts.allowInjection) {
    args.push('--allow-injection');
  }
  if (opts.apiKey !== undefined) {
    args.push('--api-key', opts.apiKey);
  }
  if (opts.localOnly) {
    args.push('--local-only');
  }
  if (opts.ipWhitelist && opts.ipWhitelist.length > 0) {
    args.push('--ip-whitelist', opts.ipWhitelist.join(','));
  }
  if (opts.origin !== undefined) {
    args.push('--origin', opts.origin);
  }
  if (opts.datadir !== undefined) {
    args.push('--datadir', opts.datadir);
  }
  if (opts.configfile !== undefined) {
    args.push('--configfile', opts.configfile);
  }
  if (opts.defaultTls !== undefined) {
    args.push('--default-tls-cert', opts.defaultTls.cert, '--default-tls-key', opts.defaultTls.key);
  }
  if (opts.metricsPort !== undefined) {
    args.push('--metrics-port', String(opts.metricsPort));
  }
  if (opts.intercept === true) {
    args.push('--intercept-port', '0');
  } else if (typeof opts.intercept === 'object' && opts.intercept !== null) {
    // Any options object enables intercept; an unspecified port means "pick an ephemeral one" (0).
    args.push('--intercept-port', String(opts.intercept.port ?? 0));
  }
  return args;
}

export interface SpawnOptions {
  /** Admin port to bind. Defaults to an OS-assigned ephemeral port. */
  port?: number;
  host?: string;
  loglevel?: string;
  /** Engine version to resolve when the binary isn't already local. */
  version?: string;
  /** Explicit binary path override; beats `env.RIFT_BINARY_PATH`. */
  binaryPath?: string;
  env?: EnvRecord;
  mirror?: string;
  startupTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  /** --allow-injection */
  allowInjection?: boolean;
  /** --api-key (also used by the client for the Authorization header). */
  apiKey?: string;
  /** --local-only */
  localOnly?: boolean;
  /** --ip-whitelist a,b,... */
  ipWhitelist?: string[];
  /** --origin */
  origin?: string;
  /** --datadir */
  datadir?: string;
  /** --configfile */
  configfile?: string;
  /** --default-tls-cert / --default-tls-key */
  defaultTls?: { cert: string; key: string };
  /** --metrics-port */
  metricsPort?: number;
  /** --intercept-port (+ CA paths, once wired — issue #11). `true` picks an ephemeral port. */
  intercept?: boolean | { port?: number };
}

export interface SpawnedEngine {
  /** Base admin URL, e.g. `http://localhost:54321`. */
  readonly url: string;
  readonly port: number;
  readonly client: RemoteClient;
  /** Gracefully stops the engine (SIGTERM, then SIGKILL after the shutdown timeout). */
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

export type SpawnFn = (opts?: SpawnOptions) => Promise<SpawnedEngine>;

/** Asks the OS for a free TCP port by binding to port 0 and reading back what it chose. */
async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('failed to allocate an ephemeral port'));
        return;
      }
      const port = address.port;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls the admin root endpoint until it responds (any response, including non-2xx, counts). */
async function waitForAdmin(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  let lastError: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      await fetch(url, { method: 'GET' });
      return;
    } catch (error) {
      lastError = error;
      await sleep(HEALTH_CHECK_INTERVAL_MS);
    }
  }
  const detail = lastError instanceof Error ? `: ${lastError.message}` : '';
  throw new Error(`Rift engine did not become ready within ${timeoutMs}ms${detail}`);
}

/** Builds a promise that rejects if the child process exits (non-zero) or errors before startup completes. */
function watchForEarlyExit(proc: ChildProcess, stderr: () => string): Promise<never> {
  return new Promise<never>((_, reject) => {
    proc.once('exit', (code, signal) => {
      if (code !== null && code !== 0) {
        reject(new Error(`Rift engine exited with code ${code}.\nStderr: ${stderr() || 'none'}`));
      } else if (signal) {
        reject(new Error(`Rift engine killed by signal ${signal}`));
      }
    });
    proc.once('error', (error) => {
      reject(new Error(`Failed to start Rift engine: ${error.message}`));
    });
  });
}

/**
 * Resolves the Rift engine binary, spawns it bound to an (ephemeral by default) admin port, and
 * waits until it responds before returning a connected client. Throws on resolution failure,
 * spawn failure, early exit, or startup timeout — never swallows.
 */
export async function spawn(opts: SpawnOptions = {}): Promise<SpawnedEngine> {
  const host = opts.host ?? DEFAULT_HOST;
  const startupTimeoutMs = opts.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
  const shutdownTimeoutMs = opts.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;

  const binaryPath = await resolveBinary({
    version: opts.version,
    binaryPath: opts.binaryPath,
    env: opts.env,
    mirror: opts.mirror,
  });

  const port = opts.port ?? (await findFreePort());
  const args = buildSpawnArgs(port, {
    host,
    loglevel: opts.loglevel,
    allowInjection: opts.allowInjection,
    apiKey: opts.apiKey,
    localOnly: opts.localOnly,
    ipWhitelist: opts.ipWhitelist,
    origin: opts.origin,
    datadir: opts.datadir,
    configfile: opts.configfile,
    defaultTls: opts.defaultTls,
    metricsPort: opts.metricsPort,
    intercept: opts.intercept,
  });

  const proc = spawnProcess(binaryPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  let stderr = '';
  proc.stderr?.on('data', (data: Buffer) => {
    stderr += data.toString();
  });

  const url = `http://${host}:${port}`;

  try {
    await Promise.race([waitForAdmin(url, startupTimeoutMs), watchForEarlyExit(proc, () => stderr)]);
  } catch (error) {
    proc.kill('SIGKILL');
    throw error;
  }

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    // Already exited (e.g. crashed after startup): nothing to signal, don't wait out the timeout.
    if (proc.exitCode !== null || proc.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        proc.kill('SIGKILL');
        resolve();
      }, shutdownTimeoutMs);
      proc.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
      proc.kill('SIGTERM');
    });
  };

  return {
    url,
    port,
    client: new RemoteClient(url, opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
    close,
    async [Symbol.asyncDispose](): Promise<void> {
      await close();
    },
  };
}
