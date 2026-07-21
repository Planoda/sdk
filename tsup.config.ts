import { defineConfig } from "tsup";

/**
 * Dual ESM + CJS build with per-entry `.d.ts`, matching the `exports` map in
 * package.json (`dist/{index,webhooks}.{mjs,cjs,d.ts}`).
 *
 * `outExtension` is pinned explicitly so the emitted filenames are always
 * `.mjs`/`.cjs` regardless of the package's `type` field — the `exports` map
 * references those exact names.
 */
export default defineConfig({
  entry: {
    index: "src/index.ts",
    webhooks: "src/webhooks.ts",
  },
  format: ["esm", "cjs"],
  // Declarations are emitted separately by `tsc --emitDeclarationOnly` (see the
  // `build` script). tsup's bundled-dts step chokes on the source tsconfig's
  // `composite: true` (TS6307), so we keep dts out of tsup entirely.
  dts: false,
  clean: true,
  sourcemap: true,
  target: "node20",
  // Zero runtime deps — nothing to bundle in; keeps output minimal.
  treeshake: true,
  outExtension({ format }) {
    return { js: format === "esm" ? ".mjs" : ".cjs" };
  },
});
