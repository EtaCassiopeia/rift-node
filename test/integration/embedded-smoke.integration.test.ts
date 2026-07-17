/**
 * Real-cdylib integration test for the embedded transport (issue #8).
 *
 * Self-skips unless BOTH `RIFT_FFI_LIB` (a path to a real `librift_ffi` C-ABI v2 build) is set AND
 * `koffi` is actually resolvable (it's an `optionalDependency` — absent by default, including in
 * this worktree). Neither is expected to hold in this environment/CI: this file exists so the real
 * path is exercised wherever both prerequisites ARE available (a dev machine with koffi installed
 * + `RIFT_FFI_LIB` pointed at a built cdylib), without ever failing a normal `npm test` run.
 */

import { createRequire } from 'module';
import { NativeEngine } from '../../src/embedded/native.js';

function koffiIsInstalled(): boolean {
  try {
    createRequire(import.meta.url).resolve('koffi');
    return true;
  } catch {
    return false;
  }
}

const libPath = process.env.RIFT_FFI_LIB;
const runnable = Boolean(libPath) && koffiIsInstalled();
const conditionalDescribe = runnable ? describe : describe.skip;

conditionalDescribe('embedded transport integration (real cdylib)', () => {
  it('load -> createImposter -> fetch the imposter -> recorded shows the request -> close', async () => {
    const engine = await NativeEngine.load(libPath as string);
    try {
      expect(engine.buildInfo.length).toBeGreaterThan(0);

      const port = await engine.createImposter(
        // Omit `port` to auto-assign an ephemeral port (as the DSL does). The FFI treats an explicit
        // `port: 0` as a literal port, not "auto-assign" — only an absent port auto-assigns (#63).
        JSON.stringify({
          protocol: 'http',
          stubs: [
            {
              predicates: [{ equals: { method: 'GET', path: '/embedded-smoke' } }],
              responses: [{ is: { statusCode: 200, body: 'ok' } }],
            },
          ],
          recordRequests: true,
        })
      );
      expect(port).toBeGreaterThan(0);

      const response = await fetch(`http://127.0.0.1:${port}/embedded-smoke`);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('ok');

      const recordedJson = await engine.recorded(port);
      const recorded = JSON.parse(recordedJson) as unknown[];
      expect(recorded.length).toBeGreaterThan(0);
    } finally {
      await engine.close();
    }
  });

  it('concurrent invalid + valid calls each carry their own last-error diagnostic', async () => {
    const engine = await NativeEngine.load(libPath as string);
    try {
      const N = 10;
      const invalidPorts = Array.from({ length: N }, (_, i) => 60000 + i);
      const invalid = invalidPorts.map((port) => engine.deleteImposter(port));
      const valid = Array.from({ length: N }, () => engine.deleteAll());

      const invalidResults = await Promise.allSettled(invalid);
      const validResults = await Promise.allSettled(valid);

      const messages = invalidResults.map((result, i) => {
        expect(result.status).toBe('rejected');
        const message = result.status === 'rejected' ? String(result.reason) : '';
        // Each concurrent failure must carry ITS OWN diagnostic — the port it was actually asked
        // to delete, not a neighboring call's (the failure mode this test guards against: a
        // last-error read racing across concurrent worker calls and returning the wrong slot).
        expect(message).toMatch(new RegExp(String(invalidPorts[i])));
        return message;
      });
      expect(new Set(messages).size).toBe(N);

      for (const result of validResults) {
        expect(result.status).toBe('fulfilled');
      }
    } finally {
      await engine.close();
    }
  });
});
