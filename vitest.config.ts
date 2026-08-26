import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["server/**/*.test.mjs", "src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["server/**/*.mjs", "src/**/*.{ts,tsx}"],
    },
  },
});
