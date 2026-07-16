/**
 * Loopback admin-plane HTTP client (issue #10) — the embedded transport's fallback for the handful
 * of admin operations `librift_ffi` has no C-ABI symbol for: scenarios, saved-request/proxy-response
 * deletion, enable/disable, logs, reload, and `getSpace` (the one space operation without a
 * `rift_space_*` counterpart — see `admin.ts`). Started lazily, at most once per `EmbeddedAdmin`
 * (see its `#ensurePlane`), against the loopback `rift_serve_admin` plane.
 *
 * Reuses `RemoteClient` wholesale rather than re-deriving fetch/HTTP-status mapping a second time —
 * the loopback plane speaks the exact same admin HTTP surface a remote/spawned engine does.
 */

import { RemoteClient, type FlowScopedOptions } from '../remote/client.js';

export interface BridgeOptions {
  adminUrl: string;
  apiKey: string;
}

export class AdminBridge {
  #client: RemoteClient;

  constructor(opts: BridgeOptions) {
    this.#client = new RemoteClient(opts.adminUrl, { apiKey: opts.apiKey });
  }

  getScenarios(
    port: number,
    opts?: FlowScopedOptions
  ): Promise<{ flowId: string; scenarios: Array<{ name: string; state: string }> }> {
    return this.#client.getScenarios(port, opts);
  }

  setScenarioState(port: number, name: string, state: string, opts?: FlowScopedOptions): Promise<void> {
    return this.#client.setScenarioState(port, name, state, opts);
  }

  resetScenarios(port: number, opts?: FlowScopedOptions): Promise<void> {
    return this.#client.resetScenarios(port, opts);
  }

  deleteSavedRequests(port: number, match?: string[]): Promise<void> {
    return this.#client.deleteSavedRequests(port, match);
  }

  deleteSavedProxyResponses(port: number): Promise<void> {
    return this.#client.deleteSavedProxyResponses(port);
  }

  enableImposter(port: number): Promise<void> {
    return this.#client.enableImposter(port);
  }

  disableImposter(port: number): Promise<void> {
    return this.#client.disableImposter(port);
  }

  logs(opts?: { startIndex?: number; endIndex?: number }): Promise<unknown[]> {
    return this.#client.logs(opts);
  }

  reload(): Promise<unknown> {
    return this.#client.reload();
  }

  /** No `rift_space_*` FFI symbol returns the full space object (only its stub list, via
   * `spaceListStubs`) — bridged rather than reconstructed approximately from the FFI pieces. */
  getSpace<T = unknown>(port: number, flowId: string): Promise<T> {
    return this.#client.getSpace<T>(port, flowId);
  }

  async close(): Promise<void> {
    await this.#client.close();
  }
}
