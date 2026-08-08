// Tests for the tool layer in src/index.ts. Importing the module registers all tools on
// its McpServer but (thanks to the `isMain` guard at the bottom) does NOT start a bridge.
// We assert on the exported BUILD_SPEC schema and the batch build-op validation — the
// behaviors that previously reached the plugin unvalidated.
import { describe, it, expect } from "vitest";
import { BUILD_SPEC, validateBatchOps } from "../src/index.js";

describe("BUILD_SPEC (shared by rbx_build and rbx_batch)", () => {
  it("accepts a valid chair spec", () => {
    const r = BUILD_SPEC.safeParse({ kind: "chair", center: [0, 0, 0], size: [1, 2, 3], seats: 3 });
    expect(r.success).toBe(true);
  });

  it("accepts a prop preset spec without size (per-part sizes instead)", () => {
    const r = BUILD_SPEC.safeParse({ kind: "prop", prop: "mug", center: [5, 5, 5] });
    expect(r.success).toBe(true);
  });

  it("rejects a build op missing kind", () => {
    const r = BUILD_SPEC.safeParse({ center: [0, 0, 0] });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown kind", () => {
    const r = BUILD_SPEC.safeParse({ kind: "spaceship", center: [0, 0, 0] });
    expect(r.success).toBe(false);
  });

  it("rejects a malformed size (not length-3)", () => {
    const r = BUILD_SPEC.safeParse({ kind: "slab", center: [0, 0, 0], size: [1, 2] });
    expect(r.success).toBe(false);
  });

  it("rejects a missing center", () => {
    const r = BUILD_SPEC.safeParse({ kind: "slab", size: [1, 2, 3] });
    expect(r.success).toBe(false);
  });

  it("rejects a bad part shape name inside a prop", () => {
    const r = BUILD_SPEC.safeParse({
      kind: "prop",
      center: [0, 0, 0],
      parts: [{ shape: "dodecahedron", size: [1, 1, 1] }],
    });
    expect(r.success).toBe(false);
  });
});

describe("validateBatchOps", () => {
  it("passes through edit ops untouched", () => {
    const ops = [{ action: "edit" as const, args: { target: "Chair", op: "recolor", color: [255, 0, 0] } }];
    expect(validateBatchOps(ops)).toEqual(ops);
  });

  it("passes a valid build op through, retaining its args", () => {
    const ops = [{ action: "build" as const, args: { kind: "chair", center: [0, 0, 0], size: [1, 2, 3] } }];
    const out = validateBatchOps(ops);
    expect(out).toEqual(ops);
  });

  it("rejects a build op missing kind with the op index in the message", () => {
    const ops = [
      { action: "edit" as const, args: { target: "X", op: "recolor" } },
      { action: "build" as const, args: { center: [0, 0, 0] } },
    ];
    expect(() => validateBatchOps(ops as any)).toThrow(/op 2 \(build\)/);
  });

  it("rejects an unknown kind in a build op", () => {
    const ops = [{ action: "build" as const, args: { kind: "spaceship", center: [0, 0, 0] } }];
    expect(() => validateBatchOps(ops as any)).toThrow(/op 1 \(build\)/);
  });

  it("rejects a malformed size in a build op", () => {
    const ops = [{ action: "build" as const, args: { kind: "slab", center: [0, 0, 0], size: [1, 2] } }];
    expect(() => validateBatchOps(ops as any)).toThrow(/op 1 \(build\)/);
  });
});
