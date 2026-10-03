// Building programs step by step, and walking a program that was built.

import { describe, expect, it } from "vitest";
import { e, entity, kit, std, t } from "..";

const EItem = entity("items", {
	inputs: {
		rows: t.list(entity("row", { inputs: { amount: t.number.initial(0) } })),
	},
	derived: { total: e.sum(e.each("rows", "amount")) },
});
const ECharge = entity("charge", {
	config: { formula: t.expr(t.number), note: t.text.optional() },
});
const ESection = entity("section", {
	config: { lines: t.map(t.oneOf(EItem, ECharge)) },
});
const EQuote = entity("quote", {
	config: { sections: t.map(ESection), notes: t.list(ECharge) },
	inputs: { discount: t.number.initial(0) },
});
const quotes = kit({
	name: "quotes",
	version: "1",
	root: EQuote,
	entities: [
		EQuote,
		ESection,
		EItem,
		ECharge,
		EItem["~def"].inputs.rows["~of"],
	],
	functions: { ...std },
});

const shipping = [
	"add",
	["ref", "items", "total"],
	["ref", "$root", "discount"],
] as const;
const tree = {
	config: {
		sections: {
			hardware: {
				type: "section",
				meta: { label: "Hardware" },
				config: {
					lines: {
						items: { type: "items" },
						shipping: { type: "charge", config: { formula: shipping } },
					},
				},
			},
		},
		notes: [{ type: "charge", config: { formula: ["twice", 2] } }],
	},
	functions: { twice: { params: ["x"], body: ["mul", ["ref", "x"], 2] } },
};

describe("building a program step by step", () => {
	it("gives the same program as the plain tree", () => {
		const built = quotes.program((p) => {
			p.define("twice", { params: ["x"], body: ["mul", ["ref", "x"], 2] });
			const hardware = p.root.add(
				"sections",
				"hardware",
				{ type: "section", config: {} } as never,
				{ meta: { label: "Hardware" } } as never,
			);
			hardware.add("lines", "items", { type: "items" } as never);
			hardware.add("lines", "shipping", {
				type: "charge",
				config: { formula: shipping },
			} as never);
			p.root.add("notes", "first", {
				type: "charge",
				config: { formula: ["twice", 2] },
			} as never);
		});
		const plain = quotes.program(tree as never);
		expect(built.diagnostics).toEqual([]);
		expect([...built.parts()]).toEqual([...plain.parts()]);
		const note = built.run().at(["notes", 0, "formula"]);
		expect(note?.get()).toEqual({ ok: true, value: 4 });
	});

	it("won't place one name twice in a map", () => {
		expect(() =>
			quotes.program((p) => {
				p.root.add("sections", "a", { type: "section" } as never);
				p.root.add("sections", "a", { type: "section" } as never);
			}),
		).toThrow(`"a" is already placed in "sections"`);
	});
});

describe("walking a program", () => {
	const program = quotes.program(tree as never);

	it("lists every placed node with its path", () => {
		expect([...program.parts()].map((p) => [p.path, p.type, p.meta])).toEqual([
			[["sections", "hardware"], "section", { label: "Hardware" }],
			[["sections", "hardware", "lines", "items"], "items", undefined],
			[["sections", "hardware", "lines", "shipping"], "charge", undefined],
			[["notes", 0], "charge", undefined],
		]);
	});

	it("tells what a value reads, and what reads it", () => {
		const formula = ["sections", "hardware", "lines", "shipping", "formula"];
		expect(program.dependencies(formula)).toEqual([
			["sections", "hardware", "lines", "items", "total"],
			["discount"],
		]);
		expect(program.dependencies(formula.slice(0, -1))).toEqual(
			program.dependencies(formula),
		);
		expect(program.dependents(["discount"])).toEqual([formula]);
		expect(
			program.dependents(["sections", "hardware", "lines", "items"]),
		).toEqual([formula]);
		expect(
			program.dependencies(["sections", "hardware", "lines", "items", "total"]),
		).toEqual([
			["sections", "hardware", "lines", "items", "rows", "$each", "amount"],
		]);
	});

	it("lists what no longer fits after a breaking kit change", () => {
		const ECharge2 = entity("charge", {
			config: { formula: t.expr(t.number) },
		});
		const ESection2 = entity("section", {
			config: { lines: t.map(ECharge2) },
		});
		const EQuote2 = entity("quote", {
			config: { sections: t.map(ESection2), notes: t.list(ECharge2) },
		});
		const next = kit({
			name: "quotes",
			version: "2",
			root: EQuote2,
			entities: [EQuote2, ESection2, ECharge2],
			functions: { ...std },
		});
		const shippingAt = ["sections", "hardware", "lines", "shipping"];
		expect(
			next
				.check({
					...tree,
					config: { ...tree.config, notes: [] },
					inputs: { discount: 5 },
				})
				.map((d) => [d.code, d.at]),
		).toEqual([
			["input.unknown", []],
			["node.unknown", ["sections", "hardware", "lines", "items"]],
			["ref.unknown", shippingAt],
			["ref.unknown", shippingAt],
		]);
	});
});
