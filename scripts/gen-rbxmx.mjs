// Build plugin/BuildKitPlugin.luau from the ordered plugin/src/*.luau modules, then wrap
// it into a Studio-loadable .rbxmx (Script model with the source in a CDATA block).
// Studio's loose Plugins folder loads .rbxm/.rbxmx, not .luau, so this keeps the
// packaged plugin in sync with the source.
import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, "..");
const srcDir = path.resolve(root, "plugin", "src");
const out = path.resolve(root, "plugin", "BuildKitPlugin.rbxmx");
const luauOut = path.resolve(root, "plugin", "BuildKitPlugin.luau");

// Concatenate the source modules in order. Filenames are numeric-prefixed
// (00-, 10-, ..., 100-, 110-), so sort by that number — a plain string sort would
// place "100-handlers" before "20-detail".
const moduleFiles = readdirSync(srcDir)
  .filter((f) => f.endsWith(".luau"))
  .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

// Normalize to LF before embedding. The .rbxmx is a tracked artifact, so it must be a
// deterministic function of the source alone — otherwise a Windows checkout (CRLF) and a
// Linux one (LF) generate byte-different files from identical source, and CI's
// "is the committed artifact stale?" check fails for whichever platform didn't build it.
// Studio reads either, so LF is a free choice.
const luau = moduleFiles
  .map((f) => readFileSync(path.join(srcDir, f), "utf8"))
  .join("")
  .replace(/\r\n/g, "\n");
if (luau.includes("]]>")) {
  throw new Error("source contains ']]>' which breaks the CDATA wrapper");
}

// BuildKitPlugin.luau is a GENERATED artifact (source of truth is plugin/src/). Rewrite
// it so it can't drift from the modules it's built from — git diff will show the change.
writeFileSync(luauOut, luau, "utf8");

const xml = `<roblox version="4">
	<Item class="Script" referent="RBX0">
		<Properties>
			<string name="Name">BuildKitPlugin</string>
			<token name="RunContext">0</token>
			<ProtectedString name="Source"><![CDATA[${luau}]]></ProtectedString>
		</Properties>
	</Item>
</roblox>
`;

writeFileSync(out, xml, "utf8");
console.error(`[gen-rbxmx] wrote ${out} (${luau.length} chars of source)`);

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
