import type {
	AnyEntity,
	EntityDef,
	EntityMembers,
	Impl,
	ImplMembers,
} from "./entity";
import type { Expr, ExprArg } from "./expr";
import type { ConfigDef, MemberDef, ResolvedMember } from "./types";

/**
 * An entity's members with every {@link Later} function called, so the
 * checker sees member types only. Config may hold `() => EGroup` to name an
 * entity defined further down; this is where that function runs. It keeps
 * nothing between calls: a `Later` function only returns a definition.
 */
export function membersOf(entity: AnyEntity): EntityMembers {
	const def: EntityDef = entity["~def"];
	return {
		config: resolveAll(def.config),
		inputs: resolveAll(def.inputs),
		derived: jsonAll(def.derived ?? {}),
		impls: Object.fromEntries(
			(def.impls ?? []).map((i) => [i["~trait"].name, implMembers(i)]),
		),
	};
}

/** An `e.*` expression as what it is at run time: the Builder's JSON. */
export function jsonOf(expr: Expr): ExprArg {
	return expr as unknown as ExprArg;
}

function jsonAll(
	exprs: Readonly<Record<string, Expr>>,
): Record<string, ExprArg> {
	return Object.fromEntries(
		Object.entries(exprs).map(([name, x]) => [name, jsonOf(x)]),
	);
}

/**
 * A member type with its function called, if it is one. A value type such as
 * `t.number` is callable too, so a function counts only without a `"~kind"`.
 */
export function resolveMember(member: MemberDef | ConfigDef): ResolvedMember {
	let m: unknown = member;
	while (typeof m === "function" && !("~kind" in m)) m = (m as () => unknown)();
	return m as ResolvedMember;
}

function resolveAll(
	members: Readonly<Record<string, MemberDef | ConfigDef>> | undefined,
): Record<string, ResolvedMember> {
	const out: Record<string, ResolvedMember> = {};
	for (const [name, member] of Object.entries(members ?? {})) {
		out[name] = resolveMember(member);
	}
	return out;
}

function implMembers(i: Impl<any>): ImplMembers {
	const trait = i["~trait"];
	return {
		trait,
		types: resolveAll(trait["~members"]),
		body: jsonAll({ ...trait.defaults, ...(i.body as object) }),
	};
}
