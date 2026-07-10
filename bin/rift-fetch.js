#!/usr/bin/env node

/**
 * rift-fetch: on-demand Rift engine binary fetcher (issue #5).
 *
 * Replaces the old postinstall-time download: instead of downloading on every `npm install`,
 * consumers run `npx rift-fetch` (or add it to their own setup step) to force-resolve/download
 * the engine binary ahead of time. Imports the built resolver from dist/, so `npm run build`
 * must have run first (true for a published package; for a local checkout, `npm run build`).
 */

import { resolveBinary } from '../dist/spawn/index.js';

async function main() {
  // Force-resolve even if the environment is otherwise configured to skip downloads: this
  // command's entire purpose is to fetch, so RIFT_OFFLINE/RIFT_SKIP_BINARY_DOWNLOAD (meant to
  // guard *implicit* downloads during `create()`/`spawn()`) don't apply here.
  const env = { ...process.env };
  delete env.RIFT_OFFLINE;
  delete env.RIFT_SKIP_BINARY_DOWNLOAD;

  try {
    const binaryPath = await resolveBinary({ env });
    console.log(binaryPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`rift-fetch: could not resolve a Rift engine binary.\n${message}`);
    console.error(
      '\nYou can install one manually and point RIFT_BINARY_PATH at it, or check your network ' +
        'connection / RIFT_DOWNLOAD_URL / RIFT_MIRROR_URL and try again.'
    );
    process.exitCode = 1;
  }
}

main();
