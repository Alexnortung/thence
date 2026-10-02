/**
 * checker: turns a kit and a Builder's tree into a plan and diagnostics. It
 * resolves scope and types, expands Builder functions and components, lays
 * rows over templates, works out writability and cycles, and compiles
 * closures. The runtime does no analysis.
 *
 * So far only what the walking skeleton needs: value and list inputs, derived
 * values and `t.expr` config on the root, references to the entity's own
 * members, `std` calls, and aggregates over `$each`.
 *
 * @module
 */

export { invoke } from "./call";
export { check } from "./check";
export type * from "./types";
