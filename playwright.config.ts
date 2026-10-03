import { defineConfig } from "@playwright/test";

// Loads every demo in examples/ in a browser; see examples/demos.e2e.ts.
export default defineConfig({
	testDir: "examples",
	testMatch: "*.e2e.ts",
	reporter: "list",
	use: {
		browserName: "chromium",
		// A browser that is already installed, when Playwright's own isn't.
		...(process.env.CHROMIUM_PATH
			? { launchOptions: { executablePath: process.env.CHROMIUM_PATH } }
			: {}),
	},
});
