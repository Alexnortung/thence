# Determinism harness

Oct 1, 2026. Does thence give bit-identical results in every engine, and does it need to own its math?

`src/` holds a first `Decimal`, the exact sum (`ExactSum`, `fsum`), and `exp` and `log` ported from fdlibm. `src/check.ts` checks them against exact references in Node. `run.mjs` runs one bundle in Node and in every browser Playwright can launch, hashes every result's bit pattern, and compares the digests. Run `pnpm run spike:determinism:check` and `pnpm run spike:determinism`. `.github/workflows/determinism.yml` runs both on Linux and macOS with Chromium, Firefox and WebKit.

## Short answer

thence's own functions gave identical bits in both engines tested here, Node 22 and Chromium 141. The engines' own `Math.sin`, `Math.cos` and `Math.pow` did not, although both are V8. So owning the math is needed even between a Node server and a Chrome browser, not only between browser vendors. Firefox and WebKit aren't installed in this environment, so that comparison waits for CI.

## Results

| Function | Node 22 vs Chromium 141 | Notes |
| --- | --- | --- |
| `thence.exp`, `thence.log` | same | 100,000 inputs each, plus edge cases |
| `thence.fsum` | same | one-shot and incremental sums with removals |
| `thence.Decimal` | same | add, mul, div, parse and format at mixed scales |
| `Math.sin` | **differs** | 1,693 of 100,000 results, by 1 ulp |
| `Math.cos` | **differs** | 1,681 of 100,000 |
| `Math.pow` | **differs** | 9,859 of 100,000 |
| `Math.exp`, `log`, `tan`, `atan`, `cbrt`, `expm1`, `log1p`, `sqrt` | same | same here, but the spec doesn't require it |

V8 changed its `sin`, `cos` and `pow` between these versions. Any server on a different Node version than its users' browsers would disagree with them.

## Correctness

- **`fsum`** matched an exact BigInt reference on 5,000 sums, including cancelling pairs and near-ties that naive summation gets wrong. Shuffling the values never changed a bit, and removing values from the accumulator gave exactly the sum of what was left. That is the property the incremental `sum` needs.
- **`exp` and `log`** matched V8's on 200,000 random inputs each, which isn't surprising since V8 uses fdlibm for these two. One fix: fdlibm's `exp(1)` is 1 ulp above `Math.E`, so the port returns `Math.E` there.
- **`Decimal`** rounds half-even (2.5 → 2, 3.5 → 4, −2.5 → −2), never prints "-0.00", reads `0.05` as exactly 0.05, and reproduces the README's discount inverse (50.00 × 100 / 200.00 = 25.0000).

## What this means for the design

1. **`thence/math` needs `sin`, `cos`, `tan` and `pow`, not only `exp` and `log`.** `pow` is the most used and the most divergent. Its fdlibm port is the longest of them (about 300 lines), so it's the next one to port.
2. **`exp(y × log(x))` isn't a substitute for `pow`.** It is deterministic, but it loses accuracy for large results. It's fine as a placeholder, not as `std.pow`.
3. **The decimal design holds.** Plain BigInt with a scale is exact and identical everywhere, and it needs no library.
4. **The README's "determinism" section is right to forbid `Math.*`** in Developer functions. A lint rule in the kit's own tooling could enforce it later.

## Not covered yet

Firefox, WebKit and real Safari (CI only), `sin`, `cos`, `tan` and `pow` ports, cycles iterated from a cold start (that needs the engine), and decimal overflow limits.
