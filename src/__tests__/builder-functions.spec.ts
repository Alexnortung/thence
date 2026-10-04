// Builder-defined functions, and kit functions whose bodies call each other.

import { describe, expect, it } from "vitest";
import { e, entity, fn, kit, t } from "..";
import type { Ex, KnownN } from "../kit";

const value = (r: unknown) => (r as { value: unknown }).value;
/** `set` on a member whose type doesn't say it is writable, such as a Builder's formula. */
const write = (member: object, v: unknown) =>
	(member as { set(v: unknown): unknown }).set(v);

const EField = entity("field", { config: { value: t.expr(t.number) } });
const EForm = entity("form", {
	config: { fields: t.map(EField), price: t.expr(t.number) },
	inputs: { cost: t.number.initial(60) },
});
const forms = kit({
	name: "forms",
	version: "1",
	root: EForm,
	entities: [EForm, EField],
});

const margin = {
	params: ["cost", "price"],
	body: ["div", ["sub", ["ref", "price"], ["ref", "cost"]], ["ref", "price"]],
};
const program = (
	functions: Record<string, unknown>,
	fields: Record<string, unknown>,
) =>
	({
		functions,
		config: {
			price: 100,
			fields: Object.fromEntries(
				Object.entries(fields).map(([k, v]) => [
					k,
					{ type: "field", config: { value: v } },
				]),
			),
		},
	}) as never;
const field = (
	session: ReturnType<ReturnType<typeof forms.program>["run"]>,
	k: string,
) => {
	const f = session.root.map("fields").get(k);
	if (!f) throw new Error(`no field ${k}`);
	return f.member("value");
};

describe("Builder-defined functions", () => {
	it("are called like the kit's, and writes go through them", () => {
		const p = forms.program(
			program(
				{ margin, twice: { params: ["x"], body: ["mul", ["ref", "x"], 2] } },
				{
					m: ["margin", ["ref", "$root", "cost"], ["ref", "$root", "price"]],
					named: ["margin", { price: 200, cost: ["ref", "$root", "cost"] }],
					nested: ["twice", ["margin", 50, 100]],
				},
			),
		);
		expect(p.diagnostics).toEqual([]);
		const session = p.run();
		expect(value(field(session, "m").get())).toBe(0.4);
		expect(value(field(session, "named").get())).toBe(0.7);
		expect(value(field(session, "nested").get())).toBe(1);
		// price is a config value, so the write lands on cost
		expect(field(session, "m").writable()).toBe(true);
		write(field(session, "m"), 0.25);
		expect(value(session.root.member("cost").get())).toBe(75);
	});

	it("aren't writable through a parameter the body uses twice", () => {
		const p = forms.program(
			program({ margin }, { m: ["margin", 10, ["ref", "$root", "cost"]] }),
		);
		expect(field(p.run(), "m").writable()).toBe(false);
	});

	it("read only their parameters", () => {
		const diagnostics = forms.check(
			program(
				{
					bad: { params: ["x"], body: ["add", ["ref", "x"], ["ref", "cost"]] },
				},
				{ v: ["bad", 1] },
			),
		);
		expect(diagnostics).toMatchObject([
			{ code: "fn.scope", field: "functions.bad", exprPath: [2] },
		]);
		const p = forms.program(
			program(
				{ bad: { params: ["x"], body: ["ref", "y"] } },
				{ v: ["bad", 1] },
			),
		);
		expect(field(p.run(), "v").get()).toMatchObject({
			ok: false,
			error: { code: "fn.invalid" },
		});
	});

	it("can't call themselves, directly or through another", () => {
		const diagnostics = forms.check(
			program(
				{
					a: { params: ["x"], body: ["b", ["ref", "x"]] },
					b: { params: ["x"], body: ["a", ["ref", "x"]] },
					c: { params: [], body: ["c"] },
					ok: { params: ["x"], body: ["a", ["ref", "x"]] },
				},
				{},
			),
		);
		expect(diagnostics.map((d) => [d.code, d.field])).toEqual([
			["fn.recursive", "functions.a"],
			["fn.recursive", "functions.c"],
		]);
	});

	it("can't take a kit function's name, or bad params", () => {
		const diagnostics = forms.check(
			program(
				{
					add: { params: ["x"], body: ["ref", "x"] },
					dup: { params: ["x", "x"], body: ["ref", "x"] },
				},
				{},
			),
		);
		expect(diagnostics.map((d) => d.code)).toEqual([
			"fn.duplicate",
			"fn.params",
		]);
	});
});

describe("kit functions with bodies", () => {
	const raw = (json: unknown) => json as Ex<KnownN<number>>;
	const ERoot = entity("root", { inputs: { x: t.number.initial(1) } });

	it("may call each other", () => {
		const double = fn("double", {
			params: { x: t.number },
			returns: t.number,
			body: ({ x }) => e.mul(x, 2),
		});
		const quad = fn("quad", {
			params: { x: t.number },
			returns: t.number,
			body: ({ x }) => e.call(double, { x: e.call(double, { x }) }),
		});
		expect(() =>
			kit({
				name: "k",
				version: "1",
				root: ERoot,
				entities: [ERoot],
				functions: { double, quad },
			}),
		).not.toThrow();
	});

	it("can't call themselves, which kit() rejects", () => {
		const ping = fn("ping", {
			params: { x: t.number },
			returns: t.number,
			body: ({ x }) => raw(["pong", x]),
		});
		const pong = fn("pong", {
			params: { x: t.number },
			returns: t.number,
			body: ({ x }) => raw(["ping", x]),
		});
		expect(() =>
			kit({
				name: "k",
				version: "1",
				root: ERoot,
				entities: [ERoot],
				functions: { ping, pong },
			}),
		).toThrow(`"ping" calls itself through "pong"`);
	});
});
