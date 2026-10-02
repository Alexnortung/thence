import { describe, it } from "vitest";
import { e, entity, t, trait } from ".";

describe("entity", () => {
	it("takes member types as config, or functions for entities defined further down", () => {
		entity("field", { config: { label: t.text, rows: () => t.list(ERow) } });
		// @ts-expect-error a number isn't a member type
		entity("field", { config: { label: 5 } });
	});

	it("takes a seed for each derived value, typed by the value", () => {
		entity("exchanger", {
			config: { heatLaw: t.expr(t.number) },
			derived: { outletTemp: e.self("heatLaw") },
			seeds: { outletTemp: 20 },
		});
		entity("exchanger", {
			config: { heatLaw: t.expr(t.number) },
			derived: { outletTemp: e.self("heatLaw") },
			// @ts-expect-error outletTemp is a number
			seeds: { outletTemp: "warm" },
		});
		entity("exchanger", {
			config: { heatLaw: t.expr(t.number) },
			derived: { outletTemp: e.self("heatLaw") },
			// @ts-expect-error only derived values have seeds
			seeds: { heatLaw: 20 },
		});
	});

	it("takes only member types as inputs", () => {
		entity("item", {
			// @ts-expect-error a plain value isn't a member type
			inputs: { qty: 1 },
		});
	});
});

describe("trait", () => {
	it("takes only member types as members", () => {
		trait("priced", { total: t.number });
		// @ts-expect-error a plain value isn't a member type
		trait("priced", { total: 1 });
	});
});

const ERow = entity("row", { inputs: { amount: t.number.initial(0) } });
