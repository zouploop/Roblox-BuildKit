// Capture: OS-level screenshot of the Roblox Studio window via PowerShell.
// We can't screenshot from inside a Studio plugin, but the plugin steers the
// viewport camera, so grabbing the actual window gives us exactly that view.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const pexec = promisify(execFile);

// viewport (optional): plugin-reported [width,height] of Studio's 3D render area.
// When supplied, capture.ps1 crops the screenshot to that region so the surrounding
// Studio chrome (Explorer/Output docks, ribbon) is excluded.
export async function captureWindow(scriptPath: string, viewport?: [number, number]): Promise<string> {
  const out = path.join(os.tmpdir(), `rbxcap_${process.pid}_${Date.now()}.png`);
  try {
    const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-Out", out];
    if (viewport && viewport[0] > 0 && viewport[1] > 0) {
      args.push("-VpW", String(Math.round(viewport[0])), "-VpH", String(Math.round(viewport[1])));
    }
    const { stderr } = await pexec("powershell.exe", args, { timeout: 20_000, windowsHide: true });
    if (stderr && stderr.trim()) console.error("[buildkit] capture stderr:", stderr.trim());
    const buf = await readFile(out);
    return buf.toString("base64");
  } finally {
    unlink(out).catch(() => {});
  }
}
