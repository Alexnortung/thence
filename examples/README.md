# Examples

The README's examples, type-checked against the types in `src/`. `pnpm run typecheck` checks them, so CI fails when the types stop keeping a promise the README makes.

- `quote.ts`: the quick start, a quote configurator.
- `forms.ts`: the form builder, with the budget table and rendering a `t.oneOf` by its traits.
- `extras.ts`: inverses on your own functions, expression-bodied functions, derived entities, trait-typed inputs, `t.all` and `t.oneOf` handles, and the `add` builder.

Each file has checks that must pass (`Expect<…>`) and mistakes that must fail (`// @ts-expect-error`).

## Demos

Each folder here is a demo: a Vite + React app in the pnpm workspace that imports `thence` and `thence/react` from the workspace. `hello/` is the smallest; copy it to start another.

```sh
pnpm build                              # the demos import the built package
pnpm --filter ./examples/hello dev      # run one
pnpm --filter "./examples/*" build      # build them all
pnpm test:demos                         # run each demo's tests in headless Chromium
```

A demo's tests sit next to its code (`src/*.test.tsx`) and run in Vitest's browser mode against thence's source, so they need no build. CI builds every demo and runs their tests.

## Where they differ from the README

Lines marked `DIFFERS` in `quote.ts`:

- `meta` is typed with `t.meta<…>()`. The README now types it with a Standard Schema (`kit({ meta: schema })`); the types haven't caught up.
- `session.at(…)` can return `undefined`, so the example adds `!`.
