// Cycles: values that depend on themselves are iterated from a cold seed.

import { describe, expect, it } from "vitest";
import { e, entity, kit, std, t } from "..";
import type { Ex, KnownN } from "../kit";

const raw = (json: unknown) => json as Ex<KnownN<number>>;
const value = (r: unknown) => (r as { value: unknown }).value;

const Flow = t.number("Flow");
const Temperature = t.number("Temperature", { converge: { abs: 1e-9 } });

const EExchanger = entity("exchanger", {
	inputs: { inletTemp: Temperature.initial(20) },
	config: { flowLaw: t.expr(Flow), heatLaw: t.expr(Temperature) },
	derived: { flow: e.self("flowLaw"), outletTemp: e.self("heatLaw") },
	seeds: { outletTemp: 20 },
});
const exchangers = kit({
	name: "exchangers",
	version: "1",
	root: EExchanger,
	entities: [EExchanger],
	functions: { ...std },
});
const exchanger = {
	config: {
		flowLaw: ["mul", ["ref", "outletTemp"], 0.5],
		heatLaw: ["div", ["add", ["ref", "inletTemp"], ["ref", "flow"]], 2],
	},
} as const;

const ELoop = entity("loop", {
	inputs: { x: t.number.initial(1) },
	derived: {
		square: raw(["mul", ["ref", "square"], ["ref", "square"]]),
		seeded: raw(["mul", ["ref", "seeded"], ["ref", "seeded"]]),
		a: raw(["add", ["ref", "b"], ["ref", "x"]]),
		b: raw(["ref", "a"]),
		after: raw(["mul", ["ref", "a"], 2]),
		half: raw(["div", ["add", ["ref", "half"], ["ref", "x"]], 2]),
	},
	seeds: { seeded: 1 },
});
const loops = kit({
	name: "loops",
	version: "1",
	root: ELoop,
	entities: [ELoop],
	functions: { ...std },
});

describe("cycles", () => {
	it("iterates a cycle through config and derived values until it settles", () => {
		const program = exchangers.program(exchanger);
		expect(program.diagnostics).toEqual([]);
		const { root } = program.run();
		const out = value(root.member("outletTemp").get()) as number;
		expect(out).toBeCloseTo(40 / 3, 8);
		expect(value(root.member("flow").get())).toBeCloseTo(20 / 3, 8);
		expect(root.member("flow").writable()).toBe(false);
	});

	it("starts from the seed, or the type's zero", () => {
		const { root } = loops.program({}).run();
		expect(value(root.member("square").get())).toBe(0);
		expect(value(root.member("seeded").get())).toBe(1);
	});

	it("reports a cycle that doesn't settle, and only what depends on it", () => {
		const { root } = loops.program({}).run();
		for (const name of ["a", "b"] as const) {
			expect(root.member(name).get()).toMatchObject({
				ok: false,
				error: { code: "cycle.nonconvergent", at: [name] },
			});
		}
		expect(root.member("after").get()).toMatchObject({
			ok: false,
			error: { code: "cycle.nonconvergent", at: ["after"] },
		});
		expect(value(root.member("half").get())).toBe(1);
	});

	it("computes again from the seed when an input changes", () => {
		const one = loops.program({}).run();
		one.root.member("x").set(3);
		one.root.member("x").set(8);
		const other = loops.program({}).run();
		other.root.member("x").set(8);
		expect(one.root.member("half").get()).toEqual(
			other.root.member("half").get(),
		);
		expect(value(other.root.member("half").get())).toBe(8);
	});

	it("follows a Builder's formulas through siblings", () => {
		const EField = entity("field", { config: { value: t.expr(t.number) } });
		const EForm = entity("form", { config: { fields: t.map(EField) } });
		const forms = kit({
			name: "forms",
			version: "1",
			root: EForm,
			entities: [EForm, EField],
			functions: { ...std },
		});
		const field = (value: unknown) => ({ type: "field", config: { value } });
		const program = forms.program({
			config: {
				fields: {
					x: field(["add", ["ref", "y", "value"], 1]),
					y: field(["mul", ["ref", "x", "value"], 0.5]),
				},
			},
		} as never);
		expect(program.diagnostics).toEqual([]);
		const fields = program.run().root.map("fields");
		expect(value(fields.get("x")?.member("value").get())).toBe(2);
		expect(value(fields.get("y")?.member("value").get())).toBe(1);
	});
});
