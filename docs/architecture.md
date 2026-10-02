# Architecture

thence is split into eight modules. Each one is a folder in `src/`, and its `index.ts` is its interface: other modules import from that file only, never from a file inside another module's folder. A PR that changes an interface updates this page.

`src/index.ts` is the public entry point and wires the modules together: `kit()` there returns the kit module's definitions plus `program()` and `check()`, which need the checker and the session. A value that has its types but no code yet is a shell (`src/shell.ts`) that throws when used.

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
| **kit** | `t`, `fn`, `trait`, `entity`, `impl`, `e`, and the types `NodeOf`, `ProgramTree`, `EntityOf` | the definition registry, the signature hash, all type-level inference | types, with shells |
| **std** | the function library, as ordinary `fn()` values | inverses, lazy parameters, incremental aggregate descriptors, lambdas | a shell |
| **checker** | `check(kit, tree) → { plan, diagnostics }` | scope, types and nullability, enums, expanding Builder functions and components, row templates, writability, cycles, compiling closures | `Diagnostic` only |
| **plan** | types only: the contract between checker and runtime | nothing; it is the narrow waist | empty |
| **log** | `apply(op) → changes \| rejection`, `local(intent) → op`, `input(address)`, `members(collection)` | validating ops, clocks, later-set-wins, removal-wins, element ids, order keys | `Op` only |
| **engine** | `read`, `watch`/`unwatch`, `invalidate(changes)`, `settle() → changed`, `resolveWrite`, `explain` | cells made only on demand, dirty marking, folds, `$prev` scans, cycle iteration, eviction | empty |
| **session** | the Operator API in the README: `Program`, `Session`, `Handle` and member handles, `has`, `batch`, `apply`, `onApply`, `ops`, `snapshot`, `issues` | handle identity, stable `get()` results, notification batching, paths to and from addresses | types, with shells |

## How they talk

- **Building a program.** `kit.program(tree)` calls `checker.check`, which returns a plan and diagnostics. `program.run(ops)` creates a log and an engine over that plan, and a session over both.
- **The Operator sets a value.** The session asks the engine to `resolveWrite` (this follows inverses down to one input), asks the log for a `local` op with a fresh clock, and `apply`s it. The log returns which inputs changed; the engine `invalidate`s, then `settle`s the watched cells; the session notifies subscribers whose value really changed, then calls `onApply` with the op.
- **An op arrives from another Operator.** The same path from `apply` on. If the op loses to a later one, the log reports no change and nothing else runs.

## Rules

- The engine never imports the checker, so the runtime does no analysis.
- The log never imports the engine, so it can be tested alone with ops in and changes out.
- Only the session is public on the Operator side.
- Kit definitions are plain data that both `kit()` and the checker read.
- The plan lives in memory only. It holds compiled closures, so it isn't JSON.
- Anything that has to give the same bits in every JavaScript engine uses `values`: `Decimal`, `ExactSum` and `math`, never `Math.exp` and the like.
