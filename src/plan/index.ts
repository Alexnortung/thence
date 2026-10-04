/**
 * plan: the contract between the checker and the runtime. The checker builds
 * it; the log and the engine read it and never see a kit or a Builder's tree.
 *
 * One shape per entity definition, plus one per placement that carries
 * Builder formulas. A shape lists the instance's inputs, its computed values
 * and the entities placed in it. Each value keeps its original expression,
 * the references it makes, and a compiled closure that turns the referenced
 * values into its own. Instances an Operator adds, such as rows, are not in
 * the plan: they live in the log as ops.
 *
 * It lives in memory only: closures can't be serialized, and rebuilding it is
 * fast.
 *
 * @module
 */

export { locate, parentOf } from "./locate";
export type * from "./types";
