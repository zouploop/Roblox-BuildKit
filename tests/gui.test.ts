// Theme resolution for rbx_gui. normalizeGuiSpec is what decides which token table the
// plugin receives, and it deliberately never throws — an unknown theme silently falls
// back to noir. That makes the fallback behaviour worth pinning down explicitly.
import { describe, it, expect } from "vitest";
import { normalizeGuiSpec, THEME_PRESETS, THEME_NAMES } from "../src/gui.js";

const root = { type: "panel" as const };

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
