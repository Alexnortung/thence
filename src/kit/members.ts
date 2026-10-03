import type {
	AnyEntity,
	EntityDef,
	EntityMembers,
	Impl,
	ImplMembers,
} from "./entity";
import type { ConfigDef, MemberDef, ResolvedMember } from "./types";

const read = new WeakMap<AnyEntity, EntityMembers>();

/**
 * An entity's members with every {@link Later} function called, read once
 * per entity. The checker reads entities only through this.
 */
export function membersOf(entity: AnyEntity): EntityMembers {
	let members = read.get(entity);
	if (!members) {
		const def: EntityDef = entity["~def"];
		members = {
			config: resolveAll(def.config),
			inputs: resolveAll(def.inputs),
			derived: { ...(def.derived ?? {}) },
			impls: Object.fromEntries(
				(def.impls ?? []).map((i) => [i["~trait"].name, implMembers(i)]),
			),
		};
		read.set(entity, members);
	}
	return members;
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
		body: { ...trait.defaults, ...(i.body as object) },
	};
}
