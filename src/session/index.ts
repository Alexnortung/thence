/**
 * session: the Operator's side. A program (`program.run(ops)`), the session
 * it starts, handles to entities, lists and maps, and member handles. It owns
 * handle identity, stable `get()` results and notification batching, and
 * drives the log and the engine.
 *
 * Types only so far: `has` is a shell from the types spike.
 *
 * @module
 */

export * from "./handles";
export * from "./program";
export * from "./session";
