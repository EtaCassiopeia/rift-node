/**
 * Fetch-based remote admin API client for a running Rift engine.
 *
 * Zero runtime dependencies: uses the global `fetch` (Node 20+) rather than axios/node-fetch.
 * All request/response mapping (paths, bodies, error classification) funnels through the
 * private `request`/`rawFetch` helpers so the mapping table lives in exactly one place.
 */

import type { Imposter, ImpostersConfig } from '../model/index.js';
import {
  CommunicationError,
  EngineError,
  EngineUnavailable,
  ImposterNotFound,
  InvalidDefinition,
  RiftError,
} from './errors.js';
// Type-only: erased at compile time, so this does not create a runtime import cycle even though
// ../spawn/spawn.js imports `rift` (below) from this module to attach `.spawn` at load time.
import type { SpawnFn } from '../spawn/spawn.js';

/** Shape of the engine's JSON error envelope: `{ "errors": [{ "code": "...", "message": "..." }] }`. */
interface EngineErrorBody {
  errors?: Array<{ code?: string; message?: string }>;
}

/** Optional flow-scoping shared by the scenario endpoints. */
export interface FlowScopedOptions {
  flowId?: string;
}

export class RemoteClient {
  /** Base admin URL, trailing slash stripped. */
  readonly url: string;

  #closed = false;

  constructor(url: string) {
    this.url = url;
  }

  // --- imposters ---

  async createImposter(imposter: Imposter): Promise<Imposter> {
    return this.request<Imposter>('/imposters', { method: 'POST', body: imposter });
  }

  async listImposters(): Promise<ImpostersConfig> {
    return this.request<ImpostersConfig>('/imposters', { method: 'GET' });
  }

  async getImposter(port: number): Promise<Imposter> {
    return this.request<Imposter>(`/imposters/${port}`, { method: 'GET' });
  }

  async deleteImposter(port: number): Promise<void> {
    await this.request(`/imposters/${port}`, { method: 'DELETE', allowEmpty: true });
  }

  async deleteAllImposters(): Promise<void> {
    await this.request('/imposters', { method: 'DELETE', allowEmpty: true });
  }

  async replaceImposters(config: ImpostersConfig): Promise<ImpostersConfig> {
    return this.request<ImpostersConfig>('/imposters', { method: 'PUT', body: config });
  }

  // --- scenarios ---

  async getScenarios<T = unknown>(port: number, opts?: FlowScopedOptions): Promise<T> {
    return this.request<T>(`/imposters/${port}/scenarios${this.flowQuery(opts)}`, {
      method: 'GET',
    });
  }

  async setScenarioState(
    port: number,
    name: string,
    state: string,
    opts?: FlowScopedOptions
  ): Promise<void> {
    await this.request(`/imposters/${port}/scenarios/${encodeURIComponent(name)}/state`, {
      method: 'PUT',
      body: { state, ...(opts?.flowId !== undefined ? { flowId: opts.flowId } : {}) },
      allowEmpty: true,
    });
  }

  async resetScenarios(port: number, opts?: FlowScopedOptions): Promise<void> {
    await this.request(`/imposters/${port}/scenarios/reset`, {
      method: 'POST',
      body: opts?.flowId !== undefined ? { flowId: opts.flowId } : undefined,
      allowEmpty: true,
    });
  }

  // --- spaces ---

  async getSpace<T = unknown>(port: number, flowId: string): Promise<T> {
    return this.request<T>(`/imposters/${port}/spaces/${encodeURIComponent(flowId)}`, {
      method: 'GET',
    });
  }

  async deleteSpace(port: number, flowId: string): Promise<void> {
    await this.request(`/imposters/${port}/spaces/${encodeURIComponent(flowId)}`, {
      method: 'DELETE',
      allowEmpty: true,
    });
  }

  // --- flow state (admin-prefixed) ---

  /** Returns the parsed value, or `null` if the key is absent (engine responds 404). */
  async getFlowState<T = unknown>(port: number, flowId: string, key: string): Promise<T | null> {
    const response = await this.rawFetch(this.flowStateUrl(port, flowId, key), { method: 'GET' });
    if (response.status === 404) return null;
    if (!response.ok) return this.throwForStatus(response);
    return this.parseJsonBody<T>(response, false);
  }

  async setFlowState(port: number, flowId: string, key: string, value: unknown): Promise<void> {
    await this.request(this.flowStatePath(port, flowId, key), {
      method: 'PUT',
      body: { value },
      allowEmpty: true,
    });
  }

  async deleteFlowState(port: number, flowId: string, key: string): Promise<void> {
    await this.request(this.flowStatePath(port, flowId, key), {
      method: 'DELETE',
      allowEmpty: true,
    });
  }

  // --- admin ---

  async reload(): Promise<void> {
    await this.request('/admin/reload', { method: 'POST', allowEmpty: true });
  }

  // --- disposal ---

  /** Idempotent: `fetch` holds no persistent connection, so this only flips the closed flag. */
  async close(): Promise<void> {
    this.#closed = true;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  get closed(): boolean {
    return this.#closed;
  }

  // --- internals ---

  private flowQuery(opts?: FlowScopedOptions): string {
    return opts?.flowId !== undefined ? `?flowId=${encodeURIComponent(opts.flowId)}` : '';
  }

  private flowStatePath(port: number, flowId: string, key: string): string {
    return `/admin/imposters/${port}/flow-state/${encodeURIComponent(flowId)}/${encodeURIComponent(key)}`;
  }

  private flowStateUrl(port: number, flowId: string, key: string): string {
    return `${this.url}${this.flowStatePath(port, flowId, key)}`;
  }

  /** Central request helper: every public method funnels through here (except `getFlowState`,
   * which needs to intercept 404 before the generic error mapping applies). */
  private async request<T = unknown>(
    path: string,
    init: { method: string; body?: unknown; allowEmpty?: boolean }
  ): Promise<T> {
    const response = await this.rawFetch(`${this.url}${path}`, this.toRequestInit(init));
    if (!response.ok) return this.throwForStatus(response);
    return this.parseJsonBody<T>(response, init.allowEmpty ?? false);
  }

  private toRequestInit(init: { method: string; body?: unknown }): RequestInit {
    if (init.body === undefined) {
      return { method: init.method };
    }
    return {
      method: init.method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(init.body),
    };
  }

  /** Wraps `fetch` so a rejected fetch (connection refused, DNS failure, ...) becomes a typed
   * `EngineUnavailable` instead of an opaque `TypeError`. */
  private async rawFetch(url: string, init: RequestInit): Promise<Response> {
    if (this.#closed) {
      throw new RiftError('client is closed');
    }
    try {
      return await fetch(url, init);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new EngineUnavailable(`could not reach engine at ${url}: ${message}`, { cause });
    }
  }

  private async throwForStatus(response: Response): Promise<never> {
    const message = await this.parseErrorMessage(response);
    switch (response.status) {
      case 400:
        throw new InvalidDefinition(message);
      case 404:
        throw new ImposterNotFound(message);
      default:
        throw new EngineError(response.status, message);
    }
  }

  private async parseErrorMessage(response: Response): Promise<string> {
    // Read from a clone so the original response's body stream is left untouched — some test
    // doubles (and callers holding onto the response) reuse the same instance across calls.
    const text = await response
      .clone()
      .text()
      .catch(() => '');
    if (text !== '') {
      try {
        const parsed = JSON.parse(text) as EngineErrorBody;
        const message = parsed.errors?.[0]?.message;
        if (message !== undefined) return message;
      } catch {
        // Body wasn't the expected JSON error envelope — fall back to statusText below.
      }
    }
    return response.statusText || `HTTP ${response.status}`;
  }

  /** Parses a JSON response body. An empty body is only accepted for endpoints that declare
   * `allowEmpty` (DELETE/reload/PUT-state, which legitimately return no content); a data
   * endpoint that returns an empty or non-JSON body is a communication failure, not `undefined`. */
  private async parseJsonBody<T>(response: Response, allowEmpty: boolean): Promise<T> {
    const text = await response.clone().text();
    if (text === '') {
      if (allowEmpty) return undefined as T;
      throw new CommunicationError('engine returned an empty body where data was expected');
    }
    try {
      return JSON.parse(text) as T;
    } catch (cause) {
      throw new CommunicationError('could not parse response body as JSON', { cause });
    }
  }
}

/** Strips a single trailing slash from the admin URL. */
function normalizeUrl(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

/** Connects to a Rift admin API at `url`, returning a client bound to that base URL. */
export function connect(url: string): RemoteClient {
  return new RemoteClient(normalizeUrl(url));
}

/**
 * Facade for the remote/spawn transports. `spawn` is attached by ../spawn/spawn.js when that
 * module is loaded (it's optional here so this module has no runtime dependency on it).
 */
export interface RiftFacade {
  connect: typeof connect;
  spawn?: SpawnFn;
}

export const rift: RiftFacade = { connect };
