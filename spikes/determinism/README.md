# Determinism harness

Oct 1, 2026. Does thence give bit-identical results in every engine, and does it need to own its math?

`src/` holds a first `Decimal`, the exact sum (`ExactSum`, `fsum`), and `exp` and `log` ported from fdlibm. `src/check.ts` checks them against exact references in Node. `run.mjs` runs one bundle in Node and in every browser Playwright can launch, hashes every result's bit pattern, and compares the digests. Run `pnpm run spike:determinism:check` and `pnpm run spike:determinism`. `.github/workflows/determinism.yml` runs both on Linux and macOS with Chromium, Firefox and WebKit.

## Short answer

Yes, thence needs to own its math, and the harness shows it can. On every engine tested, thence's own functions gave identical bits, and the same bits on Linux and on macOS. The engines' own `Math` functions disagreed on 10 of the 11 tested, often between two V8s. Only `Math.sqrt` agreed everywhere. IEEE 754 requires `sqrt` to be correctly rounded, so that is expected.

## Results

These are from CI on Oct 1, 2026, Linux x64 and macOS arm64, each with Node, Chromium 141, Firefox 142 and WebKit 26. Node was 22.23 on Linux and 24.20 on macOS.

| Function | Result | Which engines disagree |
| --- | --- | --- |
| `thence.exp`, `thence.log` | same everywhere | none |
| `thence.fsum` | same everywhere | none |
| `thence.Decimal` | same everywhere | none |
| `Math.sin`, `Math.cos` | **differ** | all four disagree, on both systems |
| `Math.pow` | **differs** | on Linux, Node 22 against all three browsers |
| `Math.exp`, `Math.log`, `Math.expm1` | **differ** | WebKit on both systems; on macOS also Node 24 against Chromium |
| `Math.tan`, `Math.atan` | **differ** | WebKit on both systems; on macOS also Node 24 |
| `Math.cbrt` | **differs** | WebKit |
| `Math.log1p` | **differs** | on macOS, Node 24 and WebKit |
| `Math.sqrt` | same everywhere | none |

The earlier local run, Node 22 against Chromium 141 on Linux, had already shown 1-ulp differences in `sin` (1.7% of results), `cos` (1.7%) and `pow` (9.9%). Those came from V8 changing these functions between versions.

## Correctness

- **`fsum`** matched an exact BigInt reference on 5,000 sums, including cancelling pairs and near-ties that naive summation gets wrong. Shuffling the values never changed a bit, and removing values from the accumulator gave exactly the sum of what was left. That is the property the incremental `sum` needs.
- **`exp` and `log`** matched V8's on 200,000 random inputs each, which isn't surprising since V8 uses fdlibm for these two. One fix: fdlibm's `exp(1)` is 1 ulp above `Math.E`, so the port returns `Math.E` there.
- **`Decimal`** rounds half-even (2.5 → 2, 3.5 → 4, −2.5 → −2), never prints "-0.00", reads `0.05` as exactly 0.05, and reproduces the README's discount inverse (50.00 × 100 / 200.00 = 25.0000).

## What this means for the design

1. **`thence/math` needs its own version of every function it offers except `sqrt`.** Engines disagree on all the others, even a Node server and a Chrome browser. `pow` is the most used. Its fdlibm port is the longest (about 300 lines), so it is the next one to port, followed by `sin`, `cos` and `tan`.
2. **`exp(y × log(x))` isn't a substitute for `pow`.** It is deterministic, but it loses accuracy for large results. It's fine as a placeholder, not as `std.pow`.
3. **The decimal design holds.** Plain BigInt with a scale is exact and identical everywhere, and it needs no library.
4. **The README's "determinism" section is right to forbid `Math.*`** in Developer functions. A lint rule in the kit's own tooling could enforce it later.

## Not covered yet

Real Safari on iOS, ports of `pow`, `sin`, `cos` and `tan`, cycles iterated from a cold start (that needs the engine), and decimal overflow limits.
