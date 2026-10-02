import type {
	Converge,
	EnumDef,
	EnumType,
	ExprType,
	Initial,
	Meta,
	Optional,
	TypeBuilders,
	TypeSpec,
	ValueType,
} from "./types";

/** The value types and member types; see {@link TypeBuilders}. */
export const t: TypeBuilders = {
	number: Object.assign(
		(name: string, opts?: { converge?: Converge }) =>
			valueType<number>({
				base: "number",
				name,
				nullable: false,
				checks: [],
				...(opts?.converge ? { converge: opts.converge } : {}),
			}),
		valueType<number>(base("number")),
	),
	int: valueType(base("int")),
	decimal: (name, { scale }) =>
		valueType({ base: "decimal", name, scale, nullable: false, checks: [] }),
	text: valueType(base("text")),
	bool: valueType(base("bool")),
	date: valueType(base("date")),
	json: valueType(base("json")),
	enum: Object.assign(
		<const Vs extends readonly string[]>(name: string, values: Vs) => {
			const type = valueType<Vs[number]>({
				base: "enum",
				name,
				values,
				nullable: false,
				checks: [],
			});
			return Object.assign(type, { values }) as EnumType<Vs[number]>;
		},
		{
			def: (): EnumDef => ({ "~kind": "enumDef" }),
			from: (member: string) =>
				valueType<string>({ ...base("enum"), from: member }),
		},
	),
	expr: <V>(type: ValueType<V>): ExprType<V> => {
		const self: ExprType<V> = {
			"~kind": "expr",
			"~v": undefined as V,
			type,
			optional: () => optional(self),
		};
		return self;
	},
	list: (of) => ({ "~kind": "list", "~of": of }),
	map: (of) => ({ "~kind": "map", "~of": of }),
	oneOf: (...of) => ({ "~kind": "oneOf", "~of": of }),
	all: (...of) => ({ "~kind": "all", "~of": of }),
	meta: <M>(): Meta<M> => ({ "~kind": "meta", "~m": undefined as M }),
};

function base(b: TypeSpec["base"]): TypeSpec {
	return { base: b, nullable: false, checks: [] };
}

function optional<X>(of: X): Optional<X> {
	return { "~kind": "optional", "~of": of };
}

/** Builds a value type as plain data. `"~v"` only exists for TypeScript. */
function valueType<V>(spec: TypeSpec): ValueType<V> {
	const self: ValueType<V> = {
		"~kind": "value",
		"~v": undefined as V,
		spec,
		nullable: () => valueType<V | null>({ ...spec, nullable: true }),
		initial: (value) => {
			const init: Initial<V> = {
				"~kind": "initial",
				"~v": undefined as V,
				type: self,
				value,
				check: (schema) => ({ ...init, type: self.check(schema) }),
			};
			return init;
		},
		optional: () => optional(self),
		check: (schema) => valueType({ ...spec, checks: [...spec.checks, schema] }),
	};
	return self;
}
