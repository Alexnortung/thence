import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// Type tests (*.test-d.ts) are checked by tsc, never run.
		typecheck: { enabled: true, include: ["src/**/*.test-d.ts"] },
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
