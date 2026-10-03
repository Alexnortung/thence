/**
 * The names an expression calls, at any depth: `["add", ["mul", …], 1]`
 * calls `add` and `mul`. A path or a text literal calls nothing.
 */
export function callsIn(expr: unknown, into = new Set<string>()): Set<string> {
	if (Array.isArray(expr)) {
		const [head, ...args] = expr as unknown[];
		if (head === "ref" || head === "text") return into;
		if (typeof head === "string") into.add(head);
		for (const arg of typeof head === "string" ? args : expr) {
			callsIn(arg, into);
		}
	} else if (typeof expr === "object" && expr !== null) {
		for (const v of Object.values(expr)) callsIn(v, into);
	}
	return into;
}

/**
 * A function that calls itself, directly or through others, as the chain
 * of calls from it back to itself: `["a", "b", "a"]`. `undefined` when
 * nothing recurses.
 *
 * @param calls - for each function, the functions its body calls; names that aren't keys are ignored
 */
export function recursion(
	calls: ReadonlyMap<string, ReadonlySet<string>>,
): string[] | undefined {
	const done = new Set<string>();
	const visit = (name: string, chain: string[]): string[] | undefined => {
		const at = chain.indexOf(name);
		if (at >= 0) return [...chain.slice(at), name];
		if (done.has(name)) return undefined;
		for (const next of calls.get(name) ?? []) {
			if (!calls.has(next)) continue;
			const found = visit(next, [...chain, name]);
			if (found) return found;
		}
		done.add(name);
		return undefined;
	};
	for (const name of calls.keys()) {
		const found = visit(name, []);
		if (found) return found;
	}
	return undefined;
}
