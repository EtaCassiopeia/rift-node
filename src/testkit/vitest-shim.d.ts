/**
 * Ambient type shim for `vitest` (issue #12).
 *
 * `vitest` is an optional peer dependency — not installed by default (mirrors `koffi.d.ts` for the
 * embedded transport's optional dependency) — and `vitest.ts` only ever runs inside a consumer's
 * Vitest process, which brings its own real, much richer `vitest` types. This shim exists purely so
 * `tsc --noEmit` type-checks `vitest.ts` without vitest present on disk: it declares the minimal
 * `test`/`TestAPI`/fixture surface actually used (`test.extend` with worker/test-scoped fixtures),
 * nothing more.
 */
declare module 'vitest' {
  export type FixtureUse<T> = (value: T) => Promise<void>;

  export type FixtureFn<T, Context> = (context: Context, use: FixtureUse<T>) => Promise<void> | void;

  export interface FixtureOptions {
    scope?: 'test' | 'worker';
    auto?: boolean;
  }

  export type Fixture<T, Context> = FixtureFn<T, Context> | [FixtureFn<T, Context>, FixtureOptions];

  export type Fixtures<T, Context> = {
    [K in keyof T]: Fixture<T[K], Context>;
  };

  export interface TestAPI<Context extends object = object> {
    (name: string, fn: (context: Context) => Promise<void> | void, timeout?: number): void;
    extend<T extends object>(fixtures: Fixtures<T, Context & T>): TestAPI<Context & T>;
  }

  export const test: TestAPI;
}
