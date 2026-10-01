# Types-only spike

Oct 1, 2026. Can TypeScript keep the promises the README makes, with no engine behind them?

`thence/index.d.ts` declares the public types. `quote.ts`, `forms.ts` and `extras.ts` are the README's examples, copied as written, plus checks that must pass (`Expect<…>`) and mistakes that must fail (`// @ts-expect-error`). Run `pnpm run spike:types` (the repo's TypeScript 7). It also passed on TypeScript 5.9 and 6.0. `pnpm run spike:types:scale` generates the large kit used for timing (`scale/gen.mjs`) and checks it.

## Short answer

Yes, with five changes to the README. Everything the README promises at the type level works, including the two I doubted most: `set` only on writable values, and `session.at(...)` through a trait-typed map. Checking is fast enough on TypeScript 5, and about seven times faster on TypeScript 7.

## What works as the README says

- **Every member's value type is inferred, derived ones included.** `quote.member("total").get()` is `Result<Decimal>`, through `subtotal` and `discountAmount`. A choice field's value is `string | null`.
- **`set` exists only on writable values.** The type level follows the README's rule: exactly one writable argument per call, with an inverse for it. `discountAmount` and `total` get `set`. `subtotal` (a sum), `qty × unitPrice` (two inputs), a calc field (a Builder formula) and a function without an inverse don't. Your own `fn` with an `inverse` works too. So does an expression-bodied `fn` (added Oct 1): its inverse is derived from the `body` with the same rule, so `toFahrenheit` gets `set` with no hand-written inverse, and `square` (`x * x`) doesn't. A body whose type doesn't match `returns`, or a `body` together with an `impl`, is a compile error. Like hand-written inverses, derived ones are exact only for one-parameter functions while the spike's `e.call` takes positional arguments.
- **`session.at(path)` is typed through the kit.** `["sections", "hardware", "lines", "items", "rows"]` gives a list of `EItem`. A path that stops at `lines.shipping` gives the union of every entity that implements `TPriced`.
- **`NodeOf<typeof quotes>` rejects wrong Builder trees**, such as a charge without its formula, an unknown `type`, or a quote placed where only `TPriced` fits. A misspelled config field gets "Did you mean 'formula'?".
- **Forward references through a function work.** The form builder's `content = () => t.map(t.oneOf(TField, EGroup, …))` refers to entities defined later. It resolves without a circularity error on 5.9, 6.0 and 7.0.
- **Kit mistakes are compile errors**: an impl missing a member ("Did you mean 'total'?"), and an input with neither `.initial()` nor `.nullable()`.
- **`has(entity, TConditional)`** narrows the union to the entities that implement the trait. The exhaustive `switch` with `assertNever` works.
- **Trait-typed inputs and derived entities.** `order.entity("customer").type` is `"personField" | "importedPerson"`, and `order.entity("vat")` is a handle to `EVat`.
- **The table user story is a program** (`budget` in `forms.ts`). The columns are the fields of the row `template`, and the starting rows go in `initial` with an id, such as `rent`. `{ id: "rent" }` works as a path segment, and the Operator adds rows that take their columns from the template. An initial row that names a `type` is a compile error. TypeScript can't check the rest of the overlay rule, such as a row adding a field the template lacks, so that is the checker's job. Whether the totals skip empty cells and hidden rows needs the engine.

## What the README needed to change

All five are now settled in the README (Oct 1).

1. **`meta` has no type.** `entity.meta.label` in step 4 can't compile, because nothing tells TypeScript what `meta` holds. The spike adds `kit({ meta: t.meta<{ label?: string }>() })`. Something like it has to exist.
2. **`session.at()` can return `undefined`.** The README says so, and then calls `rows.add()` on the result, which strict TypeScript rejects. Either the example adds a check (or `!`), or `at` throws for a path that isn't there and a separate `find` returns `undefined`.
3. **`Handle<typeof EItem>` can't type trait-typed members on its own.** To know which entities `section.map("lines")` may hold, the handle needs the kit. The spike supports two spellings: `Handle<typeof ESection, typeof quotes>`, and registering the kit once with `declare module "thence" { interface Register { kit: typeof quotes } }` so the README's one-argument spelling works. Registration only allows one kit per app, so I'd keep both.
4. **The type of mixed decimal arithmetic is undefined.** `discountAmount = subtotal × discountPercent / 100` multiplies `Money` by `Percent`. The README says converting between custom types is always explicit, and that a derived decimal is rounded to "its declared scale", but a derived value declares nothing. The spike makes arithmetic take the type of its first decimal argument, so `discountAmount` is `Money`. That rule, or another, belongs in the README. Today `Money` and `Percent` are the same type in TypeScript, so mixing them isn't caught at compile time either.
5. **Inverses on your own functions with several parameters can't be checked at compile time** while arguments are positional. `params` is an object, and TypeScript doesn't know an object's key order, so it can't tell which argument `inverse: { b: … }` belongs to. The fix is small: `e.call(f, { a: x, b: y })` with named arguments, which the expression format already allows. One-parameter functions work today.

## Smaller notes

- **Helpers typed as `Expr` lose types.** `whenVisible(total: Expr)` is fine inside an impl, because the trait gives the member's type. A derived value built through such a helper is `unknown`. Generic helpers, `<X extends Expr>(total: X)`, keep it.
- **Trait defaults that name their own trait** (`e.up("conditional", …)`) can't be typed, since the trait isn't defined yet. The kit's own check catches mistakes there when `kit()` runs.
- **Component names aren't checked by TypeScript.** `{ use: "adress" }` compiles and becomes a diagnostic when the program is built. That matches how Builder data arrives at run time anyway.
- **Every program error is reported twice**, once per overload of `program()` (object and callback). A separate name for the callback form would halve the noise.
- **Long type names in errors.** A wrong member name shows the whole entity type. The real implementation can name types (`EntityHandle<"quote">`) to shorten them.

## Speed

A generated kit with 60 entities, 15 traits, 8 inputs, 6 chained derived values and 2 impls per entity, plus a Builder program written as a 341-node TypeScript literal:

| | TypeScript 5.9 | TypeScript 6.0 | TypeScript 7.0 |
| --- | --- | --- | --- |
| kit only | 1.2 s | | |
| kit and 341-node program | 2.4 s | 2.5 s | 0.36 s |
| kit and 1,365-node program | 4.6 s | | 0.73 s |

Real apps rarely write programs as TypeScript literals, since programs come from the Builder's stored data at run time. The kit's own cost is what every app pays.

## Not covered

The spike doesn't test editor responsiveness, the README's JSX (it uses plain functions instead), validation types, `$data`, lambdas beyond their signatures, or Builder functions. None of these looks risky at the type level.
