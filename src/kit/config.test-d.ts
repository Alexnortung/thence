import { describe, it } from "vitest";
import { kit } from "..";
import { entity, t } from ".";

describe("kit", () => {
	it("checks what config functions return once every entity exists", () => {
		const EGood = entity("good", { config: { rows: () => t.list(ERow) } });
		kit({ name: "k", version: "1", root: EGood, entities: [EGood, ERow] });

		const EBad = entity("bad", { config: { rows: () => 5 } });
		// @ts-expect-error rows' function returns a number, not a member type
		kit({ name: "k", version: "1", root: EBad, entities: [EBad, ERow] });
	});
});

const ERow = entity("row", { inputs: { amount: t.number.initial(0) } });
