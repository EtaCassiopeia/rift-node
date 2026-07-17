/**
 * The hero quick-start: create an imposter with the typed DSL, exercise it, then verify what it
 * received. Compiles unconditionally; the live engine call self-skips when the embedded
 * transport's optional `koffi` dependency isn't installed (same convention every example in this
 * directory uses to stay runnable without a live Rift engine).
 */
import { createRequire } from 'module';
import { rift, imposter, onGet, onPost, okJson, created, status, times } from '../src/index.js';

function embeddedAvailable(): boolean {
  try {
    createRequire(import.meta.url).resolve('koffi');
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  if (!embeddedAvailable()) {
    console.log('koffi not installed — skipping (npm i -D @rift-vs/rift-embedded to run the embedded transport).');
    return;
  }

  // docs:embed hero
  await using engine = await rift.embedded(); // or rift.connect(url) / rift.spawn()

  const users = await engine.create(
    imposter('users')
      .record()
      .stub(onGet('/api/users/1').willReturn(okJson({ id: 1, name: 'Alice' })))
      .stub(onPost('/api/users').willReturn(created().latency(50), status(503)))); // cycling

  await fetch(`${users.url}/api/users/1`);

  await users.verify(onGet('/api/users/1'), times(1)); // throws VerificationError with a diff
  // docs:embed-end hero
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
