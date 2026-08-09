import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) throw new Error("usage: node scripts/strip-regions.mjs <module>");

let source = readFileSync(file, "utf8");
// The directive is generated header metadata for the 14 modules that gained it in
// Stage 3. Core already carried it in the Stage-2 body, and Ctx is a new baseline.
if (!/(?:00-header|ctx)\.luau$/i.test(file)) source = source.replace(/^--!nocheck\r?\n/, "");
source = source.replace(/^--#region imports[^\r\n]*(?:\r?\n|$)[\s\S]*?^--#endregion[^\r\n]*(?:\r?\n|$)(?:\r?\n|$)/m, "");
source = source.replace(/^--#region exports[^\r\n]*(?:\r?\n|$)[\s\S]*$/m, "");
process.stdout.write(source);
