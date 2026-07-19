import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.{ts,tsx}", "test/**/*.spec.{ts,tsx}"],
    environmentMatchGlobs: [["test/**/*.spec.tsx", "jsdom"]],
    setupFiles: ["./test/setup.ts"],
  },
});
