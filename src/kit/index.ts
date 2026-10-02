/**
 * kit: what a Developer defines. Value types (`t`), functions (`fn`),
 * traits, impls, entities, the expression builders (`e`), and the Builder's
 * side of a program (`NodeOf`, `ProgramTree`). It also does all the
 * type-level inference: what a member holds, whether it is writable, which
 * entities a trait-typed member may hold. The session reads those helpers to
 * type its handles.
 *
 * Definitions are plain data that the checker reads. A few `e` helpers
 * (`e.up`, `e.entity`, lambdas, fallbacks) still throw until their slice.
 *
 * The types and their docs are in entity.ts, expr.ts, fn.ts, types.ts,
 * infer.ts, node.ts and kit.ts. The few functions that build definitions are
 * in define.ts (`trait`, `impl`, `entity`, `fn`), t.ts and e.ts.
 *
 * @module
 */

export * from "./define";
export * from "./e";
export * from "./entity";
export * from "./expr";
export * from "./fn";
export * from "./infer";
export * from "./kit";
export * from "./node";
export * from "./t";
export * from "./types";
