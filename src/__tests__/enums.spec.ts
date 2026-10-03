// Builder enums: a config member holds the values, an input takes one.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { entity, kit, t } from "..";
import type { Op } from "../log";

const Country = t.enum("Country", ["SE", "NO", "DK"]);
const EChoice = entity("choice", {
	config: { options: t.enum.def() },
	inputs: { value: t.enum.from("options").nullable() },
});
const EForm = entity("form", { config: { fields: t.map(EChoice) } });
const forms = kit({
	name: "forms",
	version: "1",
	root: EForm,
	entities: [EForm, EChoice],
	types: { Country },
	meta: z.object({ label: z.string() }).strict(),
});

const size = (...values: string[]) => ({
	type: "choice",
	config: {
		options: {
			enum: values.map((value) => ({
				value,
				meta: { label: value.toUpperCase() },
			})),
		},
	},
});
const program = (fields: Record<string, unknown>) =>
	forms.program({ config: { fields } } as never);
const choiceValue = (
	session: ReturnType<ReturnType<typeof program>["run"]>,
	key: string,
) => session.root.map("fields").get(key)?.member("value");

describe("Builder enums", () => {
	it("lists the Builder's values, or the kit's, with their meta", () => {
		const p = program({
			size: size("s", "m"),
			country: { type: "choice", config: { options: "Country" } },
		});
		expect(p.diagnostics).toEqual([]);
		const session = p.run();
		expect(choiceValue(session, "size")?.options()).toEqual([
			{ value: "s", meta: { label: "S" } },
			{ value: "m", meta: { label: "M" } },
		]);
		expect(choiceValue(session, "country")?.options()).toEqual([
			{ value: "SE" },
			{ value: "NO" },
			{ value: "DK" },
		]);
	});

	it("takes only the enum's values from the Operator", () => {
		const value = choiceValue(program({ size: size("s", "m") }).run(), "size");
		expect(value?.set("m")).toMatchObject({ ok: true });
		expect(value?.set("xl")).toMatchObject({
			ok: false,
			error: { code: "op.type" },
		});
		expect(value?.get()).toEqual({ ok: true, value: "m" });
	});

	it("keeps a value the Builder removed, as an issue", () => {
		const before = program({ size: size("s", "m") }).run();
		choiceValue(before, "size")?.set("m");
		const ops: readonly Op[] = before.ops();
		const after = program({ size: size("s", "l") }).run(ops);
		expect(choiceValue(after, "size")?.get()).toEqual({ ok: true, value: "m" });
		expect(after.issues()).toEqual([
			{
				message: 'enum.unknown: "m" is no longer one of the values',
				path: ["fields", "size", "value"],
			},
		]);
	});

	it("reports an enum that isn't one", () => {
		const p = program({
			a: { type: "choice", config: { options: "Planet" } },
			b: {
				type: "choice",
				config: {
					options: { enum: [{ value: "x" }, { value: "x" }, { value: "" }] },
				},
			},
			c: {
				type: "choice",
				config: { options: { enum: [{ value: "x", meta: { lable: "X" } }] } },
			},
			d: { type: "choice" },
		});
		expect(p.diagnostics.map((d) => [d.code, d.at])).toEqual([
			["enum.invalid", ["fields", "a"]],
			["enum.invalid", ["fields", "b"]],
			["enum.invalid", ["fields", "b"]],
			["meta.invalid", ["fields", "c"]],
			["meta.invalid", ["fields", "c"]],
			["config.missing", ["fields", "d"]],
		]);
	});
});
