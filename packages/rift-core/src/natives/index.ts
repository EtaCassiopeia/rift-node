/**
 * Native library (cdylib) resolution — barrel export (issue #9).
 *
 * Mirrors `src/spawn/index.ts`'s shape: manifest-driven discovery, cache validation, sha256
 * verification, and a concurrent-resolution lock for `librift_ffi`, the C-ABI cdylib the future
 * `@rift-vs/rift-embedded` transport `dlopen`s in-process.
 */

export {
  resolveCdylib,
  classifierInfo,
  platformClassifier,
  detectMusl,
  DEFAULT_CDYLIB_VERSION,
} from './resolve.js';
export type {
  ResolveCdylibOptions,
  ClassifierInfo,
  PlatformClassifierOptions,
  NativeManifest,
  NativeManifestArtifact,
} from './resolve.js';
