/**
 * `rift.connect(url)` — attaches to an already-running Rift admin endpoint (e.g. a CI service
 * container). `apiKey` is sent as `Authorization: Bearer <apiKey>` on every admin request, when the
 * server was started with `--api-key`. Self-skips unless `RIFT_ADMIN_URL` points at a live engine.
 */
import { rift, imposter, onGet, okJson } from '../src/index.js';

async function main(): Promise<void> {
  const url = process.env.RIFT_ADMIN_URL;
  if (url === undefined) {
    console.log('RIFT_ADMIN_URL not set — skipping (point it at a running Rift admin endpoint).');
    return;
  }

  // docs:embed quickstart-connect
  await using engine = await rift.connect(url, { apiKey: process.env.RIFT_API_KEY });

  const users = await engine.create(
    imposter('users').stub(onGet('/api/users/1').willReturn(okJson({ id: 1, name: 'Alice' }))));

  await fetch(`${users.url}/api/users/1`);
  // docs:embed-end quickstart-connect
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
