import { defineConfig } from "tsup";

// Self-contained bundle for the Claude Desktop extension: every dependency inlined.
export default defineConfig({
  entry: { index: "src/index.ts" },
  outDir: "mcpb/build/server",
  format: ["esm"],
  target: "node22",
  platform: "node",
  noExternal: [/.*/],
  clean: true,
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
});
