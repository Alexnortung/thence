/**
 * kit: what a Developer defines. Value types (\`t\`), functions (\`fn\`),
 * traits, impls, entities, the expression builders (\`e\`), and the Builder's
 * side of a program (\`NodeOf\`, \`ProgramTree\`). It also does all the
 * type-level inference: what a member holds, whether it is writable, which
 * entities a trait-typed member may hold. The session reads those helpers to
 * type its handles.
 *
 * Types only so far: every value here is a shell from the types spike.
 *
 * @module
 */

export * from "./entity";
export * from "./expr";
export * from "./fn";
export * from "./infer";
export * from "./kit";
export * from "./node";
export * from "./types";
