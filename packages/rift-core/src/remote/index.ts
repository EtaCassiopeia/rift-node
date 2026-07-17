/**
 * Remote admin API client — barrel export.
 */

export { connect, normalizeUrl, RemoteClient } from './client.js';
export type { RemoteClientOptions, FlowScopedOptions } from './client.js';
export {
  RiftError,
  InvalidDefinition,
  EngineUnavailable,
  CommunicationError,
  ImposterNotFound,
  EngineError,
} from './errors.js';
