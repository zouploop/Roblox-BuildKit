// Build the nested Studio model from the explicit plugin/src module table.
// Studio's loose Plugins folder loads .rbxm/.rbxmx, not loose source files.
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, "..");
const srcDir = path.resolve(root, "plugin", "src");
const out = path.resolve(root, "plugin", "BuildKitPlugin.rbxmx");

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

const entrySource = `--!nocheck
-- BuildKit's entry Script wires the shared context before loading modules.
local Modules = script.Modules
require(Modules.Ctx).plugin = plugin
require(Modules.Core)
require(Modules.Geometry)
require(Modules.Detail)
require(Modules.Parametric)
require(Modules.Quality)
require(Modules.FxParts)
require(Modules.PropRegen)
require(Modules.PropPresets)
require(Modules.Builders)
require(Modules.Gui)
require(Modules.Handlers)
require(Modules.Poll)
require(Modules.Toolbar)
require(Modules.Settings)
require(Modules.MeshCutter)
`;

function cdata(source, label) {
	const normalized = source.replace(/\r\n/g, "\n");
	if (normalized.includes("]]>") ) throw new Error(`${label} contains ']]>' which breaks the CDATA wrapper`);
	return `<![CDATA[${normalized}]]>`;
}

const sources = MODULES.map(([file, name]) => {
	const source = readFileSync(path.join(srcDir, file), "utf8");
	return { file, name, source: source.replace(/\r\n/g, "\n") };
});
const moduleItems = sources.map(({ name, source }, index) => `
			<Item class="ModuleScript" referent="RBX${index + 2}">
				<Properties>
					<string name="Name">${name}</string>
					<ProtectedString name="Source">${cdata(source, name)}</ProtectedString>
				</Properties>
			</Item>`).join("");
const xml = `<roblox version="4">
	<Item class="Script" referent="RBX0">
		<Properties>
			<string name="Name">BuildKitPlugin</string>
			<token name="RunContext">0</token>
			<ProtectedString name="Source">${cdata(entrySource, "entry Script")}</ProtectedString>
		</Properties>
		<Item class="Folder" referent="RBX1">
			<Properties>
				<string name="Name">Modules</string>
			</Properties>${moduleItems}
		</Item>
	</Item>
</roblox>
`;

writeFileSync(out, xml, "utf8");
console.error(`[gen-rbxmx] wrote ${out} (${sources.length} ModuleScripts)`);

// Also install into Studio's loose Plugins folder so `npm run build` can't leave a
// stale copy loaded in Studio. Skip silently if the folder doesn't exist.
const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
const pluginsDir = path.join(localAppData, "Roblox", "Plugins");
if (existsSync(pluginsDir)) {
	const installed = path.join(pluginsDir, "BuildKitPlugin.rbxmx");
	copyFileSync(out, installed);
	console.error(`[gen-rbxmx] installed -> ${installed} (restart Studio to load)`);
} else {
	console.error(`[gen-rbxmx] Plugins folder not found (${pluginsDir}); skipped install`);
}
