/**
 * session: the Operator's side. A program (`program.run(ops)`), the session
 * it starts, handles to entities, lists and maps, and member handles. It owns
 * handle identity, stable `get()` results and notification batching, and
 * drives the log and the engine.
 *
 * So far it runs the walking skeleton: entities, values and lists. `has`,
 * `as`, maps and `explain` still throw.
 *
 * @module
 */

export * from "./handles";
export * from "./program";
export { createProgram } from "./runtime";
export * from "./session";
