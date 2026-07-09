/**
 * Fluent imposter builder.
 */

import type { Imposter, IsResponse, Stub } from '../model/index.js';
import type { ResponseBuilder } from './response.js';
import type { StubBuilder } from './stub.js';

export class ImposterBuilder {
  private nameValue: string | undefined;
  private portValue: number | undefined;
  private protocolValue: string | undefined;
  private hostValue: string | undefined;
  private readonly stubList: Stub[] = [];
  private recordRequestsValue: boolean | undefined;
  private recordMatchesValue: boolean | undefined;
  private allowCORSValue: boolean | undefined;
  private defaultResponseValue: IsResponse | undefined;

  constructor(name?: string) {
    if (name !== undefined) this.nameValue = name;
  }

  port(value: number): this {
    this.portValue = value;
    return this;
  }

  protocol(value: string): this {
    this.protocolValue = value;
    return this;
  }

  host(value: string): this {
    this.hostValue = value;
    return this;
  }

  /** Enables `recordRequests` (mock-verification mode). */
  record(): this {
    this.recordRequestsValue = true;
    return this;
  }

  /** Enables `recordMatches` (predicate-match diagnostics). */
  recordMatches(): this {
    this.recordMatchesValue = true;
    return this;
  }

  allowCORS(): this {
    this.allowCORSValue = true;
    return this;
  }

  stub(...stubs: StubBuilder[]): this {
    for (const s of stubs) this.stubList.push(s.build());
    return this;
  }

  defaultResponse(response: ResponseBuilder): this {
    const built = response.build();
    if (built.is === undefined) {
      throw new Error(
        'defaultResponse requires an `is` response; proxy/inject/fault responses cannot be a default'
      );
    }
    this.defaultResponseValue = built.is;
    return this;
  }

  build(): Imposter {
    const out: Imposter = {};
    if (this.nameValue !== undefined) out.name = this.nameValue;
    if (this.portValue !== undefined) out.port = this.portValue;
    // Protocol is emitted only when set explicitly — no silent default, so a TCP/HTTPS
    // imposter is never mislabeled `http`.
    if (this.protocolValue !== undefined) out.protocol = this.protocolValue;
    if (this.hostValue !== undefined) out.host = this.hostValue;
    if (this.recordRequestsValue !== undefined) out.recordRequests = this.recordRequestsValue;
    if (this.recordMatchesValue !== undefined) out.recordMatches = this.recordMatchesValue;
    if (this.allowCORSValue !== undefined) out.allowCORS = this.allowCORSValue;
    if (this.defaultResponseValue !== undefined) out.defaultResponse = this.defaultResponseValue;
    if (this.stubList.length > 0) out.stubs = this.stubList;
    return out;
  }
}

export function imposter(name?: string): ImposterBuilder {
  return new ImposterBuilder(name);
}
