/**
 * Typed error hierarchy for the remote admin API client.
 *
 * Every failure mode the client can produce is a distinct `RiftError` subclass so callers can
 * discriminate with `instanceof` instead of parsing messages or status codes by hand.
 */

/** Base class for every error the remote client throws. */
export class RiftError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RiftError';
    // Restore the prototype chain (needed when targeting ES2022 down-compiled via some tools).
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The engine rejected the request as malformed (HTTP 400). */
export class InvalidDefinition extends RiftError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDefinition';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The engine could not be reached at all — `fetch` itself rejected (e.g. connection refused). */
export class EngineUnavailable extends RiftError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EngineUnavailable';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** A response was received but its body could not be parsed as expected. */
export class CommunicationError extends RiftError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CommunicationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The requested imposter does not exist (HTTP 404). */
export class ImposterNotFound extends RiftError {
  constructor(message: string) {
    super(message);
    this.name = 'ImposterNotFound';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Any other non-2xx response from the engine; carries the original HTTP status as `code`. */
export class EngineError extends RiftError {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
