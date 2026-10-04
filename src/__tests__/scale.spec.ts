// The scale the README promises: a 100,000-value program with 200 subscribed
// values stays fast. The limits leave room for a slow CI machine; on a laptop
// an op takes well under a millisecond.

import { describe, expect, it } from "vitest";
import { e, entity, kit, std, t } from "..";

const ERow = entity("row", {
	inputs: {
		qty: t.number.initial(1),
		price: t.number.initial(2),
		discount: t.number.initial(0),
	},
	derived: {
		total: e.sub(e.mul(e.self("qty"), e.self("price")), e.self("discount")),
	},
});
const EOrder = entity("order", {
	inputs: { rows: t.list(ERow) },
	derived: { grandTotal: e.sum(e.each("rows", "total")) },
});
const orders = kit({
	name: "orders",
	version: "1.0.0",
	functions: { ...std },
	root: EOrder,
	entities: [EOrder, ERow],
});

/** 25,000 rows of four values each. */
const ROWS = 25_000;

/** The average time of `n` runs of `f`, in milliseconds. */
const time = (n: number, f: (i: number) => void) => {
	const t0 = Date.now();
	for (let i = 0; i < n; i++) f(i);
	return (Date.now() - t0) / n;
};

const start = () => {
	const session = orders.program({}).run([], { replica: "a" });
	const rows = session.root.list("rows");
	const built = time(1, () =>
		session.batch(() => {
			for (let i = 0; i < ROWS; i++) rows.add();
		}),
	);
	const entries = rows.entries();
	const row = (i: number) => (entries[i] as (typeof entries)[number])[1];
	// What a table scrolled to the middle shows.
	const shown = Array.from({ length: 200 }, (_, i) => row(ROWS / 2 + i));
	let heard = 0;
	for (const r of shown) r.member("total").subscribe(() => heard++);
	return { session, rows, row, shown, built, heard: () => heard };
};

describe("a 100,000-value program with 200 subscribed values", () => {
	it("builds, and takes an op in about the same time whatever its size", () => {
		const { rows, row, shown, built, heard } = start();
		expect(built).toBeLessThan(5_000);
		const setShown = time(100, (i) => shown[i]?.member("qty").set(i + 2));
		expect(heard()).toBe(100);
		const setHidden = time(100, (i) =>
			row(i)
				.member("qty")
				.set(i + 2),
		);
		expect(heard()).toBe(100);
		const add = time(100, () => rows.add());
		for (const ms of [setShown, setHidden, add]) expect(ms).toBeLessThan(5);
	});

	it("keeps up a total of every row as well", () => {
		const { session, row } = start();
		const total = session.root.member("grandTotal");
		let last: unknown;
		total.subscribe(() => {
			last = total.get();
		});
		const set = time(100, (i) =>
			row(i * 7)
				.member("price")
				.set(3),
		);
		expect(set).toBeLessThan(5);
		expect(last).toEqual({ ok: true, value: ROWS * 2 + 100 });
	});
});
