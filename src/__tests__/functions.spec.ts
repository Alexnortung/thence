// Functions: std's and a Developer's are both made with fn(), and called the same way.

import { describe, expect, it } from "vitest";
import { Decimal, e, entity, FnError, fn, type KitSpec, kit, std, t } from "..";
import type { Ex, KnownN } from "../kit";

/** A Builder's formula as raw JSON. */
const raw = (json: unknown) => json as Ex<KnownN<number>>;

const toFahrenheit = fn("toFahrenheit", {
	params: [{ celsius: t.number }],
	returns: t.number,
	body: ({ celsius }) => e.add(e.div(e.mul(celsius, 9), 5), 32),
});
const half = fn("half", {
	params: [{ x: t.number }],
	returns: t.number,
	impl: ({ x }) => x / 2,
});
const describeIt = fn(
	"describe",
	{
		params: [{ x: t.number }],
		returns: t.text,
		impl: ({ x }) => `number ${x}`,
	},
	{
		params: [{ x: t.text }],
		returns: t.text,
		impl: ({ x }) => `text ${x}`,
	},
);
const strict = fn("strict", {
	params: [{ x: t.number }],
	returns: t.number,
	impl: ({ x }) => {
		if (x < 0) throw new FnError("strict.negative", "must not be negative");
		if (x === 0) throw new Error("boom");
		return x;
	},
});

const run = (derived: Record<string, Ex>, a: unknown = 100) => {
	const ETest = entity("test", {
		inputs: { a: t.json.initial(a as never) },
		derived,
	});
	const k = kit({
		name: "fns",
		version: "1.0.0",
		functions: { toFahrenheit, half, describe: describeIt, strict },
		root: ETest,
		entities: [ETest],
	});
	const program = k.program({});
	const root = program.run().root as unknown as {
		member(m: string): { get(): unknown };
	};
	return {
		get: (m: string) => root.member(m).get(),
		diagnostics: program.diagnostics,
	};
};

describe("functions", () => {
	it("inlines a body, with named or positional arguments", () => {
		const { get } = run({
			named: e.call(toFahrenheit, { celsius: e.self("a") }),
			positional: raw(["toFahrenheit", ["ref", "a"]]),
		});
		expect(get("named")).toEqual({ ok: true, value: 212 });
		expect(get("positional")).toEqual({ ok: true, value: 212 });
	});

	it("calls half's impl", () => {
		expect(run({ h: e.call(half, { x: e.self("a") }) }).get("h")).toEqual({
			ok: true,
			value: 50,
		});
	});

	it("picks the overload the arguments fit", () => {
		const d = raw(["describe", ["ref", "a"]]);
		expect(run({ d }, 3).get("d")).toEqual({ ok: true, value: "number 3" });
		expect(run({ d }, "x").get("d")).toEqual({ ok: true, value: "text x" });
		expect(run({ d }, true).get("d")).toMatchObject({
			ok: false,
			error: { code: "call.types" },
		});
	});

	it("passes null only to a nullable parameter", () => {
		const orZero = fn(
			"orZero",
			{
				params: [{ x: t.number }],
				returns: t.number,
				impl: ({ x }) => x,
			},
			{
				params: [{ x: t.number.nullable() }],
				returns: t.number,
				impl: ({ x }) => x ?? 0,
			},
		);
		const ENull = entity("nulls", {
			inputs: { a: t.number.nullable().initial(null) },
			derived: {
				h: e.call(half, { x: e.self("a") }),
				z: e.call(orZero, { x: e.self("a") }),
				sum: e.add(e.self("a"), 1),
			},
		});
		const k = kit({
			name: "nulls",
			version: "1.0.0",
			functions: { half, orZero },
			root: ENull,
			entities: [ENull],
		});
		const root = k.program({}).run().root;
		expect(root.member("h").get()).toMatchObject({
			ok: false,
			error: { code: "call.types" },
		});
		expect(root.member("z").get()).toEqual({ ok: true, value: 0 });
		expect(root.member("sum").get()).toEqual({ ok: true, value: null });
	});

	it("turns an FnError into its code, and anything else thrown into fn.threw", () => {
		const s = raw(["strict", ["ref", "a"]]);
		expect(run({ s }, -1).get("s")).toMatchObject({
			ok: false,
			error: { code: "strict.negative" },
		});
		expect(run({ s }, 0).get("s")).toMatchObject({
			ok: false,
			error: { code: "fn.threw" },
		});
	});

	it("reports a wrong number of arguments or unknown names", () => {
		const { diagnostics } = run({
			few: raw(["half"]),
			names: raw(["half", { y: 1 }]),
		});
		expect(diagnostics.map((d) => d.code)).toEqual(["call.arity", "call.args"]);
	});

	it("reports a body that calls itself", () => {
		const loop = fn("loop", {
			params: [{ x: t.number }],
			returns: t.number,
			body: ({ x }) => raw(["loop", x]),
		});
		const ELoop = entity("loop", { derived: { l: e.call(loop, { x: 1 }) } });
		const k = kit({
			name: "loop",
			version: "1.0.0",
			functions: { loop },
			root: ELoop,
			entities: [ELoop],
		});
		expect(k.check({}).map((d) => d.code)).toEqual(["fn.recursive"]);
	});

	it("throws on a params entry that isn't one parameter, or a name given twice", () => {
		const params = (list: unknown) => () =>
			fn("bad", {
				params: list as never,
				returns: t.number,
				impl: () => 0,
			});
		expect(params([{ a: t.number, b: t.number }])).toThrow("exactly one");
		expect(params([{ a: t.number }, { a: t.text }])).toThrow('named "a"');
	});

	it("offers std's functions unless stdFunctions replaces them", () => {
		const ECalc = entity("calc", {
			inputs: { a: t.number.initial(6) },
			derived: {
				sum: raw(["add", ["ref", "a"], 1]),
				product: raw(["mul", ["ref", "a"], 2]),
			},
		});
		const calc = (spec: Pick<KitSpec, "functions" | "stdFunctions">) =>
			kit({
				name: "calc",
				version: "1.0.0",
				...spec,
				root: ECalc,
				entities: [ECalc],
			});
		const add = fn("add", {
			params: [{ a: t.number }, { b: t.number }],
			returns: t.number,
			impl: ({ a, b }) => a * 10 + b,
		});

		expect(calc({}).check({})).toEqual([]);
		expect(
			calc({ stdFunctions: { mul: std.mul } })
				.check({})
				.map((d) => d.code),
		).toEqual(["fn.unknown"]);
		const replaced = calc({ functions: { add } }).program({}).run().root;
		expect(replaced.member("sum").get()).toEqual({ ok: true, value: 61 });
		expect(replaced.member("product").get()).toEqual({ ok: true, value: 12 });
	});

	it("keeps a decimal's type in std arithmetic", () => {
		const Money = t.decimal("Money", { scale: 2 });
		const EPrice = entity("price", {
			inputs: { price: Money.initial("9.99") },
			derived: {
				twice: e.mul(e.self("price"), 2),
				hundred: e.mul(100, e.self("price")),
			},
		});
		const k = kit({
			name: "money",
			version: "1.0.0",
			root: EPrice,
			entities: [EPrice],
		});
		const root = k.program({}).run().root;
		const twice = root.member("twice").get();
		expect(
			twice.ok && twice.value instanceof Decimal && String(twice.value),
		).toBe("19.98");
		// A number first still gives the decimal's type.
		const hundred = root.member("hundred").get();
		expect(
			hundred.ok && hundred.value instanceof Decimal && String(hundred.value),
		).toBe("999.00");
	});
});
