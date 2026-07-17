/**
 * Path-param typing (docs/design/sdk-api.md §5.1): a path with `:name` segments makes the opener
 * return a param-typed `StubBuilder<{ id: string }>` (captured for editor hints, compile-time only)
 * that ALSO composes into every consuming position — `imposter().stub()`, `scenario().when()`, the
 * `ImposterHandle` stub-surgery methods, and `verify()`. This whole file is the compile gate for
 * #47: it is type-checked by `npm run typecheck:examples`, so a regression to the bare
 * `StubBuilder` bound (into which `{ id: string }` is not assignable) turns these usages back into
 * compile errors. The live engine call self-skips when the embedded transport's optional `koffi`
 * dependency isn't installed (same convention every example here uses).
 */
import { createRequire } from 'module';
import { rift, imposter, scenario, onGet, onPut, okJson, status, times } from '../src/index.js';

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

  // docs:embed sdk-api-path-params
  // A `:name` segment makes the opener return a param-typed builder — and it composes everywhere.
  await using engine = await rift.embedded();

  const users = await engine.create(
    imposter('users').record()
      // ...into imposter().stub()
      .stub(onGet('/api/users/:id').willReturn(okJson({ id: 1, name: 'Alice' })))
      // ...into scenario().when()
      .scenario(
        scenario('activation')
          .when('start', onPut('/api/users/:id')).respond(status(202)).goTo('active')));

  // ...into the ImposterHandle stub-surgery methods
  await users.addStub(onGet('/api/users/:id/posts').willReturn(okJson([])));
  await users.replaceStubs(onGet('/api/users/:id').willReturn(okJson({ id: 2, name: 'Bob' })));
  await users.updateStub({ id: 'u' }, onGet('/api/users/:id').willReturn(okJson({ id: 3 })));

  await fetch(`${users.url}/api/users/1`);

  // ...into verify() (a param-typed builder is a valid RequestMatch)
  await users.verify(onGet('/api/users/:id'), times(1));
  // docs:embed-end sdk-api-path-params
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
