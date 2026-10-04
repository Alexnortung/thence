// Runs the determinism harness in Node and in every browser Playwright can
// launch, then compares digests. Fails when a thence function gives different
// bits in two engines. Usage: pnpm determinism [--out results.json]

import { readFileSync, writeFileSync } from "node:fs";
import { type BrowserType, chromium, firefox, webkit } from "playwright";
import { build } from "tsdown";
import type { Report } from "./harness";

/** What entry.ts puts on the global object. */
interface Harness {
	engine(): string;
	runHarness(): Report;
}
const harness = () =>
	(globalThis as unknown as { thenceHarness: Harness }).thenceHarness;

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

const results: Record<string, Report> = {};
new Function(bundle)(); // Node runs the same bundle the browsers get
results[harness().engine()] = harness().runHarness();

const browsers: [string, BrowserType][] = [
	["chromium", chromium],
	["firefox", firefox],
	["webkit", webkit],
];
for (const [name, type] of browsers) {
	// CHROMIUM_PATH: a Chromium that isn't Playwright's own build, such as a preinstalled one
	const path = name === "chromium" ? process.env.CHROMIUM_PATH : undefined;
	const browser = await type
		.launch(path ? { executablePath: path } : {})
		.catch((err: Error) => {
			console.log(
				`${name}: not available here (${err.message.split("\n")[0]})`,
			);
			return undefined;
		});
	if (!browser) continue;
	const page = await browser.newPage();
	await page.addScriptTag({ content: bundle });
	const [ua, report] = await page.evaluate(() => {
		const h = (globalThis as unknown as { thenceHarness: Harness })
			.thenceHarness;
		return [h.engine(), h.runHarness()] as const;
	});
	results[`${name}: ${ua}`] = report;
	await browser.close();
}

const engines = Object.keys(results);
const first = results[engines[0] as string] as Report;
console.log(
	`${engines.length} engines:\n${engines.map((e, i) => `  [${i}] ${e}`).join("\n")}\n`,
);
const differ: string[] = [];
for (const fn of Object.keys(first)) {
	const digests = engines.map((e) => results[e]?.[fn]?.digest);
	const same = digests.every((d) => d === digests[0]);
	if (!same && fn.startsWith("thence.")) differ.push(fn);
	console.log(
		`${same ? "same   " : "DIFFERS"}  ${fn.padEnd(16)} ${digests.join("  ")}`,
	);
}
const out = process.argv.indexOf("--out");
const file = out > 0 ? process.argv[out + 1] : undefined;
if (file) writeFileSync(file, JSON.stringify({ engines, results }, null, 2));
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
