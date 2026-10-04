/**
 * checker: turns a kit and a Builder's tree into a plan and diagnostics. It
 * resolves scope and types, expands Builder functions and components, lays
 * rows over templates, works out writability and cycles, and compiles
 * closures. The runtime does no analysis.
 *
 * So far: value, list, map and entity inputs; the entities the Builder places
 * in config; derived values and `t.expr` config; paths through what the
 * entity holds, with positions, keys, ids, `$prev` and `$next`; calls to kit
 * functions, and aggregates over `$each`. Traits and scopes come next.
 *
 * @module
 */

export { invoke } from "./call";
export { check } from "./check";
export type * from "./types";
