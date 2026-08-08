// Theme resolution for rbx_gui. normalizeGuiSpec is what decides which token table the
// plugin receives, and it deliberately never throws — an unknown theme silently falls
// back to noir. That makes the fallback behaviour worth pinning down explicitly.
import { describe, it, expect } from "vitest";
import { normalizeGuiSpec, guiNode, THEME_PRESETS, THEME_NAMES } from "../src/gui.js";

const root = { type: "panel" as const };

describe("guiNode schema", () => {
  it("validates a tree nested several levels deep", () => {
    // The node schema is recursive through a memoized z.lazy. These cases exist because
    // that memoization is what lets zod-to-json-schema emit the node once and $ref it
    // rather than inlining a second full copy — recursion must keep working regardless.
    const tree = {
      type: "panel",
      title: "Stats",
      children: [
        { type: "list", children: [{ type: "label", text: "HP" }, { type: "bar", value: 0.5 }] },
        { type: "grid", cellSize: "40,40", children: [{ type: "icon", image: "123" }] },
      ],
    };
    expect(() => guiNode.parse(tree)).not.toThrow();
  });

  it("rejects an unknown component type at any depth", () => {
    expect(() => guiNode.parse({ type: "hologram" })).toThrow();
    expect(() =>
      guiNode.parse({ type: "panel", children: [{ type: "panel", children: [{ type: "hologram" }] }] })
    ).toThrow();
  });

  it("keeps unknown props via passthrough (the plugin may understand more than we model)", () => {
    const parsed = guiNode.parse({ type: "label", text: "hi", someFuturePlugin: true }) as any;
    expect(parsed.someFuturePlugin).toBe(true);
  });

  it("resolves to a single shared instance", () => {
    // Directly pins the memoization: two accesses of the lazy must yield the same object,
    // or the emitted JSON schema silently doubles again.
    const a = (guiNode as any)._def.getter();
    const b = (guiNode as any)._def.getter();
    expect(a).toBe(b);
  });
});

describe("normalizeGuiSpec", () => {
  it("defaults to the noir preset when no theme is given", () => {
    const s = normalizeGuiSpec({ name: "HUD", root });
    expect(s.themeName).toBe("noir");
    expect(s.theme).toEqual(THEME_PRESETS.noir);
  });

  it("resolves every named preset", () => {
    for (const name of THEME_NAMES) {
      const s = normalizeGuiSpec({ name: "HUD", theme: name, root });
      expect(s.themeName).toBe(name);
      expect(s.theme).toEqual(THEME_PRESETS[name]);
    }
  });

  it("falls back to noir (not a crash) on an unknown theme name", () => {
    const s = normalizeGuiSpec({ name: "HUD", theme: "vaporwave", root });
    expect(s.themeName).toBe("noir");
    expect(s.theme).toEqual(THEME_PRESETS.noir);
  });

  it("defaults enabled to true but respects an explicit false", () => {
    expect(normalizeGuiSpec({ name: "HUD", root }).enabled).toBe(true);
    expect(normalizeGuiSpec({ name: "HUD", root, enabled: false }).enabled).toBe(false);
  });

  it("passes the root node through untouched", () => {
    const tree = { type: "panel", children: [{ type: "label", text: "hi" }] };
    expect(normalizeGuiSpec({ name: "HUD", root: tree }).root).toBe(tree);
  });

  it("merges a partial token object over noir, per token group", () => {
    const s = normalizeGuiSpec({
      name: "HUD",
      theme: { palette: { accent: [1, 2, 3] } },
      root,
    });
    expect(s.themeName).toBe("custom");
    expect(s.theme.palette.accent).toEqual([1, 2, 3]);
    // Sibling keys in the same group survive the merge...
    expect(s.theme.palette.bg).toEqual(THEME_PRESETS.noir.palette.bg);
    // ...and untouched groups are unchanged.
    expect(s.theme.font).toEqual(THEME_PRESETS.noir.font);
  });

  it("does not mutate the shared preset objects", () => {
    // mergeTheme structuredClones its base; if it ever stopped doing so, one custom-theme
    // call would permanently corrupt noir for every later call in the process.
    const before = structuredClone(THEME_PRESETS.noir);
    normalizeGuiSpec({ name: "HUD", theme: { palette: { accent: [9, 9, 9] } }, root });
    normalizeGuiSpec({ name: "HUD", theme: { shape: { corner: 99 } }, root });
    expect(THEME_PRESETS.noir).toEqual(before);
  });

  it("lets a non-object token value replace the whole group", () => {
    const s = normalizeGuiSpec({ name: "HUD", theme: { effects: 0 as any }, root });
    expect(s.theme.effects).toBe(0);
  });
});
