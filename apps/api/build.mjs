import { build } from "esbuild";

// Bundles the API and workspace packages into one ESM file; npm dependencies stay external.
await build({
  entryPoints: ["src/server.ts", "src/db/cli.ts"],
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  packages: "external",
  alias: { "@betterplate/contracts": "../../packages/contracts/src/index.ts", "@betterplate/nutrition": "../../packages/nutrition/src/index.ts" },
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
console.info("built apps/api/dist");
