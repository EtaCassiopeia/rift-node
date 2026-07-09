/**
 * Fluent response builders that produce a wire {@link StubResponse}.
 *
 * `.build()` only emits `is` / `headers` / `_behaviors` / `_rift` when they actually carry
 * content — the engine (and the gate's `toEqual`) treats a stray empty object as a different
 * value from an absent key, so we never inject one.
 */

import type {
  Behaviors,
  IsResponse,
  JsonValue,
  ProxyResponse,
  StubResponse,
} from '../model/index.js';

const JSON_CONTENT_TYPE = 'application/json';
const TEXT_CONTENT_TYPE = 'text/plain';

export class ResponseBuilder {
  private statusCodeValue: number | undefined;
  private headerMap: Record<string, string> | undefined;
  private bodyValue: JsonValue | undefined;
  private hasBody = false;
  private behaviors: Behaviors = {};
  private riftFaultType: string | undefined;
  private proxyConfig: ProxyResponse | undefined;
  private injectFn: string | undefined;

  /** Builds a response wrapping a `proxy` block instead of `is`. */
  static proxy(config: ProxyResponse): ResponseBuilder {
    const builder = new ResponseBuilder();
    builder.proxyConfig = config;
    return builder;
  }

  /** Builds a response wrapping an `inject` script instead of `is`. */
  static injected(fn: string): ResponseBuilder {
    const builder = new ResponseBuilder();
    builder.injectFn = fn;
    return builder;
  }

  /** Sets (or overrides) `is.statusCode`. */
  status(code: number): this {
    this.statusCodeValue = code;
    return this;
  }

  /** Merges a single header into `is.headers`, preserving any already set (e.g. Content-Type). */
  header(name: string, value: string): this {
    this.headerMap = { ...this.headerMap, [name]: value };
    return this;
  }

  /** Merges multiple headers into `is.headers`. */
  headers(values: Record<string, string>): this {
    this.headerMap = { ...this.headerMap, ...values };
    return this;
  }

  /** Sets `is.body`. */
  body(value: JsonValue): this {
    this.bodyValue = value;
    this.hasBody = true;
    return this;
  }

  /** Sets `_behaviors.wait` (milliseconds). */
  latency(ms: number): this {
    this.behaviors = { ...this.behaviors, wait: ms };
    return this;
  }

  /** Sets `_behaviors.repeat`. */
  repeat(n: number): this {
    this.behaviors = { ...this.behaviors, repeat: n };
    return this;
  }

  /** Sets `_rift.fault.tcp` — a Rift chaos extension, alongside any `is` already configured. */
  fault(type: string): this {
    this.riftFaultType = type;
    return this;
  }

  build(): StubResponse {
    if (this.proxyConfig !== undefined) {
      return { proxy: this.proxyConfig };
    }
    if (this.injectFn !== undefined) {
      return { inject: this.injectFn };
    }

    const out: StubResponse = {};
    const is: IsResponse = {};
    if (this.statusCodeValue !== undefined) is.statusCode = this.statusCodeValue;
    if (this.headerMap !== undefined && Object.keys(this.headerMap).length > 0) {
      is.headers = this.headerMap;
    }
    if (this.hasBody) is.body = this.bodyValue;
    if (Object.keys(is).length > 0) out.is = is;

    if (Object.keys(this.behaviors).length > 0) out._behaviors = this.behaviors;
    if (this.riftFaultType !== undefined) out._rift = { fault: { tcp: this.riftFaultType } };

    return out;
  }
}

/** 200 OK, optionally with a body. */
export function ok(body?: JsonValue): ResponseBuilder {
  const builder = new ResponseBuilder().status(200);
  if (body !== undefined) builder.body(body);
  return builder;
}

/** 200 OK with `Content-Type: application/json` and the given (required) body. */
export function okJson(body: JsonValue): ResponseBuilder {
  return new ResponseBuilder().status(200).header('Content-Type', JSON_CONTENT_TYPE).body(body);
}

/** 201 Created, optionally with a body. */
export function created(body?: JsonValue): ResponseBuilder {
  const builder = new ResponseBuilder().status(201);
  if (body !== undefined) builder.body(body);
  return builder;
}

/** Arbitrary status code, optionally with a body. */
export function status(code: number, body?: JsonValue): ResponseBuilder {
  const builder = new ResponseBuilder().status(code);
  if (body !== undefined) builder.body(body);
  return builder;
}

/** Arbitrary status code with `Content-Type: application/json` and the given body. */
export function json(code: number, body: JsonValue): ResponseBuilder {
  return new ResponseBuilder().status(code).header('Content-Type', JSON_CONTENT_TYPE).body(body);
}

/** Arbitrary status code with `Content-Type: text/plain` and the given body. */
export function text(code: number, body: JsonValue): ResponseBuilder {
  return new ResponseBuilder().status(code).header('Content-Type', TEXT_CONTENT_TYPE).body(body);
}

/** 404 Not Found, optionally with a body. */
export function notFound(body?: JsonValue): ResponseBuilder {
  const builder = new ResponseBuilder().status(404);
  if (body !== undefined) builder.body(body);
  return builder;
}

/** 204 No Content. */
export function noContent(): ResponseBuilder {
  return new ResponseBuilder().status(204);
}

/** A bare TCP fault response (`_rift.fault.tcp`) with no `is` block. */
export function fault(type: string): ResponseBuilder {
  return new ResponseBuilder().fault(type);
}

/** A `proxy` response forwarding to an upstream URL. */
export function proxyTo(to: string, opts?: { mode?: string }): ResponseBuilder {
  const config: ProxyResponse = opts?.mode !== undefined ? { to, mode: opts.mode } : { to };
  return ResponseBuilder.proxy(config);
}

/** An `inject` response running the given script body. */
export function inject(fn: string): ResponseBuilder {
  return ResponseBuilder.injected(fn);
}
