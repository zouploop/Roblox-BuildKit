// Disk -> DataModel path mapping for rbx_sync.
// The target is derived from the first path segment that names a Roblox
// service, plus file-name conventions:
//   foo.luau         -> ModuleScript "foo"
//   foo.server.luau  -> Script "foo"
//   foo.client.luau  -> LocalScript "foo"
//   init.luau (etc.) -> the PARENT folder becomes that script.
// .lua is accepted alongside .luau.
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

// Service folders that nest one level deeper in the DataModel.
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

// The self-check that used to live here (runnable only as `node dist/sync.js`, so nothing
// ever ran it) now lives in tests/sync.test.ts, where `npm test` and CI cover it.
