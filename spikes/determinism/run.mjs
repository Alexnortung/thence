// Runs the harness in Node and in every browser Playwright can launch here, then compares digests.
// Usage: node run.mjs [--out results.json]

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { build } from "esbuild";

mkdirSync("dist", { recursive: true });
await build({
	entryPoints: ["src/browser-entry.ts"],
	bundle: true,
	format: "iife",
	outfile: "dist/harness.js",
	logLevel: "warning",
});
const bundle = readFileSync("dist/harness.js", "utf8");

const results = {};
new Function(bundle)(); // Node: the same bundle the browsers get
const t0 = performance.now();
results[globalThis.thenceHarness.engine()] =
	globalThis.thenceHarness.runHarness();
console.log(`node: ${Math.round(performance.now() - t0)} ms`);

const { chromium, firefox, webkit } = await import("playwright");
for (const [name, type] of [
	["chromium", chromium],
	["firefox", firefox],
	["webkit", webkit],
]) {
	let browser;
	try {
		browser = await type.launch(
			name === "chromium" && process.env.CHROMIUM_PATH
				? { executablePath: process.env.CHROMIUM_PATH }
				: {},
		);
	} catch (err) {
		console.log(
			`${name}: not available here (${String(err.message).split("\n")[0]})`,
		);
		continue;
	}
	const page = await browser.newPage();
	await page.addScriptTag({ content: bundle });
	const t = Date.now();
	const [ua, report] = await page.evaluate(() => [
		globalThis.thenceHarness.engine(),
		globalThis.thenceHarness.runHarness(),
	]);
	console.log(`${name}: ${Date.now() - t} ms`);
	results[`${name}: ${ua}`] = report;
	await browser.close();
}

// compare every engine with the first
const engines = Object.keys(results);
const names = Object.keys(results[engines[0]]);
const rows = names.map((fn) => {
	const digests = engines.map((e) => results[e][fn].digest);
	const same = digests.every((d) => d === digests[0]);
	return { fn, same, digests };
});
console.log(
	`\n${engines.length} engines:\n${engines.map((e, i) => `  [${i}] ${e}`).join("\n")}\n`,
);
for (const r of rows)
	console.log(
		`${r.same ? "same   " : "DIFFERS"}  ${r.fn.padEnd(24)} ${r.digests.join("  ")}`,
	);
const outArg = process.argv.indexOf("--out");
if (outArg > 0)
	writeFileSync(
		process.argv[outArg + 1],
		JSON.stringify({ engines, results }, null, 2),
	);
const ours = rows.filter((r) => r.fn.startsWith("thence.") && !r.same);
if (ours.length) {
	console.error(
		`\nthence functions differ between engines: ${ours.map((r) => r.fn).join(", ")}`,
	);
	process.exit(1);
}
