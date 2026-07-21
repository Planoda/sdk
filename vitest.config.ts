import { defineConfig } from "vitest/config";

/**
 * SDK-scoped vitest config. The root config only covers `tests/unit` +
 * `tests/integration`; this picks up `src/**\/*.test.ts` inside the SDK
 * package so `pnpm --filter @planoda/sdk test` (or a direct `vitest run` from
 * this directory) runs the SDK suite in isolation.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    maxWorkers: 2,
    isolate: true,
  },
});
