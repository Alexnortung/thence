// The smallest demo: two inputs and their sum. Each demo in examples/ is a
// Vite + React app like this one, built and loaded in a browser by CI.

import { e, entity, kit, t } from "thence";
import { useValue, useWritable } from "thence/react";

const ESum = entity("sum", {
	inputs: { a: t.number.initial(1), b: t.number.initial(2) },
	derived: { total: e.add(e.self("a"), e.self("b")) },
});
const sums = kit({
	name: "sums",
	version: "1",
	root: ESum,
	entities: [ESum],
});
const session = sums.program({}).run();

export function App() {
	const [a, setA] = useWritable(session, ["a"]);
	const [b, setB] = useWritable(session, ["b"]);
	const total = useValue(session, ["total"]);
	return (
		<main>
			<h1>thence</h1>
			<input
				aria-label="a"
				type="number"
				value={a.ok ? a.value : ""}
				onChange={(event) => setA(event.target.valueAsNumber)}
			/>
			{" + "}
			<input
				aria-label="b"
				type="number"
				value={b.ok ? b.value : ""}
				onChange={(event) => setB(event.target.valueAsNumber)}
			/>
			{" = "}
			<output aria-label="total">
				{total.ok ? total.value : total.error.message}
			</output>
		</main>
	);
}
