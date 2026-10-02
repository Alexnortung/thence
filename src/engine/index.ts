/**
 * engine: computes values from the plan and the log. A cell exists only for
 * what has been read. A change makes the input dirty and what depends on it
 * pending; reading a pending value recomputes it only if a value it reads
 * changed. `settle` brings the watched values up to date. Aggregates fold a
 * collection one element at a time.
 *
 * So far what the walking skeleton needs: inputs, values computed from the
 * entity's own members, and folds over a list. No cycles, eviction or
 * `explain` yet.
 *
 * @module
 */

export { CellEngine } from "./engine";
export { same } from "./same";
export type * from "./types";
