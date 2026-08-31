import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const entry = path.join(root, "dist", "index.js");
const args = ["mcp", "add", "--scope", "user", "roblox-buildkit", "--", "node", entry];
const command = `claude mcp add --scope user roblox-buildkit -- node '${entry.replaceAll("'", "''")}'`;

if (!existsSync(entry)) {
  console.error("dist/index.js is missing. Run `npm run build` first.");
  process.exit(1);
}

if (process.argv.includes("--print")) {
  console.log(command);
  process.exit(0);
}

const current = spawnSync("claude", ["mcp", "get", "roblox-buildkit"], { encoding: "utf8" });
if (current.error?.code === "ENOENT") {
  console.log("Claude Code was not found on PATH. Run this after installing it:");
  console.log(command);
  process.exit(0);
}
const normalizedEntry = entry.replaceAll("\\", "/").toLowerCase();
const currentText = `${current.stdout ?? ""}\n${current.stderr ?? ""}`;
if (current.status === 0 && currentText.replaceAll("\\", "/").toLowerCase().includes(normalizedEntry)) {
  console.log(`roblox-buildkit is already registered at ${entry}`);
  process.exit(0);
}
if (current.status === 0 && /Scope:\s*User config/i.test(currentText)) {
  const removed = spawnSync("claude", ["mcp", "remove", "roblox-buildkit", "--scope", "user"], { stdio: "inherit" });
  if (removed.status !== 0) process.exit(removed.status ?? 1);
}

const result = spawnSync("claude", args, { stdio: "inherit" });
process.exit(result.status ?? 1);
