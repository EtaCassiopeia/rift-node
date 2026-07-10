/**
 * Remote admin API client — barrel export.
 */

export { connect, rift } from './client.js';
export type { RemoteClient, FlowScopedOptions } from './client.js';
export {
  RiftError,
  InvalidDefinition,
  EngineUnavailable,
  CommunicationError,
  ImposterNotFound,
  EngineError,
} from './errors.js';
