// Disk path -> DataModel path mapping. This is the highest-consequence pure function in
// the server: a wrong answer here doesn't throw, it silently writes a script to the wrong
// place in the user's game.
//
// The first block ports the cases that used to live as an inline self-check at the bottom
// of src/sync.ts (runnable only via `node dist/sync.js`, so never run by anything). The
// rest are new edge cases that self-check didn't cover.
import { describe, it, expect } from "vitest";
import { mapFile, classOf } from "../src/sync.js";

const R = "C:/MockProject";

describe("classOf", () => {
  it("maps each luau suffix to its script class and strips it from the base", () => {
    expect(classOf("Foo.luau")).toEqual({ className: "ModuleScript", base: "Foo" });
    expect(classOf("Foo.server.luau")).toEqual({ className: "Script", base: "Foo" });
    expect(classOf("Foo.client.luau")).toEqual({ className: "LocalScript", base: "Foo" });
  });

  it("accepts .lua alongside .luau", () => {
    expect(classOf("Foo.lua")).toEqual({ className: "ModuleScript", base: "Foo" });
    expect(classOf("Foo.server.lua")).toEqual({ className: "Script", base: "Foo" });
  });

  it("is case-insensitive on the suffix", () => {
    expect(classOf("Foo.SERVER.LUAU")).toEqual({ className: "Script", base: "Foo" });
  });

  it("returns null for non-luau files", () => {
    expect(classOf("notes.txt")).toBeNull();
    expect(classOf("Foo")).toBeNull();
  });

  it("checks .server/.client BEFORE the bare .luau rule", () => {
    // Rule order matters: /\.luau?$/ also matches "Foo.server.luau". If it were tested
    // first every server Script would silently become a ModuleScript named "Foo.server".
    expect(classOf("Foo.server.luau").className).toBe("Script");
    expect(classOf("Foo.server.luau").base).toBe("Foo");
  });
});

describe("mapFile — cases ported from the src/sync.ts self-check", () => {
  it("maps a plain module", () => {
    expect(mapFile(`${R}/ServerScriptService/Foo.luau`)).toEqual({
      dmPath: ["ServerScriptService", "Foo"],
      className: "ModuleScript",
    });
  });

  it("maps a server script", () => {
    expect(mapFile(`${R}/ServerScriptService/Foo.server.luau`)).toEqual({
      dmPath: ["ServerScriptService", "Foo"],
      className: "Script",
    });
  });

  it("expands StarterPlayerScripts to StarterPlayer/StarterPlayerScripts", () => {
    expect(mapFile(`${R}/StarterPlayerScripts/Hud.client.luau`)).toEqual({
      dmPath: ["StarterPlayer", "StarterPlayerScripts", "Hud"],
      className: "LocalScript",
    });
  });

  it("makes init.luau become its parent folder", () => {
    expect(mapFile(`${R}/ReplicatedStorage/Part_Icles/init.luau`)).toEqual({
      dmPath: ["ReplicatedStorage", "Part_Icles"],
      className: "ModuleScript",
    });
  });

  it("keeps nested folders", () => {
    expect(mapFile(`${R}/ReplicatedStorage/A/B/C.luau`)).toEqual({
      dmPath: ["ReplicatedStorage", "A", "B", "C"],
      className: "ModuleScript",
    });
  });

  it("handles Windows backslash paths", () => {
    expect(mapFile("C:\\MockProject\\ServerStorage\\Bar.server.luau")).toEqual({
      dmPath: ["ServerStorage", "Bar"],
      className: "Script",
    });
  });

  it("returns null with no service-named ancestor", () => {
    expect(mapFile("C:/random/place/Foo.luau")).toBeNull();
  });

  it("returns null for a non-luau file", () => {
    expect(mapFile(`${R}/ServerScriptService/notes.txt`)).toBeNull();
  });
});

describe("mapFile — edge cases", () => {
  it("matches service folder names case-insensitively", () => {
    expect(mapFile(`${R}/replicatedstorage/Foo.luau`)).toEqual({
      dmPath: ["ReplicatedStorage", "Foo"],
      className: "ModuleScript",
    });
  });

  it("uses the FIRST service-named ancestor, not the last", () => {
    // A folder legitimately named after another service nested inside one (a common Rojo
    // shape: ReplicatedStorage/Lighting/Foo.luau) must stay under the outer service.
    expect(mapFile(`${R}/ReplicatedStorage/Lighting/Foo.luau`)).toEqual({
      dmPath: ["ReplicatedStorage", "Lighting", "Foo"],
      className: "ModuleScript",
    });
  });

  it("expands StarterCharacterScripts too", () => {
    expect(mapFile(`${R}/StarterCharacterScripts/Move.client.luau`)).toEqual({
      dmPath: ["StarterPlayer", "StarterCharacterScripts", "Move"],
      className: "LocalScript",
    });
  });

  it("returns null for init.luau sitting directly in a service folder", () => {
    // There is no parent folder to name, so there is nothing to become.
    expect(mapFile(`${R}/ServerScriptService/init.luau`)).toBeNull();
  });

  it("treats init.server.luau as a Script named after the parent folder", () => {
    expect(mapFile(`${R}/ServerScriptService/Runner/init.server.luau`)).toEqual({
      dmPath: ["ServerScriptService", "Runner"],
      className: "Script",
    });
  });

  it("matches init case-insensitively", () => {
    expect(mapFile(`${R}/ReplicatedStorage/Pkg/Init.luau`)).toEqual({
      dmPath: ["ReplicatedStorage", "Pkg"],
      className: "ModuleScript",
    });
  });

  it("returns null when the service folder holds no file", () => {
    expect(mapFile(`${R}/ServerScriptService`)).toBeNull();
  });

  it("tolerates duplicated or trailing separators", () => {
    expect(mapFile(`${R}//ServerScriptService///Foo.luau`)).toEqual({
      dmPath: ["ServerScriptService", "Foo"],
      className: "ModuleScript",
    });
  });

  it("does not treat a service NAME SUBSTRING as a service folder", () => {
    // "MyWorkspaceStuff" contains "Workspace" but is not it; matching is whole-segment.
    expect(mapFile("C:/MyWorkspaceStuff/Foo.luau")).toBeNull();
  });
});
