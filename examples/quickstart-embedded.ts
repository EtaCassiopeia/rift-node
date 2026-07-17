/**
 * `rift.embedded()` — in-process transport, no Docker, OS-assigned ports. Requires the optional
 * `koffi` peer dependency (`npm i -D koffi`); resolves the `librift_ffi` cdylib the same way the
 * spawn transport resolves its binary (see the README's native-resolution table). Self-skips here
 * when koffi isn't installed, same as every other example in this directory.
 */
import { createRequire } from 'module';
import { rift, imposter, onGet, okJson } from '../src/index.js';

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
    console.log('koffi not installed — skipping (npm i -D koffi to run the embedded transport).');
    return;
  }

  // docs:embed quickstart-embedded
  await using engine = await rift.embedded();

  const users = await engine.create(
    imposter('users').stub(onGet('/api/users/1').willReturn(okJson({ id: 1, name: 'Alice' }))));

  await fetch(`${users.url}/api/users/1`);
  // docs:embed-end quickstart-embedded
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
