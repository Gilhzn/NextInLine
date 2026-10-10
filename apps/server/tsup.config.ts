import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/migrateCli.ts"],
  format: ["esm"],
  target: "node22",
  clean: true,
  sourcemap: true,
  // The shared workspace package ships TypeScript sources, so it is bundled rather than imported at runtime.
  noExternal: ["@magiali/shared"],
});
