// Every demo in examples/<name>/ must load: build them first
// (`pnpm build && pnpm --filter "./examples/*" build`), then
// `pnpm test:demos`. A demo that throws or logs an error fails.

import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join } from "node:path";
import { expect, test } from "@playwright/test";

const here = import.meta.dirname;
const demos = readdirSync(here, { withFileTypes: true })
	.filter(
		(d) => d.isDirectory() && existsSync(join(here, d.name, "package.json")),
	)
	.map((d) => d.name);

const types: Record<string, string> = {
	".html": "text/html",
	".js": "text/javascript",
	".css": "text/css",
	".svg": "image/svg+xml",
};

for (const demo of demos) {
	test(`${demo} loads without errors`, async ({ page }) => {
		const dist = join(here, demo, "dist");
		// The built demo, as a static site; any path that isn't a file is the app.
		const server = createServer(async (req, res) => {
			const path = new URL(req.url ?? "/", "http://x").pathname;
			const file = join(dist, path === "/" ? "index.html" : path);
			const found =
				file.startsWith(dist) && existsSync(file)
					? file
					: join(dist, "index.html");
			res.setHeader(
				"content-type",
				types[extname(found)] ?? "application/octet-stream",
			);
			res.end(await readFile(found));
		});
		await new Promise<void>((done) => server.listen(0, done));
		try {
			const errors: string[] = [];
			page.on("pageerror", (e) => errors.push(e.message));
			page.on("console", (m) => {
				if (m.type() === "error") errors.push(m.text());
			});
			await page.goto(
				`http://localhost:${(server.address() as AddressInfo).port}/`,
			);
			await expect(page.locator("#root")).not.toBeEmpty();
			expect(errors).toEqual([]);
		} finally {
			server.close();
		}
	});
}
