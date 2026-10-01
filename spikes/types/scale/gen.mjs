// Generates a large kit and program to measure type-check cost.
import { writeFileSync } from "node:fs";

const T = 15,
	E = 60;
let s = `import { kit, entity, trait, impl, t, e, std } from "thence";\nconst Money = t.decimal("Money", { scale: 2 });\n`;
for (let i = 0; i < T; i++)
	s += `const T${i} = trait("t${i}", { total: Money, flag: t.bool });\n`;
s += `const content = () => t.map(t.oneOf(${Array.from({ length: T }, (_, i) => `T${i}`).join(", ")}));\n`;
for (let i = 0; i < E; i++) {
	const ins = Array.from(
		{ length: 8 },
		(_, j) => `i${j}: Money.initial("0.00")`,
	).join(", ");
	const der = [
		`d0: e.add(e.self("i0"), 1)`,
		...Array.from(
			{ length: 5 },
			(_, j) => `d${j + 1}: e.mul(e.self("d${j}"), 2)`,
		),
	].join(", ");
	const tr = [i % T, (i + 1) % T];
	s += `const E${i} = entity("e${i}", { config: { label: t.text, f: t.expr(Money).optional(), kids: content, rows: t.list(T${tr[0]}) }, inputs: { ${ins}${i > 0 ? `, list: t.list(E${i - 1})` : ""} },\n  derived: { ${der} },\n  impls: [${tr.map((k) => `impl(T${k}, { total: e.self("d5"), flag: e.gt(e.self("i0"), 0) })`).join(", ")}] });\n`;
}
s += `export const big = kit({ name: "big", version: "1.0.0", functions: { ...std }, root: E0, entities: [${Array.from({ length: E }, (_, i) => `E${i}`).join(", ")}] });\n`;
// a nested program: 5 levels, 4 children each = 1364 nodes
let n = 0;
const node = (depth) => {
	const i = (n++ * 7) % E;
	const kids =
		depth === 0
			? "{}"
			: `{ ${Array.from({ length: 4 }, (_, k) => `k${k}: ${node(depth - 1)}`).join(", ")} }`;
	return `{ type: "e${i}", config: { label: "x", f: ["add", ["ref", "a"], 1], kids: ${kids}, rows: [] } }`;
};
s += `export const program = big.program({ config: { label: "root", rows: [], kids: { top: ${node(4)} } } });\n`;
s += `const r = program.run().root;\nr.member("d5").set("1.00");\nconst deep = program.run().at(["kids", "top", "kids", "k0", "kids", "k1"]);\nvoid deep;\n`;
writeFileSync(new URL("big.ts", import.meta.url), s);
console.log("nodes", n, "bytes", s.length);
