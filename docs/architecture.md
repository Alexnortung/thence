# Architecture

thence is split into eight modules. Each one is a folder in `src/`, and its `index.ts` is its interface: other modules import from that file only, never from a file inside another module's folder. A PR that changes an interface updates this page.

Inside a module, the types and their docs are kept apart from the code, so you can learn what a module does from its types alone. `index.ts` holds the module's description and re-exports; `types.ts` holds its interfaces (the kit, which is mostly types, spreads them over several files); and the code is in files named for what they do, such as `log/log.ts`, `log/order.ts` or `engine/engine.ts`.

`src/index.ts` is the public entry point and wires the modules together: `kit()` there returns the kit module's definitions plus `program()` and `check()`, which need the checker and the session.

```
Developer code ─► kit + std ─► checker ─► plan
                                            │
                    ┌───────────────────────┴─────────┐
                    ▼                                 ▼
Operator code ─► session ─► engine ──── reads ────► log
                    │                                 ▲
                    └──────────── applies ops ────────┘

every module may use values; nothing below session imports session
```

| Module | Interface | What it hides | In `src/` |
| --- | --- | --- | --- |
| **values** | `Decimal`, `ExactSum` and `fsum`, `math`, `Result` and `ThenceError`, `Json`, `Path` | bigint scaling and half-even rounding, the exact sum's partials, fdlibm ports | yes; codecs, dates and `pow`, `sin`, `cos`, `tan` still to come |
| **kit** | `t`, `fn`, `trait`, `entity`, `impl`, `e`, and the types `NodeOf`, `ProgramTree`, `EntityOf` | the definition registry, the signature hash, all type-level inference | types, and real values as plain data; `buildTree` runs the step-by-step builder (`p.root.add`, `p.define`) into a plain tree; `kit()` rejects a gap in an impl, a member declared twice, or a function body that calls itself; some `e` helpers (`e.up`, fallbacks) still throw |
| **std** | the function library, made with `fn()` like a Developer's own functions: `add`, `sub`, `mul`, `div`, and the aggregates `sum`, `sumValid`, `count`, `min`, `max`, `any` and `all` so far | inverses, lazy parameters, incremental aggregate descriptors, lambdas | arithmetic with an inverse per parameter, and aggregates |
| **checker** | `check(kit, tree) → { plan, diagnostics }` | scope, types and nullability, enums, expanding Builder functions and components, row templates, writability, cycles, compiling closures | the entities the Builder places in config (one, or a map or list of them), paths into them and into the Operator's collections (`$each`, `{"at"}`, `{"key"}`, `{"id"}`, `$prev`, `$next`, `$index`, `$key`), calls to any kit function or the Builder's own (bodies inlined, and a Builder's body reads only its parameters; an `impl` overload picked from the arguments' types, or by their values when a type is `t.json`); every expression's type and nullability, checked where a type is declared (a config formula, a trait's member), with a number literal becoming that type; cycles through fixed addresses, found statically (`CyclePlan`); aggregates over `$each` or several values; a `ValuePlan.inverse` per expression that can be worked back (a reference, or a call with one such argument and an inverse for it); impls and trait defaults, `{"as"}`, trait-typed inputs, a Builder's scope (own members, then siblings, `$parent`, `$root`, with a warning when an own member hides a sibling); a type's Standard Schema checks as one `check` per input and value, a config constant that fails them as a diagnostic, and every node's `meta` checked against the kit's schema |
| **plan** | `Plan`, `Shape` with the entities placed in it and its traits, `ValuePlan` with static `Ref`s, `Fold`, `Address` (a trait's member is at `[..., "as:priced", "total"]`), `locate(plan, address)` and `parentOf`, and each value type's JSON codec (`decode`, `encode`) | nothing; it is the narrow waist | yes |
| **log** | `new OpLog(plan, replica)`: `apply(op) → changes \| rejection`, `local(intent) → op`, `input(address)`, `isSet`, `members(list)`, `ops()` | validating ops, clocks, later-set-wins, removal-wins, element ids, order keys | values, lists and maps; a map key added again is a fresh element, and two adds of one key make one; a trait-typed input holds one instance, and a switch starts a fresh one |
| **engine** | `new CellEngine(plan, log)`: `read`, `watch`/`unwatch`, `invalidate(changes)`, `settle() → changed`, `resolveWrite`, `writable` | cells made only on demand, clean/pending/dirty states, folds, `$prev` scans, cycle iteration, eviction | cells, pending and dirty states, incremental and recomputed folds, lookups through positions and keys; writes through inverses and the values on the way, to the input a lookup finds now; cycles the checker found, iterated from their seeds in a fixed order (a cycle through a lookup is still the error `cycle`); no eviction or `explain` |
| **session** | the Operator API in the README: `Program`, `Session`, `Handle` and member handles, `has`, `batch`, `apply`, `onApply`, `ops`, `snapshot`, `issues` | handle identity, stable `get()` results, notification batching, paths to and from addresses, path subscriptions that follow positions | entities, values, lists and maps, trait-typed inputs, `as` and `has`; `program.parts()`, and `dependencies` and `dependents` from the plan's references; issues from each value's `check`, run on the value `get()` gives and kept until it changes, collected over an entity and all it holds; `explain` still throws |

## How they talk

- **Building a program.** `kit.program(tree)` calls `checker.check`, which returns a plan and diagnostics. `program.run(ops)` creates a log and an engine over that plan, and a session over both.
- **The Operator sets a value.** The session asks the engine to `resolveWrite` (this follows inverses down to one input), asks the log for a `local` op with a fresh clock, and `apply`s it. The log returns which inputs changed; the engine `invalidate`s (the inputs become dirty, what reads them pending), then `settle`s the watched cells, recomputing a pending cell only if a value it reads changed; the session notifies subscribers whose value really changed, then calls `onApply` with the op.
- **An op arrives from another Operator.** The same path from `apply` on. If the op loses to a later one, the log reports no change and nothing else runs.

## Rules

- The engine never imports the checker, so the runtime does no analysis.
- The log never imports the engine, so it can be tested alone with ops in and changes out.
- Only the session is public on the Operator side.
- Kit definitions are plain data that both `kit()` and the checker read.
- The plan lives in memory only. It holds compiled closures, so it isn't JSON.
- Anything that has to give the same bits in every JavaScript engine uses `values`: `Decimal`, `ExactSum` and `math`, never `Math.exp` and the like.
