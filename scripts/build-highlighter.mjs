import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";

// Keep the complete language registry available without a runtime npm dependency.
await mkdir(new URL("../src/vendor/", import.meta.url), { recursive: true });
await build({
  stdin: {
    contents: 'export { default } from "highlight.js";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  minify: true,
  legalComments: "eof",
  outfile: "src/vendor/highlight.js",
});
await copyFile(
  "node_modules/highlight.js/LICENSE",
  "src/vendor/highlight.LICENSE",
);
