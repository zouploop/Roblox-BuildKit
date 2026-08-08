// One-time Stage-1 splitter: slice plugin/BuildKitPlugin.luau into ordered
// plugin/src/*.luau files at the section boundaries below, then PROVE that
// concatenating them reproduces the original byte-for-byte. Run with:
//   node scripts/split-plugin.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, "..");
const srcPath = path.join(root, "plugin", "BuildKitPlugin.luau");
const outDir = path.join(root, "plugin", "src");

// [name, startLine, endLine] — 1-indexed INCLUSIVE. These partition the file exactly.
const SECTIONS = [
  ["00-header.luau", 1, 157], // services, constants, RUNTIME_SOURCE, recorded()
  ["10-geometry.luau", 158, 318], // findInst/camera/bbox/getBBox/partsOf/pivotWorld/describe/makeBox
  ["20-detail.luau", 319, 396], // makeCyl/makeBall/pulls/knobs/legs + getOrMakeModel
  ["30-parametric.luau", 397, 452], // regenBuildKit/BUILDERS/PARAMETRIC_KINDS + tag/watch/scan
  ["40-quality.luau", 453, 578], // DEFAULT_SIZE/PRESETS/prepSpec/weather/sitSeat/plinth/csg/applyQuality
  ["50-fx-parts.luau", 579, 722], // PART_SHAPES/FX presets/attachFx/makePart
  ["60-prop-regen.luau", 723, 800], // PROP_REGEN_SOURCE embedded runtime script
  ["70-prop-presets.luau", 801, 1615], // PROP_PRESETS library + buildProp docs
  ["80-builders.luau", 1616, 2499], // buildProp + walls/rooms/stairs/slab + cabinet/table/shelf/bed/carcass/house set + regen tail
  ["90-gui.luau", 2500, 2903], // GUI builder
  ["100-handlers.luau", 2904, 5057], // command handlers (camera/edit/qa/assets/undo/cutaway/isolate/contrast/runtime/batch/sync/build/gui/lighting)
  ["110-poll.luau", 5058, 5177], // long-poll loop + config seed
  ["120-toolbar.luau", 5178, 5201], // toolbar toggle
  ["130-settings.luau", 5202, 5309], // settings dock widget
  ["140-mesh-cutter.luau", 5310, 5500], // Mesh Cutter (EditableMesh) + trailing newline
];

const original = readFileSync(srcPath, "utf8");
// Split keeping each line's trailing \n (a plain split("\n") loses the separator after
// blank lines, so slicing + rejoining wouldn't be byte-exact). Every line ends with \n
// (the file ends with one), so this captures the file exactly.
const lines = original.match(/[^\n]*\n/g) || [];
const lineCount = lines.length;

// Validate the partition covers every line exactly once, in order.
let cursor = 1;
for (const [name, start, end] of SECTIONS) {
  if (start !== cursor) throw new Error(`${name}: expected to start at ${cursor}, got ${start}`);
  cursor = end + 1;
}
if (cursor !== lineCount + 1) throw new Error(`partition ends at ${cursor - 1}, file has ${lineCount} lines`);

mkdirSync(outDir, { recursive: true });
for (const [name, start, end] of SECTIONS) {
  const slice = lines.slice(start - 1, end).join("");
  writeFileSync(path.join(outDir, name), slice, "utf8");
}

// Prove byte-equality of the concatenation.
const rebuilt = SECTIONS.map(([name]) => readFileSync(path.join(outDir, name), "utf8")).join("");
if (rebuilt === original) {
  console.error(`[split-plugin] OK: ${SECTIONS.length} files written, concatenation is byte-identical to the original`);
} else {
  // Locate the first difference for debugging.
  let i = 0;
  while (i < rebuilt.length && i < original.length && rebuilt[i] === original[i]) i++;
  console.error(`[split-plugin] FAIL: rebuilt differs at byte ${i}`);
  console.error(`  rebuilt: ${JSON.stringify(rebuilt.slice(Math.max(0, i - 40), i + 40))}`);
  console.error(`  original: ${JSON.stringify(original.slice(Math.max(0, i - 40), i + 40))}`);
  process.exit(1);
}
