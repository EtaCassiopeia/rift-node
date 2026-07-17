/**
 * Gate for #70 — the standalone (non-test-runner) process shapes, exercised in REAL child Node
 * processes so nothing but the SDK holds the event loop (a jest in-process test can never catch
 * this class: the runner itself keeps the loop alive).
 *
 *   1. A bare script awaiting engine calls must complete them and exit 0 — before #70 the loop
 *      drained mid-`create()` and Node exited 13 with the await unsettled.
 *   2. An open-but-idle engine must NOT block exit (the pre-existing ergonomic, preserved).
 *   3. `rift.embedded({ keepAlive: true })` must keep the process alive past the end of main —
 *      the Mountebank-style standalone mock-server shape.
 *
 * Self-skips unless RIFT_FFI_LIB + koffi are present (same convention as the other embedded
 * integration suites); runs against built dist in the embedded conformance lane.
 */
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import { join } from 'path';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';

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

const distUrl = pathToFileURL(join(process.cwd(), 'dist', 'index.js')).href;

interface ChildResult {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Runs `script` as an ESM child process (temp .mjs — `--input-type=module -e` breaks dynamic
 * import resolution with ERR_INPUT_TYPE_NOT_ALLOWED); resolves on exit or after `timeoutMs`
 * (SIGKILL). */
function runChild(script: string, timeoutMs: number): Promise<ChildResult> {
  const dir = mkdtempSync(join(tmpdir(), 'rift-standalone-'));
  const file = join(dir, 'script.mjs');
  writeFileSync(file, script);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file], {
      cwd: process.cwd(),
      env: { ...process.env, CORE_DIST_URL: distUrl },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      rmSync(dir, { recursive: true, force: true });
      resolve({ code, signal, stdout, stderr, timedOut });
    });
  });
}

const CREATE_AND_CLOSE = `
const { rift, imposter, onGet, okJson } = await import(process.env.CORE_DIST_URL);
const engine = await rift.embedded();
const h = await engine.create(imposter('standalone').stub(onGet('/ping').willReturn(okJson({ ok: true }))));
console.log('CREATED', h.port > 0);
const res = await fetch(h.url + '/ping');
console.log('SERVED', res.status);
await engine.close();
console.log('CLOSED');
`;

const NO_CLOSE = `
const { rift, imposter, onGet, okJson } = await import(process.env.CORE_DIST_URL);
const engine = await rift.embedded();
await engine.create(imposter('idle').stub(onGet('/x').willReturn(okJson({}))));
console.log('DONE-NO-CLOSE');
`;

const KEEP_ALIVE = `
const { rift, imposter, onGet, okJson } = await import(process.env.CORE_DIST_URL);
const engine = await rift.embedded({ keepAlive: true });
await engine.create(imposter('server').stub(onGet('/up').willReturn(okJson({ up: true }))));
console.log('SERVING');
`;

describeOrSkip('#70 — standalone process lifecycles (real cdylib, child processes)', () => {
  it('a bare script completes awaited calls and exits 0 (no unsettled top-level await)', async () => {
    const r = await runChild(CREATE_AND_CLOSE, 15_000);
    expect(r.timedOut).toBe(false);
    expect(r.stderr).not.toMatch(/unsettled top-level await/);
    expect(r.stdout).toContain('CREATED true');
    expect(r.stdout).toContain('SERVED 200');
    expect(r.stdout).toContain('CLOSED');
    expect(r.code).toBe(0);
  }, 20_000);

  it('an open-but-idle engine does not block process exit (no close() needed)', async () => {
    const r = await runChild(NO_CLOSE, 15_000);
    expect(r.timedOut).toBe(false);
    expect(r.stdout).toContain('DONE-NO-CLOSE');
    expect(r.code).toBe(0);
  }, 20_000);

  it('keepAlive: true keeps the process serving past the end of main (killed by the test)', async () => {
    const r = await runChild(KEEP_ALIVE, 6_000);
    expect(r.stdout).toContain('SERVING');
    // The child must NOT have exited on its own — the test's SIGKILL is what ends it.
    expect(r.timedOut).toBe(true);
    expect(r.signal).toBe('SIGKILL');
  }, 20_000);
});
