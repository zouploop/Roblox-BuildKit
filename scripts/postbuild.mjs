// Post-build step: prepend the node shebang to dist/index.js so the `bin` entry works
// when installed globally / run as a script. It lives in the built artifact (not the
// source) because a shebang in src breaks vitest's esbuild transform when tests import
// the module.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");
const src = await readFile(out, "utf8");
if (!src.startsWith("#!")) {
  await writeFile(out, "#!/usr/bin/env node\n" + src);
  console.error("[postbuild] added shebang to dist/index.js");
}
