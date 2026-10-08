import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"], exclude: ["test/live/**"], environment: "node", testTimeout: 20_000 }, // CI runners can be several times slower than a laptop
});
