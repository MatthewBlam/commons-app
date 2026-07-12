import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    environmentMatchGlobs: [["src/renderer/**/*.test.tsx", "jsdom"]],
  },
  resolve: {
    alias: {
      "@renderer": resolve("src/renderer/src"),
    },
  },
});
