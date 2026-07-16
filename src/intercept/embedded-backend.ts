/**
 * Embedded `InterceptBackend` adapter (issue #11) — a thin JSON-boundary wrapper over the
 * FFI-backed `NativeEngine` intercept calls (issue #8, `rift_start_intercept`/`rift_intercept_*`).
 * Parses/stringifies JSON at this boundary so `InterceptHandle` never touches it directly.
 */

import { RiftError } from '../errors.js';
import type { InterceptBackend } from './types.js';

/** The subset of `NativeEngine`'s facade this backend depends on — small enough that tests inject a
 * fake, and the real `NativeEngine` (and `EmbeddedAdmin`'s `NativeEngineLike`) satisfy it structurally
 * as-is (see `embedded/create.ts`). */
export interface NativeInterceptEngine {
  startIntercept(optionsJson: string): Promise<Record<string, unknown>>;
  interceptAddRules(json: string): Promise<number>;
  interceptClearRules(): Promise<number>;
  interceptListRules(): Promise<string>;
  interceptCaPem(): Promise<string>;
  interceptExportTruststore(format: string, password: string, outPath: string): Promise<number>;
}

export class EmbeddedInterceptBackend implements InterceptBackend {
  constructor(private readonly native: NativeInterceptEngine) {}

  async startIntercept(optionsJson: string): Promise<{ interceptPort: number; interceptUrl: string }> {
    const result = await this.native.startIntercept(optionsJson);
    const interceptPort = result['interceptPort'];
    const interceptUrl = result['interceptUrl'];
    if (typeof interceptPort !== 'number' || typeof interceptUrl !== 'string') {
      throw new RiftError(
        `rift_start_intercept returned an unexpected shape (expected {interceptPort, interceptUrl}): ${JSON.stringify(result)}`
      );
    }
    return { interceptPort, interceptUrl };
  }

  async addRules(rulesJson: string): Promise<void> {
    await this.native.interceptAddRules(rulesJson);
  }

  async listRules(): Promise<string> {
    return this.native.interceptListRules();
  }

  async clearRules(): Promise<void> {
    await this.native.interceptClearRules();
  }

  async caPem(): Promise<string> {
    return this.native.interceptCaPem();
  }

  async exportTruststore(format: string, password: string, outPath: string): Promise<void> {
    await this.native.interceptExportTruststore(format, password, outPath);
  }
}
