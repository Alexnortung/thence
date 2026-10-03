/**
 * engine: computes values from the plan and the log. A cell exists only for
 * what has been read. A change makes the input dirty and what depends on it
 * pending; reading a pending value recomputes it only if a value it reads
 * changed. `settle` brings the watched values up to date. Aggregates fold a
 * collection one element at a time.
 *
 * So far: inputs, values, folds over lists and maps, and lookups that find
 * an element by position, key or id again when its collection changes, and
 * `explain`. No cycles or eviction yet.
 *
 * @module
 */

export { CellEngine } from "./engine";
export { same } from "./same";
export type * from "./types";
