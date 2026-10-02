/**
 * values: the value types every module shares, and the arithmetic that has
 * to give the same bits on every JavaScript engine.
 *
 * Every other module may import values; values imports nothing. It hides
 * bigint scaling and half-even rounding, the exact sum's partials, the fdlibm
 * ports, and the bit tricks they need.
 *
 * @module
 */

export { Decimal } from "./decimal";
export type { Json } from "./json";
export * as math from "./math";
export type { Path, Result, ThenceError } from "./result";
export { ExactSum, fsum } from "./sum";
