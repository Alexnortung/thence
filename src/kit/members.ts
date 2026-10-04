import type { AnyEntity, EntityDef, EntityMembers } from "./entity";
import type { Ex, ExprArg } from "./expr";
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
		derived: Object.fromEntries(
			Object.entries(def.derived ?? {}).map(([name, x]) => [name, jsonOf(x)]),
		),
	};
}

/** An `e.*` expression as what it is at run time: the Builder's JSON. */
export function jsonOf(expr: Ex<any>): ExprArg {
	return expr as unknown as ExprArg;
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
