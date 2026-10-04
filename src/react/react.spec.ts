// @vitest-environment happy-dom

import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { e, entity, kit, t } from "..";
import type { Result } from "../values";
import { SessionProvider, useEntries, useValue, useWritable } from ".";

const ERow = entity("row", {
	inputs: { qty: t.int.initial(1) },
	derived: { doubled: e.mul(e.self("qty"), 2) },
});
const ERoot = entity("root", {
	inputs: { rows: t.list(ERow), note: t.text.initial("") },
	derived: { total: e.sum(e.each("rows", "doubled")) },
});
const rows = kit({
	name: "rows",
	version: "1.0.0",
	root: ERoot,
	entities: [ERoot, ERow],
});

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const doc = (
	globalThis as unknown as {
		document: { createElement(tag: string): { textContent: string } };
	}
).document;
let unmount: (() => void) | undefined;
afterEach(() => unmount?.());

/** Runs `f` inside `act`, and returns what it returned. */
function acted<T>(f: () => T): T {
	let out: T | undefined;
	act(() => {
		out = f();
	});
	return out as T;
}

/** Renders `node` and returns the container, whose text the tests read. */
function render(node: ReactNode) {
	const container = doc.createElement("div");
	const root = createRoot(container as never);
	act(() => root.render(node));
	unmount = () => act(() => root.unmount());
	return container;
}

/** Counts the renders of a component that shows `show()`. */
function counted(show: () => string) {
	const counter = { renders: 0, Show: () => "" };
	counter.Show = () => {
		counter.renders++;
		return show();
	};
	return counter;
}

const text = (r: Result<unknown> | undefined) =>
	r === undefined ? "none" : r.ok ? String(r.value) : r.error.code;

describe("useValue", () => {
	it("re-renders when the value changes, and not when it is set to the same", () => {
		const session = rows.program({}).run();
		const total = counted(() => text(useValue(session, ["total"])));
		const container = render(createElement(total.Show));
		expect(container.textContent).toBe("0");

		const row = acted(() => session.root.list("rows").add());
		expect(container.textContent).toBe("2");
		const before = total.renders;
		act(() => {
			row.member("qty").set(1);
		});
		expect(total.renders).toBe(before);
		act(() => {
			row.member("qty").set(5);
		});
		expect(container.textContent).toBe("10");
		expect(total.renders).toBe(before + 1);
	});

	it("follows a position: the value of whichever row is there now", () => {
		const session = rows.program({}).run();
		const list = session.root.list("rows");
		const first = counted(() => text(useValue(session, ["rows", 0, "qty"])));
		const container = render(createElement(first.Show));
		expect(container.textContent).toBe("none");
		const a = acted(() => list.add());
		const b = acted(() => list.add());
		act(() => {
			a.member("qty").set(3);
			b.member("qty").set(4);
		});
		expect(container.textContent).toBe("3");
		act(() => list.move(a.id, 1));
		expect(container.textContent).toBe("4");
		act(() => list.remove(b.id));
		expect(container.textContent).toBe("3");
	});

	it("doesn't re-render for changes around the value that leave it as it was", () => {
		const session = rows.program({}).run();
		const list = session.root.list("rows");
		const [a, b, c] = acted(() => [list.add(), list.add(), list.add()]);
		const first = counted(() => text(useValue(session, ["rows", 0, "qty"])));
		const own = counted(() => text(useValue(a, ["qty"])));
		render(
			createElement(
				"div",
				null,
				createElement(first.Show),
				createElement(own.Show),
			),
		);
		const renders = [first.renders, own.renders];
		act(() => {
			// The root's other input, a sibling's value, and the total over every row.
			session.root.member("note").set("changed");
			b.member("qty").set(7);
			// Rows moving behind the first one.
			list.move(c.id, 1);
		});
		expect([first.renders, own.renders]).toEqual(renders);
	});

	it("reads a path alone from the session SessionProvider gives", () => {
		const session = rows.program({}).run();
		const total = counted(() => text(useValue(["total"])));
		const container = render(
			createElement(SessionProvider, { session }, createElement(total.Show)),
		);
		acted(() => session.root.list("rows").add());
		expect(container.textContent).toBe("2");
	});

	it("needs a SessionProvider for a path alone", () => {
		const Total = () => text(useValue(["total"]));
		expect(() => render(createElement(Total))).toThrow(/SessionProvider/);
	});
});

describe("useWritable", () => {
	it("sets the value the path names, as useState would", () => {
		const session = rows.program({}).run();
		const row = acted(() => session.root.list("rows").add());
		let set: ((v: number) => unknown) | undefined;
		const Qty = () => {
			const [qty, setQty] = useWritable(session, ["rows", 0, "qty"]);
			set = setQty;
			return text(qty);
		};
		const container = render(createElement(Qty));
		expect(container.textContent).toBe("1");
		act(() => {
			set?.(6);
		});
		expect(container.textContent).toBe("6");
		expect(row.member("qty").get()).toEqual({ ok: true, value: 6 });
	});
});

describe("useEntries", () => {
	it("re-renders when rows are added or removed, not when a value in them changes", () => {
		const session = rows.program({}).run();
		const list = session.root.list("rows");
		const ids = counted(() =>
			useEntries(session, ["rows"])
				.map(([id]) => id)
				.join(","),
		);
		const container = render(createElement(ids.Show));
		expect(container.textContent).toBe("");
		const a = acted(() => list.add());
		const b = acted(() => list.add());
		expect(container.textContent).toBe(`${a.id},${b.id}`);
		const before = ids.renders;
		act(() => {
			a.member("qty").set(3);
		});
		expect(ids.renders).toBe(before);
		act(() => list.remove(a.id));
		expect(container.textContent).toBe(b.id);
	});
});
