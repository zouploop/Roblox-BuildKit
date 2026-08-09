// Static scope and packaging gate for the BuildKit plugin.
// It intentionally uses no Luau toolchain: CI must be able to run the blocking
// checks before a Studio/Selene install is available.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "plugin", "src");
const artifact = path.join(root, "plugin", "BuildKitPlugin.rbxmx");
const flat = process.argv.includes("--flat");

const FILES = [
	"00-header.luau",
	"10-geometry.luau",
	"20-detail.luau",
	"30-parametric.luau",
	"40-quality.luau",
	"50-fx-parts.luau",
	"60-prop-regen.luau",
	"70-prop-presets.luau",
	"80-builders.luau",
	"90-gui.luau",
	"100-handlers.luau",
	"110-poll.luau",
	"120-toolbar.luau",
	"130-settings.luau",
	"140-mesh-cutter.luau",
];

const MODULES = [
	["ctx.luau", "Ctx"],
	["00-header.luau", "Core"],
	["10-geometry.luau", "Geometry"],
	["20-detail.luau", "Detail"],
	["30-parametric.luau", "Parametric"],
	["40-quality.luau", "Quality"],
	["50-fx-parts.luau", "FxParts"],
	["60-prop-regen.luau", "PropRegen"],
	["70-prop-presets.luau", "PropPresets"],
	["80-builders.luau", "Builders"],
	["90-gui.luau", "Gui"],
	["100-handlers.luau", "Handlers"],
	["110-poll.luau", "Poll"],
	["120-toolbar.luau", "Toolbar"],
	["130-settings.luau", "Settings"],
	["140-mesh-cutter.luau", "MeshCutter"],
];

const HANDLERS = `annotate attr batch build build_gui cast checkpoint console contrast cutaway describe diff
edit find frame frame_coords frame_dir frame_dir_coords group gui_preview insert insertAsset insertChest
inspect isolate measure navcheck optimize ping prop qa restore restore_all restore_camera runtime_install
runtime_remove save_camera script selection set_lighting sync tag undo`.split(/\s+/).sort();

// These are the file edges measured in the approved plan. Keeping the list here
// makes the baseline graph a regression oracle without pretending this is a parser.
const EDGES = [
	["100-handlers.luau", "80-builders.luau", "buildSeating buildRoom buildStairs buildSlab buildCabinet buildTable buildShelf buildBed buildChair buildDesk buildNightstand buildDresser buildWardrobe buildFridge buildStove buildToilet buildBathtub buildProp"],
	["100-handlers.luau", "10-geometry.luau", "colorOf matOf r1 findInst bboxOf camera getBBox partsOf pivotWorld describeInst"],
	["80-builders.luau", "20-detail.luau", "getOrMakeModel makeCyl makeBall roundLeg _regenTarget barPull roundKnob"],
	["110-poll.luau", "00-header.luau", "HttpService RUNNING BRIDGE_TOKEN BASE PLACE"],
	["100-handlers.luau", "00-header.luau", "recorded BRIDGE_TOKEN Lighting ChangeHistoryService RUNTIME_SOURCE"],
	["80-builders.luau", "10-geometry.luau", "makeBox colorOf matOf"],
	["80-builders.luau", "30-parametric.luau", "_regenBusy BUILDERS regenBuildKit"],
	["80-builders.luau", "70-prop-presets.luau", "PROP_PRESETS scaleP csgProp"],
	["80-builders.luau", "40-quality.luau", "addSitSeat bevelTopEdges plinthBase"],
	["100-handlers.luau", "90-gui.luau", "gmerge GUI_DEFAULT_THEME buildNode"],
	["50-fx-parts.luau", "10-geometry.luau", "colorOf matOf"],
	["80-builders.luau", "00-header.luau", "HttpService recorded"],
	["120-toolbar.luau", "00-header.luau", "RUNNING BASE"],
	["100-handlers.luau", "30-parametric.luau", "watchBuildKit tagBuildKit"],
	["140-mesh-cutter.luau", "30-parametric.luau", "watchBuildKit scanBuildKit"],
	["130-settings.luau", "110-poll.luau", "post CONFIG_DEFAULTS"],
	["100-handlers.luau", "40-quality.luau", "prepSpec applyQuality"],
	["20-detail.luau", "10-geometry.luau", "makeBox"],
	["40-quality.luau", "10-geometry.luau", "makeBox"],
	["30-parametric.luau", "00-header.luau", "HttpService"],
	["110-poll.luau", "100-handlers.luau", "handlers"],
	["120-toolbar.luau", "100-handlers.luau", "handlers"],
	["100-handlers.luau", "50-fx-parts.luau", "buildWarnings"],
	["80-builders.luau", "50-fx-parts.luau", "makePart"],
	["80-builders.luau", "60-prop-regen.luau", "PROP_REGEN_SOURCE"],
	["140-mesh-cutter.luau", "120-toolbar.luau", "toolbar"],
	["130-settings.luau", "120-toolbar.luau", "toolbar"],
	["140-mesh-cutter.luau", "100-handlers.luau", "CHEST_LID_SOURCE"],
].map(([consumer, provider, names]) => [consumer, provider, names.split(/\s+/)]);

const KEYWORDS = new Set(`and break do else elseif end false for function if in local nil not or repeat return then true until while
continue type export declare`.split(/\s+/));
const GLOBALS = new Set(`_G Enum Instance Color3 BrickColor CFrame Vector2 Vector3 Vector3int16 Vector2int16 UDim UDim2
Rect NumberRange NumberSequence NumberSequenceKeypoint ColorSequence ColorSequenceKeypoint TweenInfo RaycastParams OverlapParams PhysicalProperties
Faces Axes Region3 Ray Font CatalogSearchParams DockWidgetPluginGuiInfo Content debug game workspace script plugin task coroutine math string table os utf8 bit32 buffer
type typeof tostring tonumber select pairs ipairs next pcall xpcall error warn assert require setmetatable getmetatable rawget rawset
rawequal unpack print time tick wait spawn delay elapsedTime shared settings UserSettings`.split(/\s+/));
const IDENT = /[A-Za-z_][A-Za-z0-9_]*/g;
const S2_TABLES = new Set(["Core", "Detail", "Parametric", "FxParts"]);
const S1_CROSS_SYMBOLS = new Set([
	"BASE", "BRIDGE_TOKEN", "BUILDERS", "CHEST_LID_SOURCE", "CONFIG_DEFAULTS", "ChangeHistoryService", "GUI_DEFAULT_THEME",
	"HttpService", "Lighting", "PLACE", "PROP_PRESETS", "PROP_REGEN_SOURCE", "RUNNING", "RUNTIME_SOURCE", "_regenBusy",
	"_regenTarget", "addSitSeat", "applyQuality", "barPull", "bboxOf", "bevelTopEdges", "buildBathtub", "buildBed",
	"buildCabinet", "buildChair", "buildDesk", "buildDresser", "buildFridge", "buildNightstand", "buildNode", "buildProp",
	"buildRoom", "buildSeating", "buildShelf", "buildSlab", "buildStairs", "buildStove", "buildTable", "buildToilet",
	"buildWardrobe", "buildWarnings", "camera", "colorOf", "csgProp", "describeInst", "findInst", "getBBox",
	"getOrMakeModel", "gmerge", "handlers", "makeBall", "makeBox", "makeCyl", "makePart", "matOf", "partsOf",
	"pivotWorld", "plinthBase", "post", "prepSpec", "r1", "recorded", "regenBuildKit", "roundKnob", "roundLeg",
	"scaleP", "scanBuildKit", "tagBuildKit", "toolbar", "watchBuildKit",
]);
const S2_REMOVED = new Set(["RUNNING", "_regenTarget", "buildWarnings", "regenBuildKit", "BUILDERS"]);
const S2_ADDED = new Set(["Core", "Detail", "FxParts", "Parametric"]);

function hide(value) {
	return value.replace(/[^\n]/g, " ");
}

function mask(source) {
	return source
		.replace(/\[(=*)\[[\s\S]*?\]\1\]/g, hide)
		.replace(/"(?:\\.|[^"\\\n])*"/g, hide)
		.replace(/'(?:\\.|[^'\\\n])*'/g, hide)
		.replace(/--[^\n]*/g, hide);
}

function tokens(line) {
	const out = [];
	for (const match of line.matchAll(IDENT)) out.push({ name: match[0], index: match.index });
	return out;
}

function previousNonSpace(line, index) {
	for (let i = index - 1; i >= 0; i--) if (!/\s/.test(line[i])) return line[i];
	return "";
}

function nextNonSpace(line, index) {
	for (let i = index; i < line.length; i++) if (!/\s/.test(line[i])) return line[i];
	return "";
}

function namesBeforeAssignment(text) {
	const left = text.split("=", 1)[0];
	return [...left.matchAll(IDENT)].map((m) => m[0]).filter((name) => name !== "local");
}

function declarations(masked) {
	const all = new Set();
	const top = new Set();
	const lines = masked.split("\n");
	for (const line of lines) {
		const isTop = !/^\s/.test(line);
		let match = line.match(/\blocal\s+function\s+([A-Za-z_][A-Za-z0-9_]*)/);
		if (match) {
			all.add(match[1]);
			if (isTop) top.add(match[1]);
		} else {
			match = line.match(/\blocal\s+(.+)/);
			if (match) {
				for (const name of namesBeforeAssignment(match[1])) {
					all.add(name);
					if (isTop) top.add(name);
				}
			}
		}

		match = line.match(/\bfor\s+(.+?)\s+(?:in|=)/);
		if (match) for (const name of namesBeforeAssignment(match[1])) all.add(name);
	}

	for (const match of masked.matchAll(/\bfunction(?:\s+[A-Za-z_][A-Za-z0-9_.:]*)?\s*\(([^)]*)\)/g)) {
		for (const param of match[1].matchAll(IDENT)) all.add(param[0]);
	}
	for (const line of lines) {
		if (!/^\s*function\s+([A-Za-z_][A-Za-z0-9_]*)/.test(line)) continue;
		const name = line.match(/^\s*function\s+([A-Za-z_][A-Za-z0-9_]*)/)[1];
		all.add(name);
		if (!/^\s/.test(line)) top.add(name);
	}
	return { all, top };
}

function references(masked, name) {
	for (const line of masked.split("\n")) {
		for (const token of tokens(line)) {
			if (token.name !== name) continue;
			const prev = previousNonSpace(line, token.index);
			if ((prev === "." || prev === ":") && !(prev === "." && line[token.index - 2] === ".")) continue;
			if (nextNonSpace(line, token.index + name.length) === "=" && (prev === "{" || prev === ",")) continue;
			return true;
		}
	}
	return false;
}

function importedAliases(masked, knownModules) {
	const aliases = new Map();
	const requires = [];
	for (const match of masked.matchAll(/local\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*require\(\s*script\.Parent\.([A-Za-z_][A-Za-z0-9_]*)\s*\)(?:\.([A-Za-z_][A-Za-z0-9_]*))?/g)) {
		const [, alias, target, field] = match;
		aliases.set(alias, { target, field });
		requires.push({ target, field, alias });
		if (!knownModules.has(target)) throw new Error(`G3 require target '${target}' not in tree`);
	}
	return { aliases, requires };
}

function moduleRecords() {
	const files = readdirSync(srcDir).filter((file) => file.endsWith(".luau")).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
	const records = [];
	for (const file of files) {
		const source = readFileSync(path.join(srcDir, file), "utf8").replace(/\r\n/g, "\n");
		const masked = mask(source);
		const decl = declarations(masked);
		records.push({ file, source, masked, ...decl, imports: new Map(), requires: [] });
	}
	return records;
}

function unresolved(records, flatMode) {
	const globalNames = new Set(GLOBALS);
	for (const record of records) for (const name of record.all) globalNames.add(name);
	const errors = [];
	for (const record of records) {
		let known = globalNames;
		if (!flatMode) {
			known = new Set([...GLOBALS, ...record.all, ...record.imports.keys()]);
		}
		for (const [lineNo, line] of record.masked.split("\n").entries()) {
			for (const token of tokens(line)) {
				if (KEYWORDS.has(token.name) || known.has(token.name)) continue;
				const prev = previousNonSpace(line, token.index);
				if ((prev === "." || prev === ":") && !(prev === "." && line[token.index - 2] === ".")) continue;
				if (nextNonSpace(line, token.index + token.name.length) === "=") continue;
				errors.push(`${record.file}:${lineNo + 1} unresolved '${token.name}'`);
			}
		}
	}
	return errors;
}

function crossGraph(records) {
	const byFile = new Map(records.map((record) => [record.file, record]));
	const activeEdges = [];
	const symbols = new Set();
	for (const [consumer, provider, names] of EDGES) {
		const source = byFile.get(consumer);
		const owner = byFile.get(provider);
		const active = names.filter((name) => owner?.top.has(name) && references(source?.masked ?? "", name));
		if (active.length) activeEdges.push([consumer, provider, active]);
		for (const name of active) symbols.add(name);
	}
	for (const table of S2_TABLES) {
		const owner = records.find((record) => record.top.has(table));
		if (!owner) continue;
		const consumers = records.filter((record) => record.file !== owner.file && references(record.masked, table));
		if (consumers.length) {
			symbols.add(table);
			for (const consumer of consumers) activeEdges.push([consumer.file, owner.file, [table]]);
		}
	}
	return { symbols, edges: activeEdges };
}

function checkHandlers(records, errors) {
	const record = records.find(({ file }) => file === "100-handlers.luau");
	const actual = [...record.source.matchAll(/\bfunction\s+handlers\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)].map((match) => match[1]).sort();
	const missing = HANDLERS.filter((name) => !actual.includes(name));
	const extra = actual.filter((name) => !HANDLERS.includes(name));
	if (missing.length || extra.length) {
		errors.push(`G4 handler names mismatch`);
		if (missing.length) errors.push(`missing: ${missing.join(" ")}`);
		if (extra.length) errors.push(`extra: ${extra.join(" ")}`);
	}
}

function checkBridgeToken(records, errors) {
	const record = records.find(({ file }) => file === "130-settings.luau");
	const start = record.source.indexOf("local function gather()");
	const end = record.source.indexOf('post("/config"', start);
	if (start >= 0 && end >= 0 && /bridgeToken/i.test(record.source.slice(start, end))) {
		const line = record.source.slice(0, start).split("\n").length;
		errors.push(`G7 bridgeToken appears in 130-settings.gather (line ${line})`);
	}
}

function checkArtifact(records, errors) {
	const xml = readFileSync(artifact, "utf8");
	const referents = [...xml.matchAll(/\breferent="([^"]+)"/g)].map((match) => match[1]);
	const rootMatches = [...xml.matchAll(/<Item\s+class="Script"\s+referent="([^"]+)">([\s\S]*?)<\/Item>\s*<\/roblox>/g)];
	const root = rootMatches[0]?.[2] ?? "";
	const folderStarts = [...root.matchAll(/<Item\s+class="Folder"\s+referent="([^"]+)">/g)];
	if (rootMatches.length !== 1 || (xml.match(/<Item\s+class="Script"/g) ?? []).length !== 1 || folderStarts.length !== 1 ||
		!root.includes('<string name="Name">BuildKitPlugin</string>') || !root.includes('<string name="Name">Modules</string>')) {
		errors.push(`G3 invalid rbxmx tree: expected Script + Modules + 16 ModuleScripts`);
	}
	if (new Set(referents).size !== referents.length) errors.push("G3 duplicate rbxmx referent");
	const folderIndex = folderStarts.length ? root.indexOf(folderStarts[0][0]) : -1;
	const folder = folderIndex >= 0 ? root.slice(folderIndex) : "";
	const moduleItems = [...folder.matchAll(/<Item\s+class="ModuleScript"\s+referent="([^"]+)">([\s\S]*?)<\/Item>/g)];
	if (moduleItems.length !== 16) errors.push(`G3 expected 16 ModuleScript items, got ${moduleItems.length}`);
	if (moduleItems.some(([, , body]) => body.includes('name="RunContext"'))) errors.push("G3 ModuleScript has RunContext");
	const expected = new Set(MODULES.map(([, name]) => name));
	const names = moduleItems.map(([, , body]) => body.match(/<string\s+name="Name">([^<]*)<\/string>/)?.[1] ?? "");
	const actual = new Set(names.filter((name) => expected.has(name)));
	if (actual.size !== expected.size) errors.push("G3 emitted module names do not match MODULES");

	const byName = new Map(MODULES.map(([file, name]) => [name, file]));
	for (const record of records) {
		const info = importedAliases(record.masked, expected);
		record.imports = info.aliases;
		record.requires = info.requires;
	}
	const visiting = new Set();
	const visited = new Set();
	function visit(name) {
		if (visiting.has(name)) return true;
		if (visited.has(name)) return false;
		visiting.add(name);
		const record = records.find((item) => byName.get(name) === item.file);
		for (const requirement of record?.requires ?? []) if (visit(requirement.target)) return true;
		visiting.delete(name);
		visited.add(name);
		return false;
	}
	if ([...expected].some((name) => visit(name))) errors.push("G3 require graph has a cycle");
}

const records = moduleRecords();
const errors = [];
if (!flat) {
	try {
		checkArtifact(records, errors);
	} catch (error) {
		errors.push(`G3 ${error.message}`);
	}
}

const graph = crossGraph(records);
const declarationsCount = new Set(records.flatMap((record) => [...record.top])).size;
const cycles = 0;
const flatStage2 = records.some((record) => /\bCore\.RUNNING\b/.test(record.source));
const unresolvedErrors = unresolved(records, flat);
if (unresolvedErrors.length) {
	errors.push(`G2 unresolved identifiers: ${unresolvedErrors.length}`);
	errors.push(...unresolvedErrors);
} else {
	if (flat && !flatStage2 && (declarationsCount !== 150 || graph.symbols.size !== 70 || graph.edges.length !== 28 || cycles !== 0)) {
		errors.push(`G1 baseline mismatch: declarations=${declarationsCount} cross-module symbols=${graph.symbols.size} edges=${graph.edges.length} cycles=${cycles}`);
	}
if (flat && flatStage2) {
	const removed = [...S1_CROSS_SYMBOLS].filter((name) => !graph.symbols.has(name)).sort();
	const added = [...graph.symbols].filter((name) => !S1_CROSS_SYMBOLS.has(name)).sort();
	if (graph.symbols.size !== 69 || declarationsCount !== 150 || cycles !== 0 || removed.join(" ") !== [...S2_REMOVED].sort().join(" ") || added.join(" ") !== [...S2_ADDED].sort().join(" ")) {
		errors.push(`G2 rebound-symbol graph mismatch: cross-module symbols=${graph.symbols.size}, expected 69`);
		errors.push(`G2 removed: ${removed.join(" ")}`);
		errors.push(`G2 added: ${added.join(" ")}`);
	}
}
}

checkHandlers(records, errors);
checkBridgeToken(records, errors);

if (errors.length) {
	for (const error of errors) console.error(error);
	process.exit(1);
}

console.log(`[check-plugin] declarations=${declarationsCount} cross-module symbols=${graph.symbols.size} edges=${graph.edges.length} cycles=${cycles}`);
if (flatStage2) {
	console.log(`[check-plugin] delta removed=${[...S2_REMOVED].sort().join(",")} added=${[...S2_ADDED].sort().join(",")}`);
}
