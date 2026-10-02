/**
 * thence: a reactive derived-values engine for programs built at run time.
 *
 * This file is the public entry point. It also wires the modules together:
 * `kit()` returns the kit module's definitions plus `program()` and
 * `check()`, which need the checker and the session.
 *
 * @module
 */

import type { Diagnostic } from "./checker";
import type {
	KitDefinition,
	KitSpec,
	ProgramBuilder,
	ProgramTree,
} from "./kit";
import type { Program } from "./session";
import { shell } from "./shell";

export interface Kit<S extends KitSpec = KitSpec> extends KitDefinition<S> {
	program(tree: ProgramTree<Kit<S>>): Program<Kit<S>>;
	program(build: (p: ProgramBuilder<Kit<S>>) => void): Program<Kit<S>>;
	check(tree: unknown): Diagnostic[];
}

export const kit: <const S extends KitSpec>(spec: S) => Kit<S> = shell("kit");

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
	Register,
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
	Session,
	TraitHandle,
} from "./session";
export { has } from "./session";
export { std } from "./std";
export type { Json, Path, Result, ThenceError } from "./values";
export { Decimal } from "./values";
