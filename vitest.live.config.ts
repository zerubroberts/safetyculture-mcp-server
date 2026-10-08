import { defineConfig } from "vitest/config";

// Live tests hit a real Mitti org. They are read-only unless SC_LIVE_WRITE_TESTS=true,
// and they never print record contents: only counts and response shapes.
export default defineConfig({
  test: { include: ["test/live/**/*.test.ts"], environment: "node", testTimeout: 120_000 },
});
