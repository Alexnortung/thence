/**
 * log: the Operators' ops. It validates ops against the plan, orders them by
 * clock (later set wins, removal wins), and reports which inputs changed. It
 * never imports the engine, so it is tested with ops in and changes out.
 *
 * So far what the walking skeleton needs: `set`, `clear`, `add`, `move` and
 * `remove` on value and list inputs, Lamport clocks, and order keys.
 *
 * @module
 */

export { OpLog } from "./log";
export { keyBetween } from "./order";
export type * from "./types";
