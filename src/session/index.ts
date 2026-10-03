/**
 * session: the Operator's side. A program (`program.run(ops)`), the session
 * it starts, handles to entities, lists and maps, and member handles. It owns
 * handle identity, stable `get()` results and notification batching, and
 * drives the log and the engine.
 *
 * So far: entities, values, lists and maps, whether the Builder placed them
 * or the Operator adds to them, trait-typed inputs, and reading through a
 * trait with `as` and `has`. `explain` still throws.
 *
 * @module
 */

export * from "./handles";
export { has } from "./live";
export * from "./program";
export { CheckedProgram } from "./runtime";
export * from "./session";
