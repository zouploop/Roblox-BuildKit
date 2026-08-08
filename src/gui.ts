// GUI builder support for buildkit: theme presets, the recursive styled-component
// tree schema, and spec normalization. The plugin (handlers.build_gui) does the
// actual instance construction; this file just validates the tree and resolves the
// theme to a full token table before sending it over the bridge.
import { z } from "zod";

// --- theme tokens ------------------------------------------------------------
// Colors are [r,g,b] 0-255. Fonts are Enum.Font name strings. The plugin fills any
// missing token from its own defaults too, so partial custom themes are safe.
export type Theme = {
  palette: Record<string, [number, number, number]>;
  font: Record<string, string | number>;
  shape: Record<string, number>;
  effects: Record<string, number | boolean>;
};

export const THEME_PRESETS: Record<string, Theme> = {
  noir: {
    palette: {
      bg: [18, 18, 22], surface: [30, 30, 38], surfaceAlt: [42, 42, 52],
      accent: [212, 175, 55], accentText: [18, 18, 22],
      text: [235, 235, 240], textMuted: [150, 150, 165], stroke: [90, 90, 105],
      success: [120, 190, 120], danger: [200, 90, 80], warning: [220, 180, 90],
    },
    font: {
      title: "Oswald", titleSize: 30, heading: "GothamBold", headingSize: 22,
      body: "Gotham", bodySize: 16, caption: "Gotham", captionSize: 13,
    },
    shape: { corner: 4, stroke: 1, strokeTransparency: 0.2, padding: 14, gap: 10 },
    effects: { gradient: 0.1, gradientRotation: 90, shadow: true },
  },
  clean: {
    palette: {
      bg: [245, 246, 248], surface: [255, 255, 255], surfaceAlt: [238, 240, 244],
      accent: [45, 120, 245], accentText: [255, 255, 255],
      text: [25, 28, 34], textMuted: [120, 128, 140], stroke: [210, 214, 222],
      success: [40, 170, 110], danger: [225, 75, 75], warning: [235, 170, 60],
    },
    font: {
      title: "GothamBold", titleSize: 28, heading: "GothamBold", headingSize: 20,
      body: "Gotham", bodySize: 16, caption: "Gotham", captionSize: 13,
    },
    shape: { corner: 10, stroke: 1, strokeTransparency: 0.4, padding: 14, gap: 10 },
    effects: { gradient: 0.04, gradientRotation: 90, shadow: true },
  },
  neon: {
    palette: {
      bg: [8, 8, 14], surface: [18, 16, 28], surfaceAlt: [28, 24, 44],
      accent: [0, 229, 255], accentText: [4, 4, 10],
      text: [233, 233, 245], textMuted: [130, 140, 170], stroke: [0, 229, 255],
      success: [70, 255, 180], danger: [255, 70, 120], warning: [255, 210, 80],
    },
    font: {
      title: "GothamBlack", titleSize: 30, heading: "GothamBold", headingSize: 22,
      body: "Gotham", bodySize: 16, caption: "Gotham", captionSize: 13,
    },
    shape: { corner: 6, stroke: 1.5, strokeTransparency: 0.1, padding: 14, gap: 10 },
    effects: { gradient: 0.18, gradientRotation: 90, shadow: false },
  },
};

export const THEME_NAMES = Object.keys(THEME_PRESETS);

// --- tree schema -------------------------------------------------------------
const rgb = z.array(z.number()).length(3);

// One styled-component node. Plugin interprets the props per `type`; .passthrough()
// keeps any extra props the plugin understands. Recursive via z.lazy for children.
//
// The lazy getter is MEMOIZED, which is load-bearing for prompt size rather than speed.
// z.lazy() runs its factory on every access, so an un-memoized version handed a fresh
// object to each reference — and zod-to-json-schema, which dedupes by instance, emitted
// the whole 32-property node TWICE (once for `root`, once for `children.items`) before
// finally $ref-ing at depth 3. Returning one instance collapses that to a single
// definition plus a $ref, halving this tool's schema. Same validation either way.
let nodeSchema: z.ZodTypeAny | undefined;
export const guiNode: z.ZodType<any> = z.lazy(() =>
  (nodeSchema ??= z
    .object({
      type: z.enum([
        "panel", "label", "button", "bar", "list", "grid", "icon", "input", "divider", "spacer",
      ]),
      name: z.string().optional(),
      text: z.string().optional().describe("label/button text"),
      title: z.string().optional().describe("panel: header title (forces vertical fill)"),
      variant: z.string().optional().describe("label: title/heading/body/caption; button: primary/secondary/ghost/danger"),
      size: z.string().optional().describe('"w,h" px, or "%": e.g. "420,520", "100%,40", "fill"'),
      anchor: z.string().optional().describe("center/top/bottom/left/right/topleft/topright/bottomleft/bottomright"),
      position: z.string().optional().describe('absolute "x,y" px offset (ignored inside list/grid)'),
      offset: z.string().optional().describe('extra "x,y" px offset added to anchor'),
      fill: z.enum(["vertical", "horizontal"]).optional().describe("container: auto-layout children"),
      align: z.string().optional().describe("text/layout alignment: left/center/right"),
      padding: z.number().optional(),
      gap: z.number().optional(),
      value: z.number().optional().describe("bar: 0..1"),
      label: z.string().optional().describe("bar: overlay label"),
      showValue: z.boolean().optional().describe("bar: append percent"),
      image: z.string().optional().describe("icon: assetid (number or rbxassetid://)"),
      placeholder: z.string().optional().describe("input placeholder"),
      cellSize: z.string().optional().describe('grid: "w,h" px cell'),
      bg: rgb.optional().describe("background color override"),
      color: rgb.optional().describe("text/fill color override"),
      strokeColor: rgb.optional(),
      cornerRadius: z.number().optional(),
      strokeThickness: z.number().optional(),
      transparency: z.number().optional().describe("background transparency 0..1"),
      textSize: z.number().optional(),
      zindex: z.number().optional(),
      visible: z.boolean().optional(),
      shadow: z.boolean().optional().describe("panel: drop shadow override"),
      ignoreInset: z.boolean().optional().describe("root only: ScreenGui.IgnoreGuiInset"),
      button: z.boolean().optional().describe("icon: make it an ImageButton"),
      children: z.array(guiNode).optional(),
    })
    .passthrough())
);

// --- normalize ---------------------------------------------------------------
function mergeTheme(base: Theme, over: Record<string, any>): Theme {
  const out: any = structuredClone(base);
  for (const k of Object.keys(over || {})) {
    const v = over[k];
    if (v && typeof v === "object" && !Array.isArray(v) && typeof out[k] === "object") {
      out[k] = { ...out[k], ...v };
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Resolve theme (preset name or partial object) to full tokens; default enabled=true.
export function normalizeGuiSpec(a: {
  name: string;
  theme?: string | Record<string, any>;
  root: unknown;
  enabled?: boolean;
}) {
  const input = a.theme ?? "noir";
  let theme: Theme;
  let themeName: string;
  if (typeof input === "string") {
    theme = THEME_PRESETS[input] ?? THEME_PRESETS.noir;
    themeName = THEME_PRESETS[input] ? input : "noir";
  } else {
    theme = mergeTheme(THEME_PRESETS.noir, input);
    themeName = "custom";
  }
  return { name: a.name, enabled: a.enabled ?? true, theme, themeName, root: a.root };
}
