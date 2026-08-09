// Config file round-trip. This file holds the Open Cloud key, so a silent regression in
// load/save is a security-adjacent data-loss bug — worth pinning even though the I/O is
// trivial. Tests set BUILDKIT_CONFIG_DIR to a temp dir, never ~/.buildkit.
import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let dir: string;

// Load the module fresh with BUILDKIT_CONFIG_DIR set, so CONFIG_DIR/CONFIG_PATH are
// computed against the temp dir. resetModules clears vitest's ESM cache between cases.
async function loadConfigModule() {
  vi.resetModules();
  return await import("../src/config.js");
}

afterEach(async () => {
  delete process.env.BUILDKIT_CONFIG_DIR;
  if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
});

describe("config", () => {
  it("returns {} when no config file exists yet", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "buildkit-config-"));
    process.env.BUILDKIT_CONFIG_DIR = dir;
    const mod = await loadConfigModule();
    expect(await mod.loadConfig()).toEqual({});
  });

  it("round-trips a saved config", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "buildkit-config-"));
    process.env.BUILDKIT_CONFIG_DIR = dir;
    const mod = await loadConfigModule();
    await mod.saveConfig({ openCloudKey: "abc", creatorId: "123" });
    expect(await mod.loadConfig()).toEqual({ openCloudKey: "abc", creatorId: "123" });
  });

  it("falls back to {} on corrupt JSON instead of throwing", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "buildkit-config-"));
    process.env.BUILDKIT_CONFIG_DIR = dir;
    const mod = await loadConfigModule();
    await writeFile(mod.CONFIG_PATH, "{ not valid json", "utf8");
    expect(await mod.loadConfig()).toEqual({});
  });

  it("falls back to {} when the file holds a non-object", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "buildkit-config-"));
    process.env.BUILDKIT_CONFIG_DIR = dir;
    const mod = await loadConfigModule();
    await writeFile(mod.CONFIG_PATH, '"just a string"', "utf8");
    expect(await mod.loadConfig()).toEqual({});
  });

  it("writes into the configured directory and sets 0600 on POSIX", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "buildkit-config-"));
    process.env.BUILDKIT_CONFIG_DIR = dir;
    const mod = await loadConfigModule();
    await mod.saveConfig({ openCloudKey: "x" });
    const txt = await readFile(mod.CONFIG_PATH, "utf8");
    expect(JSON.parse(txt)).toEqual({ openCloudKey: "x" });
    if (process.platform !== "win32") {
      const st = await stat(mod.CONFIG_PATH);
      expect(st.mode & 0o777).toBe(0o600);
    }
  });
});
