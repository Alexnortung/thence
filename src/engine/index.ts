/**
 * engine: computes values from the plan and the log. A cell exists only for
 * what has been read. A change makes the input dirty and what depends on it
 * pending; reading a pending value recomputes it only if a value it reads
 * changed. `settle` brings the watched values up to date. Aggregates fold a
 * collection one element at a time, and the lambdas of `map` and `filter`
 * run in a cell per element, so a change to one row runs them for that row.
 * A derived collection's elements have addresses of their own; a filter's
 * element shares its source's cells, so it is found under either address.
 *
 * So far: inputs, values, folds over lists and maps, lookups that find an
 * element by position, key or id again when its collection changes, cycles,
 * and derived collections. No eviction or `explain` yet.
 *
 * @module
 */

export { CellEngine } from "./engine";
export { same } from "./same";
export type * from "./types";
