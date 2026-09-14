// scripts/postbuild.ts — GitHub Pages SPA fallback (README §4 / DESIGN.md
// §13 "部署平台"). Runs after `vite build` via npm's build/postbuild
// lifecycle hook (see package.json's "postbuild" script).
//
// GitHub Pages serves static files with no server-side rewrite: a deep link
// like /nihongo-kiso/grammar/wa gets a literal 404 from GitHub's edge, never
// reaching react-router. The standard workaround (spa-github-pages) is to
// let GitHub serve dist/404.html for any unmatched path, and since it's a
// byte-for-byte copy of index.html, react-router boots normally and reads
// the real path itself. This only works because the app has no server-side
// route data to fetch for a 404 that index.html wouldn't already have.
//
// dist/.nojekyll stops GitHub Pages from running the Jekyll build step,
// which otherwise ignores any file/directory starting with "_" -- Vite's
// default asset directory is dist/assets (fine), but this guards against
// future asset paths that do start with "_".
//
// Runs directly with Node's native TypeScript support, same as
// build-bank.ts / generate-daily.ts -- see that file's header comment for
// why relative imports need an explicit ".ts" extension (n/a here, no
// relative imports) and why there's no ts-node/tsx in this repo.

import { copyFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DIST_DIR = "dist";

async function main(): Promise<void> {
  const indexPath = join(DIST_DIR, "index.html");
  const notFoundPath = join(DIST_DIR, "404.html");
  const nojekyllPath = join(DIST_DIR, ".nojekyll");

  await copyFile(indexPath, notFoundPath);
  await writeFile(nojekyllPath, "");

  console.log(`[postbuild] wrote ${notFoundPath} and ${nojekyllPath}`);
}

main().catch((err) => {
  console.error("[postbuild] failed:", err);
  process.exit(1);
});
