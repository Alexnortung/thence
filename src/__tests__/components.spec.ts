// Components: a piece of a program the Builder defines once and places many times.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { e, entity, kit, t } from "..";

const EText = entity("text", { inputs: { value: t.text.initial("") } });
const ENumber = entity("number", { inputs: { value: t.number.initial(0) } });
const ECheck = entity("check", { inputs: { value: t.bool.initial(false) } });
const ECalc = entity("calc", {
	config: { formula: t.expr(t.number) },
	derived: { value: e.self("formula") },
});
const ESection = entity("section", {
	config: {
		showWhen: t.expr(t.bool).optional(),
		title: t.text.optional(),
		fields: t.map(t.oneOf(EText, ENumber, ECalc, ECheck, () => ESection)),
	},
});
const EForm = entity("form", {
	config: { fields: t.map(t.oneOf(EText, ENumber, ECalc, ECheck, ESection)) },
});
const forms = kit({
	name: "forms",
	version: "1",
	root: EForm,
	entities: [EForm, ESection, EText, ENumber, ECalc, ECheck],
	meta: z.object({ label: z.string() }),
});

const address = {
	params: { showWhen: { expr: "bool" }, title: "text" },
	body: {
		type: "section",
		meta: { label: "Address" },
		config: {
			showWhen: ["param", "showWhen"],
			title: ["param", "title"],
			fields: {
				zip: { type: "number" },
				twice: {
					type: "calc",
					config: { formula: ["mul", ["ref", "zip", "value"], 2] },
				},
			},
		},
	},
};
const program = (
	fields: Record<string, unknown>,
	components: Record<string, unknown> = { address },
) => forms.program({ components, config: { fields } } as never);

describe("components", () => {
	it("places the body at each placement, with its own meta and params", () => {
		const p = program({
			employed: { type: "check" },
			home: {
				use: "address",
				meta: { label: "Home" },
				params: { showWhen: true, title: "Home" },
			},
			work: {
				use: "address",
				params: {
					showWhen: ["ref", "employed", "value"],
					title: "Work",
				},
			},
		});
		expect(p.diagnostics).toEqual([]);
		const session = p.run();
		const home = session.root.map("fields").get("home");
		expect(home?.type).toBe("section");
		expect(home?.meta).toEqual({ label: "Home" });
		expect(session.root.map("fields").get("work")?.meta).toEqual({
			label: "Address",
		});
		expect(session.at(["fields", "home", "title"])?.get()).toEqual({
			ok: true,
			value: "Home",
		});
		(
			session.at(["fields", "home", "fields", "zip", "value"]) as never as {
				set(v: number): void;
			}
		).set(21);
		expect(
			session.at(["fields", "home", "fields", "twice", "value"])?.get(),
		).toEqual({ ok: true, value: 42 });
	});

	it("checks and computes a param's formula where the component is placed", () => {
		const session = program({
			employed: { type: "check" },
			work: {
				use: "address",
				params: {
					showWhen: ["ref", "employed", "value"],
					title: "Work",
				},
			},
		}).run();
		const showWhen = session.at(["fields", "work", "showWhen"]);
		expect(showWhen?.get()).toEqual({ ok: true, value: false });
		(
			session.at(["fields", "employed", "value"]) as never as {
				set(v: boolean): void;
			}
		).set(true);
		expect(showWhen?.get()).toEqual({ ok: true, value: true });
	});

	it("moves a param's formula to where the body uses it", () => {
		const doubled = {
			params: { amount: { expr: "number" } },
			body: {
				type: "section",
				config: {
					fields: {
						c: { type: "calc", config: { formula: ["param", "amount"] } },
					},
				},
			},
		};
		const session = program(
			{
				n: { type: "number" },
				x: {
					use: "doubled",
					params: { amount: ["mul", ["ref", "n", "value"], 2] },
				},
			},
			{ doubled },
		).run();
		(
			session.at(["fields", "n", "value"]) as never as { set(v: number): void }
		).set(4);
		expect(session.at(["fields", "x", "fields", "c", "value"])?.get()).toEqual({
			ok: true,
			value: 8,
		});
	});

	it("seals the body's formulas", () => {
		const leaky = {
			body: {
				type: "section",
				config: {
					fields: {
						a: {
							type: "calc",
							config: { formula: ["ref", "$root", "fields", "n", "value"] },
						},
						b: {
							type: "calc",
							config: { formula: ["ref", "$parent", "$parent", "n", "value"] },
						},
					},
				},
			},
		};
		const p = program(
			{ n: { type: "number" }, x: { use: "leaky" } },
			{ leaky },
		);
		expect(p.diagnostics.map((d) => [d.code, d.at, d.component])).toEqual([
			["scope.sealed", ["fields", "x", "fields", "a"], "leaky"],
			["scope.sealed", ["fields", "x", "fields", "b"], "leaky"],
		]);
	});

	it("reports params that don't fit, and a component that places itself", () => {
		const loop = {
			body: { type: "section", config: { fields: { again: { use: "loop" } } } },
		};
		const p = program(
			{
				a: { use: "address", params: { showWhen: true, title: 3, extra: 1 } },
				b: { use: "nope" },
				c: { use: "loop" },
				d: {
					type: "section",
					config: { title: ["param", "title"], fields: {} },
				},
			},
			{
				address,
				loop,
				bad: { params: { x: "Planet" }, body: { type: "text" } },
			},
		);
		expect(p.diagnostics.map((d) => [d.code, d.at, d.component])).toEqual([
			["component.invalid", [], "bad"],
			["param.unknown", ["fields", "a"], "address"],
			["type.mismatch", ["fields", "a"], "address"],
			["type.mismatch", ["fields", "a"], "address"],
			["component.unknown", ["fields", "b"], undefined],
			["component.recursive", ["fields", "c", "fields", "again"], "loop"],
			["param.outside", ["fields", "d"], undefined],
		]);
	});

	it("can be built step by step", () => {
		const built = forms.program((p) => {
			p.component("address", address as never);
			p.root.use("fields", "home", "address", {
				showWhen: true,
				title: "Home",
			});
		});
		expect(built.diagnostics).toEqual([]);
		expect([...built.parts()].map((part) => part.path)).toEqual([
			["fields", "home"],
			["fields", "home", "fields", "zip"],
			["fields", "home", "fields", "twice"],
		]);
	});
});
