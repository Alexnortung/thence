import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/index.ts", "src/react/index.ts"],
	format: ["esm", "cjs"],
	tsconfig: "tsconfig.build.json",
	clean: true,
});
