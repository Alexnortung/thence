// @vitest-environment happy-dom

import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { e, entity, kit, std, t } from "..";
import { useEntries, useValue } from ".";

const ERow = entity("row", {
	inputs: { qty: t.int.initial(1) },
	derived: { doubled: e.mul(e.self("qty"), 2) },
});
const ERoot = entity("root", {
	inputs: { rows: t.list(ERow) },
	derived: { total: e.sum(e.each("rows", "doubled")) },
});
const rows = kit({
	name: "rows",
	version: "1.0.0",
	functions: { ...std },
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

describe("thence/react", () => {
	it("re-renders a value when it changes", () => {
		const session = rows.program({}).run();
		const total = session.root.member("total");
		let renders = 0;
		const Total = () => {
			renders++;
			const r = useValue(total);
			return r.ok ? String(r.value) : r.error.code;
		};
		const container = render(createElement(Total));
		expect(container.textContent).toBe("0");

		const row = acted(() => session.root.list("rows").add());
		expect(container.textContent).toBe("2");
		act(() => {
			row.member("qty").set(1); // the same value: no re-render
		});
		const before = renders;
		act(() => {
			row.member("qty").set(5);
		});
		expect(container.textContent).toBe("10");
		expect(renders).toBe(before + 1);
	});

	it("re-renders rows when they are added or removed, not when a value in them changes", () => {
		const session = rows.program({}).run();
		const list = session.root.list("rows");
		let renders = 0;
		const Rows = () => {
			renders++;
			return useEntries(list)
				.map(([id]) => id)
				.join(",");
		};
		const container = render(createElement(Rows));
		expect(container.textContent).toBe("");
		const a = acted(() => list.add());
		const b = acted(() => list.add());
		expect(container.textContent).toBe(`${a.id},${b.id}`);
		const before = renders;
		act(() => {
			a.member("qty").set(3);
		});
		expect(renders).toBe(before);
		act(() => list.remove(a.id));
		expect(container.textContent).toBe(b.id);
	});
});
