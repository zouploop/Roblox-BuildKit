// capture.ts builds the PowerShell invocation for the OS window-grab. The actual
// screenshot can't run headless, but the arg construction (viewport crop + place
// hint routing for multi-Studio) is pure and worth pinning.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("node:child_process", () => {
  const actual = {};
  return {
    __esModule: true,
    execFile: vi.fn((_file, _args, opts, cb) => {
      // Simulate a successful capture producing a tiny PNG.
      cb(null, { stderr: "" }, undefined);
    }),
  };
});
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async () => Buffer.from("fake-png-bytes")),
  unlink: vi.fn(async () => {}),
}));

const { captureWindow } = await import("../src/capture.js");
const { execFile } = await import("node:child_process");

const callArgs = () => {
  const calls = (execFile as any).mock.calls;
  return calls[calls.length - 1][1];
};

describe("captureWindow args", () => {
  it("passes the viewport crop when supplied", async () => {
    await captureWindow("C:/scripts/capture.ps1", [1280, 720]);
    const args = callArgs();
    expect(args).toContain("-VpW");
    expect(args).toContain("1280");
    expect(args).toContain("-VpH");
    expect(args).toContain("720");
    expect(args).not.toContain("-Place");
  });

  it("passes the place hint when supplied", async () => {
    await captureWindow("C:/scripts/capture.ps1", undefined, "noir");
    const args = callArgs();
    expect(args).toContain("-Place");
    expect(args).toContain("noir");
  });

  it("omits the place hint when blank", async () => {
    await captureWindow("C:/scripts/capture.ps1", undefined, "   ");
    const args = callArgs();
    expect(args).not.toContain("-Place");
  });
});

describe("capture fallback wiring", () => {
  it("keeps the OS grab as a whole-window fallback when viewport crop validation fails", () => {
    const script = readFileSync("scripts/capture.ps1", "utf8");
    expect(script).toContain("$capX = $cx; $capY = $cy; $capW = $cw; $capH = $chgt");
    expect(script).toContain("$vpwPx -gt 16 -and $vphPx -gt 16");
    expect(script).toContain("$candidates = @(");
  });

  it("uses the camera viewport aspect for every frame fit path", () => {
    const handlers = readFileSync("plugin/src/100-handlers.luau", "utf8");
    expect(handlers).toContain("local function fitDistance(size, dir, fov, viewport, up)");
    expect(handlers).toContain("local aspect = (viewport.Y > 0 and viewport.X > 0) and (viewport.X / viewport.Y) or 1");
    expect(handlers).toContain("fitDistance(size, dir, fov, cam.ViewportSize, up)");
  });
});
