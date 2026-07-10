/**
 * @deprecated Import errors from the package root (`@rift-vs/rift`) or `../errors.js` instead.
 * The error hierarchy is SDK-wide, not remote-specific; it moved to `src/errors.ts`. This module
 * re-exports it for one release so existing `./remote/errors.js` importers keep working.
 */

export {
  RiftError,
  InvalidDefinition,
  ImposterNotFound,
  EngineError,
  EngineUnavailable,
  CommunicationError,
  WireValidationError,
  VerificationError,
  UnsupportedPredicateError,
  EngineVersionError,
  NativeLibraryError,
  InterceptUnavailable,
} from '../errors.js';
