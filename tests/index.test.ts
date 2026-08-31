// Tests for the pure schema + batch-validation layer. BUILD_SPEC and validateBatchOps
// moved to src/schemas.ts (a module with no side effects), so these tests load only that
// module — not the MCP server — and pin the validation behavior that used to reach the
// plugin unvalidated.
import { describe, it, expect } from "vitest";
import { BUILD_SPEC, EDIT_ARGS, targetReference, targetReferences, validateBatchOps } from "../src/schemas.js";

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

  it("rejects a color channel outside 0-255", () => {
    const r = BUILD_SPEC.safeParse({ kind: "chair", center: [0, 0, 0], size: [1, 2, 3], cushionColor: [300, 0, 0] });
    expect(r.success).toBe(false);
  });

  it("accepts 0-255 color bounds", () => {
    const r = BUILD_SPEC.safeParse({ kind: "chair", center: [0, 0, 0], size: [1, 2, 3], cushionColor: [255, 0, 128] });
    expect(r.success).toBe(true);
  });

  it("accepts per-part CSG operations", () => {
    const r = BUILD_SPEC.safeParse({
      kind: "prop",
      center: [0, 0, 0],
      csg: true,
      parts: [
        { size: [2, 2, 2], op: "union" },
        { size: [1, 1, 1], op: "subtract" },
        { size: [1, 1, 1], op: "intersect" },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown per-part CSG operation", () => {
    const r = BUILD_SPEC.safeParse({
      kind: "prop",
      center: [0, 0, 0],
      parts: [{ size: [1, 1, 1], op: "separate" }],
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
      { action: "edit" as const, args: { target: "X", op: "recolor", color: [255, 0, 0] } },
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

  it("rejects an edit op missing its operation-specific argument", () => {
    const ops = [{ action: "edit" as const, args: { target: "Workspace.Model.Part", op: "rotate" } }];
    expect(() => validateBatchOps(ops)).toThrow(/op 1 \(edit\).*degrees/);
  });

  it("accepts full-path edit targets and preserves the path", () => {
    const ops = [{ action: "edit" as const, args: { target: "Workspace.Left.Part", op: "move", delta: [1, 0, 0] } }];
    expect(validateBatchOps(ops)).toEqual(ops);
  });
});

describe("target identity", () => {
  it("prefers a full path over a duplicate leaf name", () => {
    expect(targetReference({ name: "Part", path: "Workspace.Right.Part" })).toBe("Workspace.Right.Part");
  });

  it("keeps duplicate names distinct when their paths are present", () => {
    expect(targetReferences([
      { name: "Part", path: "Workspace.Left.Part" },
      { name: "Part", path: "Workspace.Right.Part" },
    ])).toEqual(["Workspace.Left.Part", "Workspace.Right.Part"]);
  });

  it("rejects duplicate name fallback when paths are missing", () => {
    expect(() => targetReferences([{ name: "Part" }, { name: "Part" }])).toThrow(/missing a full path/);
  });

  it("rejects a fallback name that collides with a path-bearing target", () => {
    expect(() => targetReferences([
      { name: "Part" },
      { name: "Part", path: "Workspace.Model.Part" },
    ])).toThrow(/missing a full path/);
  });
});

describe("EDIT_ARGS", () => {
  it("requires scale data and positive scale factors", () => {
    expect(EDIT_ARGS.safeParse({ target: "Workspace.Part", op: "scale" }).success).toBe(false);
    expect(EDIT_ARGS.safeParse({ target: "Workspace.Part", op: "scale", scale: 0 }).success).toBe(false);
    expect(EDIT_ARGS.safeParse({ target: "Workspace.Part", op: "scale", scale: 2 }).success).toBe(true);
  });

  it("requires clone offsets to be vectors when supplied", () => {
    expect(EDIT_ARGS.safeParse({ target: "Workspace.Part", op: "clone", offset: 2 }).success).toBe(false);
    expect(EDIT_ARGS.safeParse({ target: "Workspace.Part", op: "clone", offset: [0, 2, 0] }).success).toBe(true);
  });
});
