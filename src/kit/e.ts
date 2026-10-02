import type { Arg, BuilderExpr, ExprArg, ExprBuilders, TraitArg } from "./expr";

/** The expression builders; see {@link ExprBuilders}. */
export const e: ExprBuilders = {
	self: (member, fallback) =>
		fallback === undefined
			? ex(["ref", member])
			: later("e.self with a fallback"),
	as: (trait, member, fallback) =>
		fallback === undefined
			? ex(["ref", { as: traitName(trait) }, member])
			: later("e.as with a fallback"),
	up: () => later("e.up"),
	each: (member: string, trait: TraitArg, m?: string) =>
		m === undefined
			? ex(["ref", member, "$each", trait as string])
			: ex(["ref", member, "$each", { as: traitName(trait) }, m]),
	keyed: () => later("e.keyed"),
	key: () => ex(["ref", "$key"]),
	index: () => ex(["ref", "$index"]),
	text: (s) => ex(["text", s]),
	add: (a, b) => call("add", a, b),
	sub: (a, b) => call("sub", a, b),
	mul: (a, b) => call("mul", a, b),
	div: (a, b) => call("div", a, b),
	sum: (list) => call("sum", list),
	if: (cond, then, otherwise) => call("if", cond, then, otherwise),
	and: (...xs) => call("and", ...xs),
	or: (...xs) => call("or", ...xs),
	eq: (a, b) => call("eq", a, b),
	gt: (a, b) => call("gt", a, b),
	isNull: (a) => call("isNull", a),
	contains: (list, x) => call("contains", list, x),
	concat: (...xs) => call("concat", ...xs),
	record: (fields) => ex(["record", fields as Record<string, ExprArg>]),
	entry: (key, x) => call("entry", key, x),
	merge: (...xs) => call("merge", ...xs),
	call: (f, args) => ex([f.name, args as Record<string, ExprArg>]),
	entity: () => later("e.entity"),
	fn: () => later("e.fn"),
	map: () => later("e.map"),
	filter: () => later("e.filter"),
} as ExprBuilders;

/** At run time an `Ex` is just the Builder's JSON; its node type only exists for TypeScript. */
function ex(json: BuilderExpr): any {
	return json;
}
function call(name: string, ...args: readonly Arg[]): any {
	return ex([name, ...(args as ExprArg[])]);
}
function traitName(trait: TraitArg): string {
	return typeof trait === "string" ? trait : trait.name;
}
function later(what: string): never {
	throw new Error(`thence: ${what} isn't implemented yet`);
}
