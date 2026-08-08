// capture.ts builds the PowerShell invocation for the OS window-grab. The actual
// screenshot can't run headless, but the arg construction (viewport crop + place
// hint routing for multi-Studio) is pure and worth pinning.
import { describe, it, expect, vi } from "vitest";

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
