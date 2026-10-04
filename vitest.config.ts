import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const src = new URL("./src/", import.meta.url).pathname;

export default defineConfig({
	test: {
		projects: [
			{
				extends: true,
				test: {
					name: "unit",
					include: ["src/**/*.{spec,test}.ts"],
					// Type tests (*.test-d.ts) are checked by tsc, never run.
					typecheck: { enabled: true, include: ["src/**/*.test-d.ts"] },
				},
			},
			{
				// Each demo's tests, in headless Chromium, against thence's source.
				plugins: [react()],
				resolve: {
					alias: {
						"thence/react": `${src}react/index.ts`,
						thence: `${src}index.ts`,
					},
				},
				test: {
					name: "demos",
					include: ["examples/*/src/**/*.test.tsx"],
					browser: {
						enabled: true,
						headless: true,
						provider: playwright(
							// A Chromium that isn't Playwright's own build, such as a preinstalled one.
							process.env.CHROMIUM_PATH
								? {
										launchOptions: {
											executablePath: process.env.CHROMIUM_PATH,
										},
									}
								: {},
						),
						instances: [{ browser: "chromium" }],
					},
				},
			},
		],
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			exclude: [
				"src/**/*.{spec,test}.ts",
				"src/**/*.test-d.ts",
				"src/**/__fixtures__/**",
				"src/**/__tests__/**",
				"src/**/*.d.ts",
			],
			reporter: ["text", "html", "lcovonly"],
			reportsDirectory: "./coverage",
			reportOnFailure: true,
			// Opt in with test:coverage; CI always collects coverage.
			// Reports: coverage/index.html and coverage/lcov.info (directory is cleaned).
			// No thresholds by default. Optional native policy (80 is only an example):
			// thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
		},
	},
});
