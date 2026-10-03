// The smallest demo: two inputs and their sum. Each demo in examples/ is a
// Vite + React app like this one, built and loaded in a browser by CI.

import { e, entity, kit, std, t } from "thence";
import { useValue } from "thence/react";

const ESum = entity("sum", {
	inputs: { a: t.number.initial(1), b: t.number.initial(2) },
	derived: { total: e.add(e.self("a"), e.self("b")) },
});
const sums = kit({
	name: "sums",
	version: "1",
	root: ESum,
	entities: [ESum],
	functions: { ...std },
});
const session = sums.program({}).run();

export function App() {
	const { root } = session;
	const a = useValue(root.member("a"));
	const b = useValue(root.member("b"));
	const total = useValue(root.member("total"));
	return (
		<main>
			<h1>thence</h1>
			<input
				aria-label="a"
				type="number"
				value={a.ok ? a.value : ""}
				onChange={(event) => root.member("a").set(event.target.valueAsNumber)}
			/>
			{" + "}
			<input
				aria-label="b"
				type="number"
				value={b.ok ? b.value : ""}
				onChange={(event) => root.member("b").set(event.target.valueAsNumber)}
			/>
			{" = "}
			<output aria-label="total">
				{total.ok ? total.value : total.error.message}
			</output>
		</main>
	);
}
