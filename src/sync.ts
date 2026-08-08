// Disk -> DataModel path mapping for rbx_sync.
// The project uses Rojo-style service-named top folders (no
// default.project.json), so we derive the target purely from the first
// path segment that names a Roblox service, plus Rojo file conventions:
//   foo.luau         -> ModuleScript "foo"
//   foo.server.luau  -> Script "foo"
//   foo.client.luau  -> LocalScript "foo"
//   init.luau (etc.) -> the PARENT folder becomes that script.
// .lua is accepted alongside .luau.
import path from "node:path";
import { fileURLToPath } from "node:url";

// lowercased service name -> canonical name
const SERVICES: Record<string, string> = {};
for (const s of [
  "Workspace", "ServerScriptService", "ServerStorage", "ReplicatedStorage",
  "ReplicatedFirst", "StarterGui", "StarterPack", "StarterPlayer",
  "StarterPlayerScripts", "StarterCharacterScripts", "Lighting",
  "SoundService", "Players", "Chat", "Teams", "MaterialService", "TestService",
]) {
  SERVICES[s.toLowerCase()] = s;
}

// On-disk service folders that Rojo nests one level deeper in the DataModel.
function expandService(service: string): string[] {
  if (service === "StarterPlayerScripts") return ["StarterPlayer", "StarterPlayerScripts"];
  if (service === "StarterCharacterScripts") return ["StarterPlayer", "StarterCharacterScripts"];
  return [service];
}

// Match a luau suffix; return the script class + the basename with the suffix stripped.
export function classOf(file: string): { className: string; base: string } | null {
  const rules: [RegExp, string][] = [
    [/\.server\.luau?$/i, "Script"],
    [/\.client\.luau?$/i, "LocalScript"],
    [/\.luau?$/i, "ModuleScript"],
  ];
  for (const [re, cls] of rules) {
    if (re.test(file)) return { className: cls, base: file.replace(re, "") };
  }
  return null; // not a luau file
}

export type Mapping = { dmPath: string[]; className: string };

// Map an absolute disk path to a DataModel path + script class, or null if the
// path has no service-named ancestor / isn't a luau file.
export function mapFile(absPath: string): Mapping | null {
  const segs = absPath.split(/[\\/]+/).filter(Boolean);
  let si = -1;
  for (let i = 0; i < segs.length; i++) {
    if (SERVICES[segs[i].toLowerCase()]) { si = i; break; }
  }
  if (si < 0) return null;
  const service = SERVICES[segs[si].toLowerCase()];
  const tail = segs.slice(si + 1);
  if (tail.length === 0) return null;

  const file = tail[tail.length - 1];
  const cls = classOf(file);
  if (!cls) return null;
  const containers = tail.slice(0, -1);

  if (cls.base.toLowerCase() === "init") {
    // init.* makes its PARENT folder the script. Needs a parent folder to name.
    if (containers.length === 0) return null;
    return { dmPath: expandService(service).concat(containers), className: cls.className };
  }
  return { dmPath: expandService(service).concat(containers, [cls.base]), className: cls.className };
}

// ---- self-check (node dist/sync.js) ----------------------------------------
function isMain(): boolean {
  return !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}
if (isMain()) {
  const eq = (got: Mapping | null, want: Mapping | null, label: string) => {
    const a = JSON.stringify(got), b = JSON.stringify(want);
    if (a !== b) throw new Error(`FAIL ${label}\n  got  ${a}\n  want ${b}`);
  };
  const R = "C:/MockProject";
  eq(mapFile(`${R}/ServerScriptService/Foo.luau`), { dmPath: ["ServerScriptService", "Foo"], className: "ModuleScript" }, "plain module");
  eq(mapFile(`${R}/ServerScriptService/Foo.server.luau`), { dmPath: ["ServerScriptService", "Foo"], className: "Script" }, "server script");
  eq(mapFile(`${R}/StarterPlayerScripts/Hud.client.luau`), { dmPath: ["StarterPlayer", "StarterPlayerScripts", "Hud"], className: "LocalScript" }, "client + StarterPlayer expand");
  eq(mapFile(`${R}/ReplicatedStorage/Part_Icles/init.luau`), { dmPath: ["ReplicatedStorage", "Part_Icles"], className: "ModuleScript" }, "init -> parent");
  eq(mapFile(`${R}/ReplicatedStorage/A/B/C.luau`), { dmPath: ["ReplicatedStorage", "A", "B", "C"], className: "ModuleScript" }, "nested folders");
  eq(mapFile("C:\\MockProject\\ServerStorage\\Bar.server.luau"), { dmPath: ["ServerStorage", "Bar"], className: "Script" }, "backslash path");
  eq(mapFile("C:/random/place/Foo.luau"), null, "no service -> null");
  eq(mapFile(`${R}/ServerScriptService/notes.txt`), null, "non-luau -> null");
  console.log("sync.ts self-check OK (8 cases)");
}
