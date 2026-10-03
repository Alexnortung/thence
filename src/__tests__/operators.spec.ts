// Several Operators: every replica ends with the same values, whatever order ops arrive in.

import { describe, expect, it } from "vitest";
import { e, entity, impl, kit, type Op, std, t, trait } from "..";

const TPerson = trait("person", { name: t.text });
const EPersonField = entity("personField", {
	inputs: { first: t.text.initial("") },
	impls: [impl(TPerson, { name: e.self("first") })],
});
const EImported = entity("imported", {
	inputs: { full: t.text.initial("") },
	impls: [impl(TPerson, { name: e.self("full") })],
});
const ERow = entity("row", {
	inputs: { amount: t.number.initial(0), note: t.text.nullable() },
});
const ERate = entity("rate", { inputs: { rate: t.number.initial(0) } });
const EQuote = entity("quote", {
	inputs: {
		qty: t.int.initial(1),
		rows: t.list(ERow),
		rates: t.map(ERate),
		customer: TPerson.initial(EPersonField),
	},
	derived: {
		total: e.sum(e.each("rows", "amount")),
		rateSum: e.sum(e.each("rates", "rate")),
	},
});
const quotes = kit({
	name: "quotes",
	version: "1",
	root: EQuote,
	entities: [EQuote, ERow, ERate, EPersonField, EImported],
	functions: { ...std },
});
const program = quotes.program({});
type Session = ReturnType<typeof program.run>;

/** A small seeded random number generator, so a failing order can be replayed. */
function random(seed: number): () => number {
	let a = seed;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let x = Math.imul(a ^ (a >>> 15), 1 | a);
		x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
		return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
	};
}

/** One random change through handles, as an Operator's click would make it. */
function act(s: Session, next: () => number): void {
	const pick = <T>(xs: readonly T[]): T | undefined =>
		xs[Math.floor(next() * xs.length)];
	const root = s.root;
	const rows = root.list("rows");
	const rates = root.map("rates");
	const row = pick(rows.entries())?.[1];
	const rate = pick(rates.entries())?.[1];
	switch (Math.floor(next() * 11)) {
		case 0:
			root.member("qty").set(Math.floor(next() * 10));
			break;
		case 1:
			root.member("qty").clear();
			break;
		case 2:
			rows
				.add()
				.member("amount")
				.set(Math.floor(next() * 100));
			break;
		case 3:
			row?.member("amount").set(Math.floor(next() * 100));
			break;
		case 4:
			if (row) rows.remove(row.id);
			break;
		case 5:
			if (row) rows.move(row.id, Math.floor(next() * 3));
			break;
		case 6: {
			const key = pick(["SE", "NO", "DK"]) as string;
			if (!rates.get(key)) rates.add(key).member("rate").set(next());
			break;
		}
		case 7:
			rate?.member("rate").set(next());
			break;
		case 8:
			if (rate) rates.remove(rate.id);
			break;
		case 9:
			root.member("customer").set({
				type: next() < 0.5 ? "personField" : "imported",
			});
			break;
		case 10: {
			const person = root.entity("customer");
			if (person.type === "personField") person.member("first").set("Ada");
			else person.member("full").set("Grace Hopper");
			break;
		}
	}
}

function shuffle<T>(xs: readonly T[], next: () => number): T[] {
	const out = [...xs];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(next() * (i + 1));
		[out[i], out[j]] = [out[j] as T, out[i] as T];
	}
	return out;
}

describe("several Operators", () => {
	it("converges whatever order ops arrive in", () => {
		for (let seed = 1; seed <= 40; seed++) {
			const next = random(seed);
			// Three Operators start from the same ops, then work without seeing each other.
			const base = program.run([], { replica: "base" });
			for (let i = 0; i < 6; i++) act(base, next);
			const replicas = ["a", "b", "c"].map((replica) =>
				program.run(base.ops(), { replica }),
			);
			for (const r of replicas) for (let i = 0; i < 12; i++) act(r, next);
			const all: Op[] = [
				...base.ops(),
				...replicas.flatMap((r) => r.ops().slice(base.ops().length)),
			];

			// Each replica then receives everyone's ops, some twice.
			for (const r of replicas) r.apply(shuffle(all, next));
			const expected = JSON.stringify(replicas[0]?.snapshot());
			for (const r of replicas) {
				expect(JSON.stringify(r.snapshot()), `seed ${seed}`).toBe(expected);
			}
			// A server replaying the ops in any order, even before their adds, agrees.
			for (let k = 0; k < 3; k++) {
				const server = program.run();
				server.apply(shuffle(all, next));
				expect(JSON.stringify(server.snapshot()), `seed ${seed}`).toBe(
					expected,
				);
			}
		}
	});

	it("rejects an op that doesn't fit, so a server can replay safely", () => {
		const server = program.run();
		server.apply([
			{ t: "set", at: ["qty"], v: "many", clock: "a:1" },
			{ t: "set", at: ["nope"], v: 1, clock: "a:2" },
			{ t: "set", at: ["customer"], v: { type: "row" }, clock: "a:3" },
		]);
		expect(server.ops()).toEqual([]);
	});
});
