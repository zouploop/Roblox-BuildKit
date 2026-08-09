// Static scope and packaging gate for the BuildKit plugin.
// It intentionally uses no Luau toolchain: CI must be able to run the blocking
// checks before a Studio/Selene install is available.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "plugin", "src");
const artifact = path.join(root, "plugin", "BuildKitPlugin.rbxmx");
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

function importedAliases(masked, knownModules, file) {
	const aliases = new Map();
	const requires = [];
	const canonicalRequires = new Set();
	const pattern = /local\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*require\(\s*script\.Parent\.([A-Za-z_][A-Za-z0-9_]*)\s*\)(?:\.([A-Za-z_][A-Za-z0-9_]*))?/g;
	for (const match of masked.matchAll(pattern)) {
		const [, alias, target, field] = match;
		canonicalRequires.add(match.index + match[0].indexOf("require"));
		aliases.set(alias, { target, field });
		requires.push({ target, field, alias });
		if (!knownModules.has(target)) throw new Error(`G3 require target '${target}' not in tree`);
	}
	for (const match of masked.matchAll(/\brequire\s*\(/g)) {
		if (!canonicalRequires.has(match.index)) {
			throw new Error(`noncanonical require in ${file}: expected local Alias = require(script.Parent.Module)`);
		}
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

// This is a conservative token scan, not a lexical-scope proof. Nested locals and
// parameters stay in the declaration inventory; Selene's undefined_variable report
// is the load-bearing lexical-resolution evidence.
function staticUnknowns(records) {
	const errors = [];
	for (const record of records) {
		const known = new Set([...GLOBALS, ...record.all, ...record.imports.keys()]);
		for (const [lineNo, line] of record.masked.split("\n").entries()) {
			for (const token of tokens(line)) {
				if (KEYWORDS.has(token.name) || known.has(token.name)) continue;
				const prev = previousNonSpace(line, token.index);
				if ((prev === "." || prev === ":") && !(prev === "." && line[token.index - 2] === ".")) continue;
				if (nextNonSpace(line, token.index + token.name.length) === "=") continue;
				errors.push(`${record.file}:${lineNo + 1} static scan unknown '${token.name}'`);
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

function accessedFields(source, alias) {
	const fields = [];
	const pattern = new RegExp(`\\b${alias}\\.([A-Za-z_][A-Za-z0-9_]*)`, "g");
	for (const match of source.matchAll(pattern)) {
		fields.push({ name: match[1], write: /^\s*=/.test(source.slice(match.index + match[0].length)) });
	}
	return fields;
}

function exportedFields(record, moduleName) {
	const fields = new Set();
	const footerStart = record.source.indexOf("--#region exports");
	const footer = footerStart >= 0 ? record.source.slice(footerStart) : "";
	const table = new RegExp(`\\b${moduleName}\\.([A-Za-z_][A-Za-z0-9_]*)\\s*=`, "g");
	for (const match of record.source.matchAll(table)) fields.add(match[1]);
	for (const match of footer.matchAll(/\breturn\s*\{([\s\S]*?)\}/g)) {
		for (const field of match[1].matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*=/g)) fields.add(field[1]);
	}
	return fields;
}

function requireCycleCount(records, byName) {
	const visiting = new Set();
	const visited = new Set();
	let cycles = 0;
	function visit(name) {
		if (visiting.has(name)) {
			cycles += 1;
			return;
		}
		if (visited.has(name)) return;
		visiting.add(name);
		const record = records.find((item) => byName.get(name) === item.file);
		for (const requirement of record?.requires ?? []) visit(requirement.target);
		visiting.delete(name);
		visited.add(name);
	}
	for (const name of byName.keys()) visit(name);
	return cycles;
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
		const info = importedAliases(record.masked, actual, record.file);
		record.imports = info.aliases;
		record.requires = info.requires;
	}
	for (const record of records) {
		for (const requirement of record.requires) {
			if (!requirement.field && requirement.alias !== requirement.target) {
				errors.push(`G3 whole-module import in ${record.file}: alias '${requirement.alias}' targets '${requirement.target}'; expected '${requirement.alias}'`);
				continue;
			}
			const provider = records.find((item) => byName.get(requirement.target) === item.file);
			if (!provider) continue;
			const fields = exportedFields(provider, requirement.target);
			const requiredFields = requirement.field ? [{ name: requirement.field, write: false }] : accessedFields(record.masked, requirement.alias);
			for (const access of requiredFields) {
				// Whole-module writes are intentional late-bound table fields; target identity above
				// validates their provider while reads must already exist in its export footer.
				if (access.write) continue;
				if (!fields.has(access.name)) errors.push(`G3 missing export: ${record.file} requires ${requirement.target}.${access.name}`);
			}
		}
	}
	return requireCycleCount(records, byName);
}

const records = moduleRecords();
const errors = [];
let cycles = 0;
try {
	cycles = checkArtifact(records, errors);
} catch (error) {
	errors.push(`G3 ${error.message}`);
}

const graph = crossGraph(records);
const declarationsCount = new Set(records.flatMap((record) => [...record.top])).size;
const staticScanErrors = staticUnknowns(records);
if (staticScanErrors.length) {
	errors.push(`G2 conservative static scan unknowns: ${staticScanErrors.length}`);
	errors.push(...staticScanErrors);
}
if (cycles !== 0) errors.push(`G3 require graph cycles=${cycles}`);

checkHandlers(records, errors);
checkBridgeToken(records, errors);

if (errors.length) {
	for (const error of errors) console.error(error);
	process.exit(1);
}

console.log(`[check-plugin] declarations=${declarationsCount} cross-module symbols=${graph.symbols.size} edges=${graph.edges.length} cycles=${cycles}`);
