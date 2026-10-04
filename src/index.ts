/**
 * thence: a reactive derived-values engine for programs built at run time.
 *
 * This file is the public entry point. It also wires the modules together:
 * `kit()` returns the kit module's definitions plus `program()` and
 * `check()`, which need the checker and the session.
 *
 * @module
 */

import { check, type Diagnostic } from "./checker";
import type {
	CheckConfig,
	KitDefinition,
	KitSpec,
	ProgramBuilder,
	ProgramTree,
} from "./kit";
import { buildTree, validateKit } from "./kit";
import { CheckedProgram, type Program } from "./session";

export interface Kit<S extends KitSpec = KitSpec> extends KitDefinition<S> {
	program(tree: ProgramTree<Kit<S>>): Program<Kit<S>>;
	program(build: (p: ProgramBuilder<Kit<S>>) => void): Program<Kit<S>>;
	check(tree: unknown): Diagnostic[];
}

export const kit = <const S extends KitSpec>(
	spec: S & CheckConfig<S>,
): Kit<S> => {
	validateKit(spec);
	return {
		"~spec": spec,
		name: spec.name,
		program(tree: unknown) {
			const { plan, diagnostics, parts } = check(
				spec,
				typeof tree === "function"
					? buildTree(spec, tree as Parameters<typeof buildTree>[1])
					: tree,
			);
			return new CheckedProgram(plan, diagnostics, parts);
		},
		check: (tree: unknown) => [...check(spec, tree).diagnostics],
	};
};

export type { Diagnostic } from "./checker";
export type {
	All,
	AnyEntity,
	AnyKit,
	AnyTrait,
	BuilderExpr,
	ComponentNode,
	Entity,
	EntityDef,
	EntityOf,
	EnumDef,
	EnumType,
	Ex,
	Expr,
	ExprType,
	Fn,
	Impl,
	In,
	Initial,
	KitSpec,
	ListT,
	MapT,
	Meta,
	NodeFor,
	NodeOf,
	OneOf,
	Optional,
	ParamRef,
	Placed,
	PlacementOf,
	ProgramBuilder,
	ProgramTree,
	StandardSchemaV1,
	Trait,
	TraitInitial,
	ValueType,
} from "./kit";
export { e, entity, fn, impl, t, trait } from "./kit";
export type { Op } from "./log";
export type {
	At,
	EntityHandle,
	Handle,
	InputMember,
	Issue,
	ListHandle,
	MapHandle,
	Member,
	Program,
	RunOptions,
	Session,
	TraitHandle,
} from "./session";
export { has } from "./session";
export { std } from "./std";
export type { Json, Path, Result, ThenceError } from "./values";
export { Decimal, FnError } from "./values";
