// Runs the determinism harness in Node and in every browser Playwright can
// launch, then compares digests. Fails when a thence function gives different
// bits in two engines. Usage: node determinism/run.mjs [--out results.json]

import { readFileSync, writeFileSync } from "node:fs";
import { build } from "tsdown";

const outDir = new URL("./dist/", import.meta.url).pathname;
await build({
	entry: [new URL("./entry.ts", import.meta.url).pathname],
	format: "iife",
	platform: "browser",
	outDir,
	dts: false,
	config: false,
	logLevel: "warn",
});
const bundle = readFileSync(`${outDir}entry.iife.js`, "utf8");

const results = {};
new Function(bundle)(); // Node runs the same bundle the browsers get
results[globalThis.thenceHarness.engine()] =
	globalThis.thenceHarness.runHarness();

const { chromium, firefox, webkit } = await import("playwright");
for (const [name, type] of [
	["chromium", chromium],
	["firefox", firefox],
	["webkit", webkit],
]) {
	let browser;
	try {
		// CHROMIUM_PATH: a Chromium that isn't Playwright's own build, such as a preinstalled one
		const path = name === "chromium" ? process.env.CHROMIUM_PATH : undefined;
		browser = await type.launch(path ? { executablePath: path } : {});
	} catch (err) {
		console.log(
			`${name}: not available here (${String(err.message).split("\n")[0]})`,
		);
		continue;
	}
	const page = await browser.newPage();
	await page.addScriptTag({ content: bundle });
	const [ua, report] = await page.evaluate(() => [
		globalThis.thenceHarness.engine(),
		globalThis.thenceHarness.runHarness(),
	]);
	results[`${name}: ${ua}`] = report;
	await browser.close();
}

const engines = Object.keys(results);
const names = Object.keys(results[engines[0]]);
console.log(
	`${engines.length} engines:\n${engines.map((e, i) => `  [${i}] ${e}`).join("\n")}\n`,
);
const differ = [];
for (const fn of names) {
	const digests = engines.map((e) => results[e][fn].digest);
	const same = digests.every((d) => d === digests[0]);
	if (!same && fn.startsWith("thence.")) differ.push(fn);
	console.log(
		`${same ? "same   " : "DIFFERS"}  ${fn.padEnd(16)} ${digests.join("  ")}`,
	);
}
const out = process.argv.indexOf("--out");
if (out > 0)
	writeFileSync(
		process.argv[out + 1],
		JSON.stringify({ engines, results }, null, 2),
	);
if (engines.length < 2) {
	console.error("\nonly one engine ran, so nothing was compared");
	process.exit(1);
}
if (differ.length > 0) {
	console.error(
		`\nthence functions differ between engines: ${differ.join(", ")}`,
	);
	process.exit(1);
}
