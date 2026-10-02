# Examples

The README's examples, type-checked against the types in `src/`. `pnpm run typecheck` checks them, so CI fails when the types stop keeping a promise the README makes.

- `quote.ts`: the quick start, a quote configurator.
- `forms.ts`: the form builder, with the budget table and rendering a `t.oneOf` by its traits.
- `extras.ts`: inverses on your own functions, expression-bodied functions, derived entities, trait-typed inputs, `t.all` and `t.oneOf` handles, and the `add` builder.

Each file has checks that must pass (`Expect<…>`) and mistakes that must fail (`// @ts-expect-error`).

Nothing here runs yet: `kit()`, `t`, `e` and the rest are shells that throw until the engine exists.

## Where they differ from the README

Lines marked `DIFFERS` in `quote.ts`:

- `meta` is typed with `t.meta<…>()`. The README now types it with a Standard Schema (`kit({ meta: schema })`); the types haven't caught up.
- `session.at(…)` can return `undefined`, so the example adds `!`.
