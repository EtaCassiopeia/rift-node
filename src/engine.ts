/**
 * RiftEngine facade + imposter/space/flow-state handles (issue #21).
 *
 * `RiftEngine` and its handles are implemented exactly once, over the `AdminApi` interface below;
 * each transport (remote / spawn / embedded) only has to produce an `AdminApi` implementation.
 * This replaces the old split where spawn returned `{ url, port, client }` and remote returned a
 * bare client with no shared ergonomic surface.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import type {
  Imposter,
  ImpostersConfig,
  RecordedRequest as WireRecordedRequest,
  Stub,
} from './model/index.js';
import { ImposterBuilder } from './dsl/imposter.js';
import { StubBuilder } from './dsl/stub.js';
import { RemoteClient, normalizeUrl, type FlowScopedOptions } from './remote/client.js';
import { spawn as spawnProcess, type SpawnOptions } from './spawn/spawn.js';
import {
  EngineUnavailable,
  EngineVersionError,
  ImposterNotFound,
  InterceptUnavailable,
  RiftError,
  VerificationError,
} from './errors.js';
import {
  atLeast,
  predicatesOf,
  toRecordedRequest,
  type CountMatcher,
  type RecordedFilter,
  type RecordedRequest,
  type RequestMatch,
} from './verify/index.js';
import { computeClosest, evalPredicates } from './verify/eval.js';

// --- shared small types ----------------------------------------------------------------------

export type Transport = 'remote' | 'spawn' | 'embedded';

export interface ImposterSummary {
  port: number;
  protocol: string;
  name?: string;
  numberOfRequests: number;
}

export interface BuildInfo {
  version: string;
  commit?: string;
  builtAt?: string;
  features: string[];
}

// --- AdminApi: the total, typed admin surface every transport implements ----------------------

export interface AdminApi extends AsyncDisposable {
  createImposter(imposter: Imposter): Promise<Imposter>;
  listImposters(opts?: { replayable?: boolean }): Promise<ImpostersConfig>;
  getImposter(
    port: number,
    opts?: { replayable?: boolean; removeProxies?: boolean }
  ): Promise<Imposter>;
  deleteImposter(port: number): Promise<Imposter>;
  deleteAllImposters(): Promise<void>;
  replaceImposters(config: ImpostersConfig): Promise<ImpostersConfig>;

  addStub(port: number, stub: Stub, index?: number): Promise<void>;
  replaceStubs(port: number, stubs: Stub[]): Promise<void>;
  getStub(port: number, ref: number | { id: string }): Promise<Stub>;
  updateStub(port: number, ref: number | { id: string }, stub: Stub): Promise<void>;
  deleteStub(port: number, ref: number | { id: string }): Promise<void>;

  getSavedRequests(port: number, match?: string[]): Promise<WireRecordedRequest[]>;
  deleteSavedRequests(port: number, match?: string[]): Promise<void>;
  deleteSavedProxyResponses(port: number): Promise<void>;

  enableImposter(port: number): Promise<void>;
  disableImposter(port: number): Promise<void>;

  getScenarios(
    port: number,
    opts?: FlowScopedOptions
  ): Promise<{ flowId: string; scenarios: Array<{ name: string; state: string }> }>;
  setScenarioState(port: number, name: string, state: string, opts?: FlowScopedOptions): Promise<void>;
  resetScenarios(port: number, opts?: FlowScopedOptions): Promise<void>;

  addSpaceStub(port: number, flowId: string, stub: Stub): Promise<void>;
  listSpaceStubs(port: number, flowId: string): Promise<{ space: string; stubs: Stub[] }>;
  getSpace<T = unknown>(port: number, flowId: string): Promise<T>;
  deleteSpace(port: number, flowId: string): Promise<void>;

  getFlowState<T = unknown>(port: number, flowId: string, key: string): Promise<T | undefined>;
  setFlowState(port: number, flowId: string, key: string, value: unknown): Promise<void>;
  deleteFlowState(port: number, flowId: string, key: string): Promise<void>;

  config(): Promise<Record<string, unknown>>;
  logs(opts?: { startIndex?: number; endIndex?: number }): Promise<unknown[]>;
  reload(): Promise<unknown>;

  /** The admin base URL when the transport is URL-backed (remote/spawn); absent for embedded. */
  readonly url?: string;
  readonly closed: boolean;
  close(): Promise<void>;
}

// --- handles -----------------------------------------------------------------------------------

export interface FlowStateHandle {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface SpaceHandle {
  readonly flowId: string;
  addStub(stub: StubBuilder | Stub): Promise<void>;
  stubs(): Promise<{ space: string; stubs: Stub[] }>;
  delete(): Promise<void>;

  // verification (issue #6), scoped to this flow id via `match=flow_id=<id>`
  recorded(match?: RequestMatch): Promise<RecordedRequest[]>;
  verify(match: RequestMatch, count?: CountMatcher): Promise<void>;

  scenarios(): Promise<Array<{ name: string; state: string }>>;
  setScenarioState(name: string, state: string): Promise<void>;
  resetScenarios(): Promise<void>;
  readonly state: FlowStateHandle;
}

export interface ImposterHandle extends AsyncDisposable {
  readonly port: number;
  /** `${protocol}://${reachableHost}:${port}` — a `0.0.0.0`/`::`/empty bind host maps to 127.0.0.1. */
  readonly url: string;
  readonly name?: string;
  readonly protocol: 'http' | 'https';

  // stub surgery
  addStub(stub: StubBuilder | Stub, opts?: { index?: number }): Promise<void>;
  replaceStubs(...stubs: Array<StubBuilder | Stub>): Promise<void>;
  updateStub(ref: number | { id: string }, stub: StubBuilder | Stub): Promise<void>;
  deleteStub(ref: number | { id: string }): Promise<void>;
  stubs(): Promise<Stub[]>;

  // verification (issue #6)
  recorded(filter?: RecordedFilter): Promise<RecordedRequest[]>;
  clearRecorded(): Promise<void>;
  /** Throws `VerificationError` when the count isn't satisfied; default `count` is `atLeast(1)`.
   * Throws `RiftError` (naming `.record()`) if the imposter wasn't created with recording enabled. */
  verify(match: RequestMatch, count?: CountMatcher): Promise<void>;

  // scenarios
  scenarios(flowId?: string): Promise<Array<{ name: string; state: string }>>;
  setScenarioState(name: string, state: string, flowId?: string): Promise<void>;
  resetScenarios(flowId?: string): Promise<void>;

  // spaces & flow state
  space(flowId: string): SpaceHandle;
  flowState(flowId: string): FlowStateHandle;

  // lifecycle & export
  enable(): Promise<void>;
  disable(): Promise<void>;
  clearProxyRecordings(): Promise<void>;
  toJson(opts?: { replayable?: boolean; removeProxies?: boolean }): Promise<Imposter>;
  delete(): Promise<void>;
}

export interface RiftEngine extends AsyncDisposable {
  readonly transport: Transport;

  create(def: ImposterBuilder | Imposter): Promise<ImposterHandle>;
  get(port: number): Promise<ImposterHandle>;
  list(): Promise<ImposterSummary[]>;
  deleteAll(): Promise<void>;
  replaceAll(defs: Array<ImposterBuilder | Imposter>): Promise<ImposterHandle[]>;

  buildInfo(): Promise<BuildInfo>;
  adminUrl(): Promise<string>;

  intercept(options?: unknown): Promise<never>;

  readonly admin: AdminApi;
  close(): Promise<void>;
  readonly closed: boolean;
}

// --- helpers -------------------------------------------------------------------------------

function toWireImposter(def: ImposterBuilder | Imposter): Imposter {
  const wire = def instanceof ImposterBuilder ? def.build() : def;
  // Protocol is required by Mountebank; default to 'http' if not specified
  return wire.protocol === undefined ? { ...wire, protocol: 'http' } : wire;
}

function toWireStub(def: StubBuilder | Stub): Stub {
  return def instanceof StubBuilder ? def.build() : def;
}

function normalizeProtocol(protocol: unknown): 'http' | 'https' {
  return protocol === 'https' ? 'https' : 'http';
}

/** Normalizes a host to a dialable one: strips IPv6 brackets, and maps an any-interface bind
 * (`0.0.0.0`/`::`/empty/absent) to loopback. A concrete hostname/IP is returned unchanged. */
function normalizeHost(host: string | undefined): string {
  if (host === undefined || host === '') return '127.0.0.1';
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (bare === '0.0.0.0' || bare === '::') return '127.0.0.1';
  return bare;
}

/** `hostHint` (the admin URL's host, set by the remote/spawn transports) wins over the imposter's
 * own bind host; either way the any-interface normalization applies so `.url` is always dialable. */
function reachableHost(hostHint: string | undefined, bindHost: string | undefined): string {
  return normalizeHost(hostHint ?? bindHost);
}

class FlowStateHandleImpl implements FlowStateHandle {
  constructor(
    private readonly admin: AdminApi,
    private readonly port: number,
    private readonly flowId: string
  ) {}

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.admin.getFlowState<T>(this.port, this.flowId, key);
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.admin.setFlowState(this.port, this.flowId, key, value);
  }

  async delete(key: string): Promise<void> {
    await this.admin.deleteFlowState(this.port, this.flowId, key);
  }
}

class SpaceHandleImpl implements SpaceHandle {
  readonly state: FlowStateHandle;

  constructor(
    private readonly admin: AdminApi,
    private readonly port: number,
    readonly flowId: string,
    private readonly imposterLabel: string,
    private readonly recordingEnabled: boolean
  ) {
    this.state = new FlowStateHandleImpl(admin, port, flowId);
  }

  async addStub(stub: StubBuilder | Stub): Promise<void> {
    await this.admin.addSpaceStub(this.port, this.flowId, toWireStub(stub));
  }

  async stubs(): Promise<{ space: string; stubs: Stub[] }> {
    return this.admin.listSpaceStubs(this.port, this.flowId);
  }

  async delete(): Promise<void> {
    await this.admin.deleteSpace(this.port, this.flowId);
  }

  async recorded(match?: RequestMatch): Promise<RecordedRequest[]> {
    requireRecording(this.imposterLabel, this.recordingEnabled);
    return fetchRecorded(this.admin, this.port, { match, flowId: this.flowId });
  }

  async verify(match: RequestMatch, count: CountMatcher = atLeast(1)): Promise<void> {
    await runVerify(this.admin, this.port, this.imposterLabel, this.recordingEnabled, match, count, {
      flowId: this.flowId,
    });
  }

  async scenarios(): Promise<Array<{ name: string; state: string }>> {
    const result = await this.admin.getScenarios(this.port, { flowId: this.flowId });
    return result.scenarios;
  }

  async setScenarioState(name: string, state: string): Promise<void> {
    await this.admin.setScenarioState(this.port, name, state, { flowId: this.flowId });
  }

  async resetScenarios(): Promise<void> {
    await this.admin.resetScenarios(this.port, { flowId: this.flowId });
  }
}

/** `imposter "users" (port 55123)` / `imposter (port 55123)` — the shared prefix for verification
 * messages, matching the design's rendered `VerificationError` header exactly. */
function imposterLabel(name: string | undefined, port: number): string {
  return name !== undefined ? `imposter "${name}" (port ${port})` : `imposter (port ${port})`;
}

/** A non-recording imposter has no journal at all, so `verify()`/`recorded()` both fail loudly
 * with a `RiftError` naming the `.record()` fix rather than silently reporting an empty result. */
function requireRecording(label: string, recordingEnabled: boolean): void {
  if (!recordingEnabled) {
    throw new RiftError(
      `${label} was created without recording enabled — add .record() when building the imposter to use verify()/recorded()`
    );
  }
}

/** Fetches recorded requests: `flowId` filters server-side (`match=flow_id=<id>`); `match`
 * (predicates) is evaluated client-side against the (possibly flow-filtered) fetch. */
async function fetchRecorded(
  admin: AdminApi,
  port: number,
  filter: { match?: RequestMatch; flowId?: string }
): Promise<RecordedRequest[]> {
  const serverMatch = filter.flowId !== undefined ? [`flow_id=${filter.flowId}`] : undefined;
  const mapped = (await admin.getSavedRequests(port, serverMatch)).map(toRecordedRequest);
  if (filter.match === undefined) return mapped;
  const predicates = predicatesOf(filter.match);
  return mapped.filter((r) => evalPredicates(predicates, r));
}

/** Shared `verify()` body for both `ImposterHandle` and `SpaceHandle`: resolves once `count` is
 * satisfied, otherwise throws an enriched `VerificationError` (or, when recording was never
 * enabled, a plain `RiftError` naming the `.record()` fix — there's no journal to check at all). */
async function runVerify(
  admin: AdminApi,
  port: number,
  label: string,
  recordingEnabled: boolean,
  match: RequestMatch,
  count: CountMatcher,
  scope: { flowId?: string }
): Promise<void> {
  requireRecording(label, recordingEnabled);
  const predicates = predicatesOf(match);
  const recorded = await fetchRecorded(admin, port, scope);
  const matched = recorded.filter((r) => evalPredicates(predicates, r)).length;
  if (matched >= count.min && matched <= count.max) return;
  const closest = matched === 0 ? computeClosest(predicates, recorded) : undefined;
  throw new VerificationError(`Verification failed for ${label}`, {
    expected: predicates,
    count: { matched, total: recorded.length, matcher: count },
    recorded,
    closest,
  });
}

class ImposterHandleImpl implements ImposterHandle {
  readonly port: number;
  readonly url: string;
  readonly name: string | undefined;
  readonly protocol: 'http' | 'https';
  private readonly recordingEnabled: boolean;

  constructor(
    private readonly admin: AdminApi,
    imp: Imposter,
    hostHint: string | undefined
  ) {
    if (imp.port === undefined) {
      throw new RiftError('engine returned an imposter without a port');
    }
    this.port = imp.port;
    this.protocol = normalizeProtocol(imp.protocol);
    this.name = imp.name;
    this.recordingEnabled = imp.recordRequests === true;
    this.url = `${this.protocol}://${reachableHost(hostHint, imp.host)}:${this.port}`;
  }

  async addStub(stub: StubBuilder | Stub, opts?: { index?: number }): Promise<void> {
    await this.admin.addStub(this.port, toWireStub(stub), opts?.index);
  }

  async replaceStubs(...stubs: Array<StubBuilder | Stub>): Promise<void> {
    await this.admin.replaceStubs(this.port, stubs.map(toWireStub));
  }

  async updateStub(ref: number | { id: string }, stub: StubBuilder | Stub): Promise<void> {
    await this.admin.updateStub(this.port, ref, toWireStub(stub));
  }

  async deleteStub(ref: number | { id: string }): Promise<void> {
    await this.admin.deleteStub(this.port, ref);
  }

  async stubs(): Promise<Stub[]> {
    const imp = await this.admin.getImposter(this.port);
    return imp.stubs ?? [];
  }

  async recorded(filter?: RecordedFilter): Promise<RecordedRequest[]> {
    requireRecording(imposterLabel(this.name, this.port), this.recordingEnabled);
    return fetchRecorded(this.admin, this.port, { match: filter?.match, flowId: filter?.flowId });
  }

  async clearRecorded(): Promise<void> {
    await this.admin.deleteSavedRequests(this.port);
  }

  async verify(match: RequestMatch, count: CountMatcher = atLeast(1)): Promise<void> {
    await runVerify(
      this.admin,
      this.port,
      imposterLabel(this.name, this.port),
      this.recordingEnabled,
      match,
      count,
      {}
    );
  }

  async scenarios(flowId?: string): Promise<Array<{ name: string; state: string }>> {
    const result = await this.admin.getScenarios(this.port, flowId !== undefined ? { flowId } : undefined);
    return result.scenarios;
  }

  async setScenarioState(name: string, state: string, flowId?: string): Promise<void> {
    await this.admin.setScenarioState(
      this.port,
      name,
      state,
      flowId !== undefined ? { flowId } : undefined
    );
  }

  async resetScenarios(flowId?: string): Promise<void> {
    await this.admin.resetScenarios(this.port, flowId !== undefined ? { flowId } : undefined);
  }

  space(flowId: string): SpaceHandle {
    return new SpaceHandleImpl(
      this.admin,
      this.port,
      flowId,
      imposterLabel(this.name, this.port),
      this.recordingEnabled
    );
  }

  flowState(flowId: string): FlowStateHandle {
    return new FlowStateHandleImpl(this.admin, this.port, flowId);
  }

  async enable(): Promise<void> {
    await this.admin.enableImposter(this.port);
  }

  async disable(): Promise<void> {
    await this.admin.disableImposter(this.port);
  }

  async clearProxyRecordings(): Promise<void> {
    await this.admin.deleteSavedProxyResponses(this.port);
  }

  async toJson(opts?: { replayable?: boolean; removeProxies?: boolean }): Promise<Imposter> {
    return this.admin.getImposter(this.port, opts);
  }

  /** Idempotent: a second `delete()` (or dispose after an explicit delete) swallows only
   * `ImposterNotFound` — every other failure still propagates. */
  async delete(): Promise<void> {
    try {
      await this.admin.deleteImposter(this.port);
    } catch (error) {
      if (error instanceof ImposterNotFound) return;
      throw error;
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.delete();
  }
}

interface EngineOptions {
  hostHint?: string;
  onClose?: () => Promise<void>;
}

export class Engine implements RiftEngine {
  #closed = false;

  constructor(
    private readonly adminClient: AdminApi,
    readonly transport: Transport,
    private readonly opts: EngineOptions = {}
  ) {}

  get admin(): AdminApi {
    return this.adminClient;
  }

  async create(def: ImposterBuilder | Imposter): Promise<ImposterHandle> {
    const created = await this.adminClient.createImposter(toWireImposter(def));
    return this.handleFrom(created);
  }

  async get(port: number): Promise<ImposterHandle> {
    const imp = await this.adminClient.getImposter(port);
    return this.handleFrom(imp);
  }

  async list(): Promise<ImposterSummary[]> {
    const cfg = await this.adminClient.listImposters();
    return cfg.imposters.map((imp) => this.summaryOf(imp));
  }

  async deleteAll(): Promise<void> {
    await this.adminClient.deleteAllImposters();
  }

  async replaceAll(defs: Array<ImposterBuilder | Imposter>): Promise<ImposterHandle[]> {
    const result = await this.adminClient.replaceImposters({ imposters: defs.map(toWireImposter) });
    return result.imposters.map((imp) => this.handleFrom(imp));
  }

  async buildInfo(): Promise<BuildInfo> {
    const cfg = await this.adminClient.config();
    return buildInfoFromConfig(cfg);
  }

  async adminUrl(): Promise<string> {
    if (typeof this.adminClient.url === 'string') return this.adminClient.url;
    throw new EngineUnavailable(
      'adminUrl() has no wired admin URL on this transport (embedded transport is wired in issue #10)'
    );
  }

  async intercept(): Promise<never> {
    throw new InterceptUnavailable('intercept() is wired in issue #11');
  }

  /** Idempotent. Closes the admin client even if `onClose` (e.g. killing a spawned process) throws,
   * so a failed teardown never leaks the client; `closed` only flips once cleanup has run. */
  async close(): Promise<void> {
    if (this.#closed) return;
    try {
      await this.opts.onClose?.();
    } finally {
      await this.adminClient.close();
      this.#closed = true;
    }
  }

  get closed(): boolean {
    return this.#closed;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  private handleFrom(imp: Imposter): ImposterHandle {
    return new ImposterHandleImpl(this.adminClient, imp, this.opts.hostHint);
  }

  private summaryOf(imp: Imposter): ImposterSummary {
    if (imp.port === undefined) {
      throw new RiftError('engine returned an imposter without a port');
    }
    const numberOfRequests = imp.numberOfRequests;
    return {
      port: imp.port,
      protocol: normalizeProtocol(imp.protocol),
      name: imp.name,
      numberOfRequests: typeof numberOfRequests === 'number' ? numberOfRequests : 0,
    };
  }
}

// --- config -> BuildInfo / version preflight ------------------------------------------------

interface EngineConfigOptions {
  version?: unknown;
  commit?: unknown;
  builtAt?: unknown;
}

function configOptions(cfg: Record<string, unknown>): EngineConfigOptions {
  const options = cfg['options'];
  return options !== null && typeof options === 'object' ? (options as EngineConfigOptions) : {};
}

function extractVersion(cfg: Record<string, unknown>): string | undefined {
  const { version } = configOptions(cfg);
  return typeof version === 'string' ? version : undefined;
}

function buildInfoFromConfig(cfg: Record<string, unknown>): BuildInfo {
  const { version, commit, builtAt } = configOptions(cfg);
  return {
    version: typeof version === 'string' ? version : 'unknown',
    commit: typeof commit === 'string' ? commit : undefined,
    builtAt: typeof builtAt === 'string' ? builtAt : undefined,
    features: [],
  };
}

function parseSemver(version: string): [number, number, number] | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (match === null) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** True when `found` is strictly below `required` (major, then minor, then patch). */
function isBelowVersion(found: [number, number, number], required: [number, number, number]): boolean {
  const [fMajor, fMinor, fPatch] = found;
  const [rMajor, rMinor, rPatch] = required;
  if (fMajor !== rMajor) return fMajor < rMajor;
  if (fMinor !== rMinor) return fMinor < rMinor;
  return fPatch < rPatch;
}

/** Returns a human-readable problem string when the engine version fails the compatibility gate,
 * or `undefined` when it's fine. Distinguishes "couldn't determine" and "unrecognizable" from a
 * genuine downgrade so the caller's fail/warn policy governs every case (never a raw parse throw). */
function versionIssue(found: string | undefined): string | undefined {
  if (found === undefined) {
    return `could not determine the connected engine version (its /config reported none)`;
  }
  const parsed = parseSemver(found);
  const required = parseSemver(MIN_ENGINE_VERSION);
  if (parsed === undefined || required === undefined) {
    return `connected engine version "${found}" is not a recognizable version`;
  }
  if (isBelowVersion(parsed, required)) {
    return `connected engine ${found} is older than this SDK's minimum supported version ${MIN_ENGINE_VERSION}`;
  }
  return undefined;
}

const here = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as {
  minEngineVersion?: string;
};
const MIN_ENGINE_VERSION = packageJson.minEngineVersion ?? '0.0.0';

// --- entry points: rift.connect / rift.spawn / rift.embedded --------------------------------

export interface ConnectOptions {
  /** Sent as `Authorization: Bearer <apiKey>` on every admin request. */
  apiKey?: string;
  headers?: Record<string, string>;
  /** Per-request timeout; default 30_000ms. */
  timeoutMs?: number;
  /** Compares the connected engine's `GET /config` version against `minEngineVersion`. Default `'fail'`. */
  versionCheck?: 'fail' | 'warn' | 'off';
}

async function connectEngine(url: string, opts: ConnectOptions = {}): Promise<Engine> {
  const normalized = normalizeUrl(url);
  const client = new RemoteClient(normalized, {
    apiKey: opts.apiKey,
    headers: opts.headers,
    timeoutMs: opts.timeoutMs,
  });

  const versionCheck = opts.versionCheck ?? 'fail';
  if (versionCheck !== 'off') {
    const found = extractVersion(await client.config());
    const issue = versionIssue(found);
    if (issue !== undefined) {
      if (versionCheck === 'fail') {
        throw new EngineVersionError(found ?? 'unknown', MIN_ENGINE_VERSION, issue);
      }
      console.warn(`rift: ${issue}; skipping compatibility gate`);
    }
  }

  return new Engine(client, 'remote', { hostHint: new URL(normalized).hostname });
}

async function spawnEngine(opts: SpawnOptions = {}): Promise<Engine> {
  const spawned = await spawnProcess(opts);
  return new Engine(spawned.client, 'spawn', {
    hostHint: new URL(spawned.url).hostname,
    onClose: () => spawned.close(),
  });
}

async function embeddedEngine(_opts?: Record<string, unknown>): Promise<Engine> {
  throw new EngineUnavailable('embedded transport is wired in issue #10');
}

export const rift: {
  connect(url: string, opts?: ConnectOptions): Promise<Engine>;
  spawn(opts?: SpawnOptions): Promise<Engine>;
  embedded(opts?: Record<string, unknown>): Promise<Engine>;
} = {
  connect: connectEngine,
  spawn: spawnEngine,
  embedded: embeddedEngine,
};
