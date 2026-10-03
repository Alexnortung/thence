import { describe, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { kit } from "..";
import { entity, type MetaOf, type NodeOf, t } from ".";

const ENote = entity("note", { config: { text: t.text } });
const ERoot = entity("root", { config: { notes: t.list(ENote) } });

describe("meta", () => {
	it("is typed by the kit's meta schema, as the schema accepts it", () => {
		const notes = kit({
			name: "notes",
			version: "1",
			root: ERoot,
			entities: [ERoot, ENote],
			meta: z.object({ label: z.string(), order: z.coerce.number() }),
		});
		expectTypeOf<MetaOf<typeof notes>>().toEqualTypeOf<{
			label: string;
			order: unknown;
		}>();
		const node: NodeOf<typeof notes> = {
			type: "note",
			meta: { label: "First", order: 1 },
			config: { text: "hi" },
		};
		expectTypeOf(node).not.toBeAny();
		// @ts-expect-error lable isn't in the schema
		const _bad: NodeOf<typeof notes> = { type: "note", meta: { lable: "x" } };
	});

	it("is unknown without a schema", () => {
		const notes = kit({
			name: "notes",
			version: "1",
			root: ERoot,
			entities: [ERoot, ENote],
		});
		expectTypeOf<MetaOf<typeof notes>>().toBeUnknown();
	});
});
