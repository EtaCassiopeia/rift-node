/**
 * Real-cdylib integration test for `rift.embedded()` (issue #10) — the full wiring on top of the
 * issue #8 `NativeEngine` facade the `embedded-smoke` integration suite already exercises directly.
 *
 * Self-skips unless BOTH `RIFT_FFI_LIB` (a real `librift_ffi` C-ABI v2 build) is set AND `koffi` is
 * actually resolvable (an `optionalDependency` — absent by default, including in this worktree), so
 * this never fails a normal `npm test` run; it only runs where both prerequisites are available.
 */

import { createRequire } from 'module';
import { rift, imposter, onGet, okJson } from '../../src/index.js';

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
const describeOrSkip = runnable ? describe : describe.skip;

describeOrSkip('rift.embedded() integration (real cdylib)', () => {
  it('create -> fetch -> verify -> close', async () => {
    await using engine = await rift.embedded({ libPath });
    expect(engine.transport).toBe('embedded');

    const users = await engine.create(
      imposter('users')
        .record()
        .stub(onGet('/api/users/1').willReturn(okJson({ id: 1, name: 'Alice' })))
    );

    const res = await fetch(`${users.url}/api/users/1`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 1, name: 'Alice' });

    await users.verify(onGet('/api/users/1'));

    const info = await engine.buildInfo();
    expect(info.version.length).toBeGreaterThan(0);
  }, 30_000);

  it('an inject stub works with no allowInjection flag anywhere (FFI bypasses the admin plane gate)', async () => {
    await using engine = await rift.embedded({ libPath });
    const injected = await engine.create(
      imposter('injected').stub({
        responses: [{ inject: 'function(config) { return { statusCode: 202 }; }' }],
      })
    );
    const res = await fetch(injected.url);
    expect(res.status).toBe(202);
  }, 30_000);

  it('two engines run simultaneously without interfering', async () => {
    await using engineA = await rift.embedded({ libPath });
    await using engineB = await rift.embedded({ libPath });

    const a = await engineA.create(imposter('a').stub(onGet('/x').willReturn(okJson({ from: 'a' }))));
    const b = await engineB.create(imposter('b').stub(onGet('/x').willReturn(okJson({ from: 'b' }))));

    const [resA, resB] = await Promise.all([fetch(`${a.url}/x`), fetch(`${b.url}/x`)]);
    expect(await resA.json()).toEqual({ from: 'a' });
    expect(await resB.json()).toEqual({ from: 'b' });
  }, 30_000);
});
