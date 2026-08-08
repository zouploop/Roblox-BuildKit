// Local config file. A Studio plugin can't write disk files, so the MCP server owns
// the durable store: the plugin's Settings panel pushes values over the bridge (POST
// /config) and we persist them here, on the user's own device. Replaces the old
// hardcoded-in-source creds — the Open Cloud key now lives ONLY in this user-local file
// (gitignored, never in the plugin source/.rbxmx).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const CONFIG_DIR = path.join(os.homedir(), ".buildkit");
export const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

export async function loadConfig(): Promise<Record<string, unknown>> {
  try {
    const txt = await readFile(CONFIG_PATH, "utf8");
    const obj = JSON.parse(txt);
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {}; // missing/corrupt → start empty, first /config save (re)creates it
  }
}

export async function saveConfig(cfg: Record<string, unknown>): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
}
