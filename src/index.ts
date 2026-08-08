// roblox-buildkit MCP server.
// Pairs with BuildKitPlugin (Luau) running in Studio: this process queues
// commands the plugin executes in the Edit datamodel, and screenshots the
// Studio window for captures the plugin has framed.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { Bridge } from "./bridge.js";
import { captureWindow } from "./capture.js";
import { guiNode, normalizeGuiSpec, THEME_NAMES } from "./gui.js";
import { mapFile, classOf } from "./sync.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CAPTURE_PS1 = path.resolve(__dirname, "..", "scripts", "capture.ps1");
const PORT = Number(process.env.BUILDKIT_PORT || 44760);

const bridge = new Bridge();

function imageResult(base64: string, note?: string) {
  const content: any[] = [{ type: "image" as const, data: base64, mimeType: "image/png" }];
  if (note) content.push({ type: "text" as const, text: note });
  return { content };
}
function textResult(obj: unknown) {
  const text = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  return { content: [{ type: "text" as const, text }] };
}
function errResult(e: unknown) {
  const text = "ERROR: " + (e instanceof Error ? e.message : String(e));
  return { content: [{ type: "text" as const, text }], isError: true };
}

const server = new McpServer({ name: "roblox-buildkit", version: "0.1.0" });

const VIEWS = ["front", "back", "left", "right", "iso", "top"] as const;

// --- capture: frame a target and screenshot the Studio window ----------------
server.registerTool(
  "rbx_capture",
  {
    title: "Capture framed view (OS-grab FALLBACK)",
    description:
      "FALLBACK capture only — PREFER rbx_frame + the official mcp__Roblox_Studio__screen_capture, which works even when Studio is backgrounded/minimized. " +
      "This OS window-grab needs Studio to be the VISIBLE FOREGROUND window (it reads screen pixels; it'll grab the wrong window or get cropped if Studio is hidden) and pops Studio to the front. " +
      "Frame a target (by name; omit for whole workspace) from its bbox and screenshot the Studio window. " +
      "Optionally cut away parts above a Y plane (cutawayY) or the top of the model (cutaway='roof'); isolate/annotate/contrast as needed.",
    inputSchema: {
      target: z.string().optional().describe("Instance name to frame (searched recursively). Omit = whole workspace."),
      view: z.enum(VIEWS).optional().describe("Camera angle. Default 'iso'."),
      zoom: z.number().optional().describe("Fit multiplier; >1 zooms out. Default 1.1."),
      cutaway: z.enum(["none", "roof"]).optional().describe("'roof' hides the top slice of the target."),
      cutawayY: z.number().optional().describe("Hide every part whose center Y is above this world height (overrides cutaway)."),
      isolate: z.boolean().optional().describe("Hide everything except the target for this one shot (needs target)."),
      annotate: z.boolean().optional().describe("Overlay a bbox outline + W×H×D dimension label on the target (needs target)."),
      contrast: z.boolean().optional().describe("Recolor the target high-contrast so seams/gaps pop (gap-inspection; pair with isolate)."),
    },
  },
  async (a) => {
    // All scene mutations (cutaway/isolate/annotate/contrast/save_camera) live in the SAME try
    // whose finally tears them down — so a throw partway through setup can't leave the editor
    // cut-away/isolated/recolored with no restore. Teardown is guarded by each token/flag.
    let token: string | null = null;
    let isoToken: string | null = null;
    let saved: any = null;
    try {
      if (a.cutawayY !== undefined || a.cutaway === "roof") {
        const cut = await bridge.sendCommand("cutaway", { target: a.target, y: a.cutawayY });
        token = cut?.token ?? null;
      }
      if (a.isolate && a.target) {
        const iso = await bridge.sendCommand("isolate", { target: a.target, mode: "on" }, 60_000);
        isoToken = iso?.token ?? null;
      }
      if (a.annotate && a.target) {
        await bridge.sendCommand("annotate", { target: a.target, mode: "on" });
      }
      if (a.contrast && a.target) {
        await bridge.sendCommand("contrast", { target: a.target, mode: "on" }, 60_000);
      }
      saved = await bridge.sendCommand("save_camera");
      const framed = await bridge.sendCommand("frame", { target: a.target, view: a.view ?? "iso", zoom: a.zoom ?? 1.1 });
      const b64 = await captureWindow(CAPTURE_PS1, saved?.viewport);
      const tags = `${a.isolate ? " [isolated]" : ""}${a.annotate ? " [annotated]" : ""}${a.contrast ? " [contrast]" : ""}`;
      return imageResult(b64, `framed ${a.target ?? "workspace"} view=${a.view ?? "iso"} size=${JSON.stringify(framed?.size)}${tags}`);
    } catch (e) {
      return errResult(e);
    } finally {
      if (saved) await bridge.sendCommand("restore_camera", saved).catch(() => {});
      if (token) await bridge.sendCommand("restore", { token }).catch(() => {});
      if (isoToken) await bridge.sendCommand("restore", { token: isoToken }).catch(() => {});
      if (a.annotate && a.target) await bridge.sendCommand("annotate", { mode: "off" }).catch(() => {});
      if (a.contrast && a.target) await bridge.sendCommand("contrast", { mode: "off" }).catch(() => {});
    }
  }
);

// --- floor plan: top-down with everything above the ceiling hidden -----------
server.registerTool(
  "rbx_floor_plan",
  {
    title: "Floor plan (top-down)",
    description: "Top-down capture of a target with everything above ceilingY hidden, so the interior layout is readable.",
    inputSchema: {
      target: z.string().describe("Instance name to frame."),
      ceilingY: z.number().describe("World Y height above which parts are hidden (the floor's ceiling level)."),
      zoom: z.number().optional(),
    },
  },
  async (a) => {
    try {
      const cut = await bridge.sendCommand("cutaway", { target: a.target, y: a.ceilingY });
      const saved = await bridge.sendCommand("save_camera");
      try {
        await bridge.sendCommand("frame", { target: a.target, view: "top", zoom: a.zoom ?? 1.05 });
        const b64 = await captureWindow(CAPTURE_PS1, saved?.viewport);
        return imageResult(b64, `floor plan of ${a.target} (hid ${cut?.hiddenCount} parts above y=${a.ceilingY})`);
      } finally {
        await bridge.sendCommand("restore_camera", saved).catch(() => {});
        await bridge.sendCommand("restore", { token: cut?.token }).catch(() => {});
      }
    } catch (e) {
      return errResult(e);
    }
  }
);

// --- montage: front/back/left/right/top + iso in one call --------------------
server.registerTool(
  "rbx_montage",
  {
    title: "Montage (6 views, OS-grab FALLBACK)",
    description:
      "FALLBACK — needs Studio visible in the foreground (OS window-grab). PREFER the official screen_capture: loop the 6 views through rbx_frame(view) → screen_capture. " +
      "Auto-frame a target's bbox and return front, back, left, right, top + iso in one call. Useful for a generated mesh's orientation. Restores the camera afterward.",
    inputSchema: {
      target: z.string().optional().describe("Instance name to frame (searched recursively). Omit = whole workspace."),
      zoom: z.number().optional().describe("Fit multiplier; >1 zooms out. Default 1.1."),
    },
  },
  async (a) => {
    const order = ["front", "back", "left", "right", "top", "iso"] as const;
    const saved = await bridge.sendCommand("save_camera").catch(() => null);
    // Only frame (which forces CameraType=Scriptable) if save_camera succeeded — else the
    // finally's `if (saved) restore_camera` is skipped and the user's Edit camera stays frozen.
    if (!saved) return textResult("rbx_montage: save_camera failed — skipping to avoid locking the Edit camera. Bring Studio to the foreground and retry.");
    try {
      const content: any[] = [];
      for (const view of order) {
        try {
          await bridge.sendCommand("frame", { target: a.target, view, zoom: a.zoom ?? 1.1 });
          const b64 = await captureWindow(CAPTURE_PS1, saved?.viewport);
          content.push({ type: "text" as const, text: `--- ${view} ---` });
          content.push({ type: "image" as const, data: b64, mimeType: "image/png" });
        } catch (e) {
          content.push({ type: "text" as const, text: `${view}: ERROR ${e instanceof Error ? e.message : String(e)}` });
        }
      }
      content.unshift({ type: "text" as const, text: `montage of ${a.target ?? "workspace"} (front/back/left/right/top/iso)` });
      return { content };
    } catch (e) {
      return errResult(e);
    } finally {
      if (saved) await bridge.sendCommand("restore_camera", saved).catch(() => {});
    }
  }
);

// --- orbit: turntable contact sheet (pseudo-3D) ------------------------------
server.registerTool(
  "rbx_orbit",
  {
    title: "Orbit turntable (OS-grab FALLBACK)",
    description:
      "FALLBACK — OS window-grab, needs Studio visible in the foreground. PREFER the official screen_capture: loop azimuths through rbx_frame(azimuth,elevation) → screen_capture for a clean turntable. " +
      "Capture N evenly-spaced views orbiting a target at a fixed elevation (+ optional top/bottom), each frame LABELED with its azimuth/elevation, as ONE contact sheet. " +
      "Best input for visualizing a build in pseudo-3D — even spacing + labels let the views fuse into one volume. Pair with rbx_describe. Restores the camera after.",
    inputSchema: {
      target: z.string().optional().describe("Instance to orbit (recursive). Omit = whole workspace."),
      n: z.number().optional().describe("Evenly-spaced orbit angles. Default 8 (try 12 for detail; capped 24)."),
      elevation: z.number().optional().describe("Camera elevation in degrees above horizon. Default 20."),
      zoom: z.number().optional().describe("Fit multiplier; >1 zooms out. Default 1.15."),
      top: z.boolean().optional().describe("Add a straight top-down frame. Default true."),
      bottom: z.boolean().optional().describe("Add a straight bottom-up frame. Default false."),
      isolate: z.boolean().optional().describe("Hide everything except target for the orbit (needs target) — floats it on the sky."),
      contrast: z.boolean().optional().describe("Recolor the target's parts high-contrast so seams/gaps pop — gap-inspection mode (pair with isolate)."),
    },
  },
  async (a) => {
    const n = Math.max(2, Math.min(24, Math.floor(a.n ?? 8)));
    const elev = a.elevation ?? 20;
    const zoom = a.zoom ?? 1.15;
    // Single try/finally: isolate/contrast/save_camera setup and teardown share one scope, so a
    // throw during setup can't leak an isolated/recolored scene (was a nested-try leak before).
    let isoToken: string | null = null;
    let saved: any = null;
    try {
      if (a.isolate && a.target) {
        const iso = await bridge.sendCommand("isolate", { target: a.target, mode: "on" }, 60_000);
        isoToken = iso?.token ?? null;
      }
      if (a.contrast && a.target) {
        await bridge.sendCommand("contrast", { target: a.target, mode: "on" }, 60_000);
      }
      saved = await bridge.sendCommand("save_camera").catch(() => null);
      const shots: { az: number; el: number; label: string }[] = [];
      for (let i = 0; i < n; i++) {
        const az = Math.round((360 / n) * i);
        shots.push({ az, el: elev, label: `az ${az}° el ${elev}°` });
      }
      if (a.top !== false) shots.push({ az: 0, el: 89, label: "top (el 89°)" });
      if (a.bottom) shots.push({ az: 0, el: -89, label: "bottom (el -89°)" });
      const content: any[] = [
        { type: "text" as const, text: `orbit of ${a.target ?? "workspace"}: ${n} angles @ elev ${elev}° — fuse the labeled frames into one volume; pair with rbx_describe.` },
      ];
      // Only frame_dir (which forces CameraType=Scriptable) if save_camera succeeded — else the
      // finally's `if (saved) restore_camera` is skipped and the user's Edit camera stays frozen.
      // Skip the shot loop (finally still runs to undo isolate/contrast).
      if (!saved) {
        content.push({ type: "text" as const, text: "save_camera failed — skipping orbit frames to avoid locking the Edit camera. Bring Studio to the foreground and retry." });
        return { content };
      }
      for (const s of shots) {
        try {
          await bridge.sendCommand("frame_dir", { target: a.target, azimuth: s.az, elevation: s.el, zoom });
          const b64 = await captureWindow(CAPTURE_PS1, saved?.viewport);
          content.push({ type: "text" as const, text: `--- ${s.label} ---` });
          content.push({ type: "image" as const, data: b64, mimeType: "image/png" });
        } catch (e) {
          content.push({ type: "text" as const, text: `${s.label}: ERROR ${e instanceof Error ? e.message : String(e)}` });
        }
      }
      return { content };
    } catch (e) {
      return errResult(e);
    } finally {
      if (saved) await bridge.sendCommand("restore_camera", saved).catch(() => {});
      if (isoToken) await bridge.sendCommand("restore", { token: isoToken }).catch(() => {});
      if (a.contrast && a.target) await bridge.sendCommand("contrast", { mode: "off" }).catch(() => {});
    }
  }
);

// --- inspect: bounding box + counts ------------------------------------------
server.registerTool(
  "rbx_inspect",
  {
    title: "Inspect instance",
    description: "Return bounding-box center/size, part count, and immediate children of a target (or whole workspace).",
    inputSchema: { target: z.string().optional() },
  },
  async (a) => {
    try {
      return textResult(await bridge.sendCommand("inspect", { target: a.target }));
    } catch (e) {
      return errResult(e);
    }
  }
);

// --- build: parametric primitives --------------------------------------------
server.registerTool(
  "rbx_build",
  {
    title: "Build primitive",
    description:
      "Create a parametric build. kind='slab' (one box), 'room' (4 walls + floor + ceiling with optional door/window openings), 'stairs', " +
      "or clean furniture: 'cabinet' (carcass with butt joinery + a `front` layout of drawer banks [front + JOINED tray + pull] and/or doors [tight reveal, " +
      "outer-edge hinge, swing OUTWARD, knob; style:'shaker' = frame+panel] + a controller Script that opens them on a ProximityPrompt; optional toeKick/countertop/backsplash, and `sink` to cut a basin through the counter+top and drop in a sink), " +
      "'table' (top + 4 legs; use for coffee/dining tables), 'shelf' (open bookcase: sides + back + `shelves` boards), 'bed' (frame + mattress + headboard + pillow), " +
      "and the house set: 'chair', 'sofa'/'armchair' (upholstered base+back+arms+cushions), 'desk' (top + drawer pedestal), 'nightstand'/'dresser' (drawers), 'wardrobe' (2 doors + rail), " +
      "'fridge'/'stove' (carcass + interactive doors; stove adds cooktop+burners+knobs), 'toilet', 'bathtub'. All face +Z; storage pieces get the same ProximityPrompt drawer/door controller as cabinet. " +
      "For props use kind='prop': either a `prop` PRESET (mug/bottle/glass/ashtray/tablelamp/floorlamp/book/bookstack/plate/candle/pictureframe/clock/telephone/radio — ready-made noir set-dressing, `color`+`scale` to tweak) OR a custom `parts` list of primitives (box/cylinder/ball/wedge + pos/size/rot/color/material/neon/light) composed into one model — no execute_luau needed. Props are parametric too (Scale attribute rebuilds in place). Add `csg:true` to union the parts into one smooth solid, with any part marked `negate:true` SUBTRACTED first (real hollow mugs/cups/bowls, beveled/blended forms) — CSG props are a final bake (not parametric). " +
      "All furniture is z-fight-/gap-free by construction with textured-material defaults — verify with rbx_qa. " +
      "Furniture is PARAMETRIC: each piece is tagged with Width/Height/Depth/Color attributes (edit them in the Properties panel and the buildkit regenerates it in place), auto-sizes to real proportions when `size` is omitted, and chair/sofa/armchair get a sit-on Seat. Optional quality flags: `preset` (era/style), `weather`, `csg` (smooth carcass shell), `plinth`, `bevel`. " +
      "Returns the created model name and part count. Capture it afterward (rbx_frame + official screen_capture).",
    inputSchema: {
      spec: z
        .object({
          kind: z.enum([
            "slab", "room", "stairs", "cabinet", "table", "shelf", "bed",
            "chair", "sofa", "armchair", "desk", "nightstand", "dresser", "wardrobe",
            "fridge", "stove", "toilet", "bathtub", "prop",
          ]),
          parts: z
            .array(
              z
                .object({
                  shape: z.enum(["box", "cylinder", "ball", "wedge"]).optional().describe("Default box. Cylinder length is along its LOCAL X — use rot to orient."),
                  pos: z.array(z.number()).length(3).optional().describe("[x,y,z] offset from center. Default [0,0,0]."),
                  size: z.array(z.number()).length(3),
                  rot: z.array(z.number()).length(3).optional().describe("[rx,ry,rz] degrees."),
                  color: z.array(z.number()).length(3).optional(),
                  material: z.string().optional(),
                  transparency: z.number().optional(),
                  neon: z.boolean().optional().describe("Material=Neon (glows)."),
                  canCollide: z.boolean().optional(),
                  negate: z.boolean().optional().describe("with spec.csg: SUBTRACT this part from the union (hollow out mugs/cups/bowls)."),
                  name: z.string().optional(),
                  light: z
                    .object({
                      color: z.array(z.number()).length(3).optional(),
                      brightness: z.number().optional(),
                      range: z.number().optional(),
                    })
                    .passthrough()
                    .optional()
                    .describe("Attach a PointLight to this part."),
                  fx: z
                    .union([
                      z.enum(["fire", "smoke", "magic", "energy", "sparkle"]),
                      z
                        .object({
                          preset: z.enum(["fire", "smoke", "magic", "energy", "sparkle"]).optional(),
                          color: z.array(z.number()).length(3).optional().describe("[r,g,b] flat tint override."),
                          rate: z.number().optional(),
                          speed: z.number().optional(),
                          size: z.number().optional().describe("multiplier on particle size."),
                          texture: z.string().optional(),
                        })
                        .passthrough(),
                    ])
                    .optional()
                    .describe("Attach a tuned ParticleEmitter (+glow): 'fire'/'smoke'/'magic'/'energy'/'sparkle', or an object with overrides. Use for torches, magic orbs, energy cores, braziers."),
                })
                .passthrough()
            )
            .optional()
            .describe("prop: primitive parts composed into one model (each pos is relative to center). Build any small prop without a dedicated kind."),
          prop: z
            .enum([
              "mug", "bottle", "glass", "ashtray", "tablelamp", "floorlamp", "book",
              "bookstack", "plate", "candle", "pictureframe", "clock", "telephone", "radio",
              "smartphone", "laptop", "tv", "desklamp", "trashcan", "knifeblock", "vase", "teapot",
              "desktop", "alarmclock", "retropc", "digitalclock", "gamingpc", "drone", "crate", "chest",
              "sword", "shield", "torch", "coinstack", "holoorb", "lootbox", "barrel", "potion",
              "toaster", "bowl", "candlestick", "transistor", "crttv", "speaker", "axe", "microwave",
              "wineglass", "kettle", "pottedplant", "lantern", "ereader", "travelmug",
              "futurecup", "winebottle", "holotv", "candelabra", "tankard", "mace",
            ])
            .optional()
            .describe("prop preset: a ready-made multi-part prop (noir set-dressing). With this you can omit `parts`. `color` overrides the hero colour; `scale` resizes."),
          scale: z.number().optional().describe("prop: uniform scale multiplier (default 1). Editable later via the Scale attribute (rebuilds in place)."),
          seats: z.number().optional().describe("sofa: number of seat cushions (default 3)."),
          drawers: z.number().optional().describe("nightstand: drawer count (default 2)."),
          columns: z.number().optional().describe("dresser: drawer columns (default 2)."),
          rows: z.number().optional().describe("dresser: drawer rows per column (default 3)."),
          cushionColor: z.array(z.number()).length(3).optional().describe("sofa/armchair: [r,g,b] cushion color."),
          cooktopColor: z.array(z.number()).length(3).optional().describe("stove: [r,g,b] cooktop color."),
          style: z.string().optional().describe("cabinet: 'shaker' for frame+panel doors (else flat)."),
          shelves: z.number().optional().describe("shelf: number of shelf boards; also fridge interior shelf count (default 3). Cabinet door sections use per-section `shelves`."),
          panelColor: z.array(z.number()).length(3).optional().describe("cabinet shaker: [r,g,b] door panel color."),
          mattressColor: z.array(z.number()).length(3).optional().describe("bed: [r,g,b] mattress color."),
          name: z.string().optional(),
          center: z.array(z.number()).length(3).describe("[x,y,z] center of the volume (prop: the origin parts offset from)."),
          size: z.array(z.number()).length(3).optional().describe("[width,height,depth]. Required for all kinds except 'prop' (which uses per-part sizes)."),
          thickness: z.number().optional().describe("Wall/slab thickness (cabinet: carcass panel thickness, default 0.4)."),
          material: z.string().optional().describe("Roblox Material enum name, e.g. Brick, Concrete, WoodPlanks."),
          color: z.array(z.number()).length(3).optional().describe("[r,g,b] 0-255."),
          parent: z.string().optional().describe("Name of an existing model to parent into; else a new model in workspace."),
          front: z
            .array(
              z.object({
                type: z.enum(["drawers", "doors"]),
                count: z.number(),
                shelves: z.number().optional().describe("doors section: N interior shelves behind the doors (omit for empty, e.g. under a sink)."),
              })
            )
            .optional()
            .describe("cabinet: front layout, left→right sections. e.g. [{type:'drawers',count:3},{type:'doors',count:2,shelves:2}]."),
          toeKick: z.boolean().optional().describe("cabinet: recessed base plinth."),
          preset: z
            .enum(["victorian", "midcentury", "rustic", "modern", "artdeco"])
            .optional()
            .describe("era/style preset — bundles color/material/style/hardware (your explicit fields still win)."),
          weather: z.boolean().optional().describe("subtle per-part color variation so surfaces aren't dead-flat uniform."),
          csg: z.boolean().optional().describe("union the static carcass into one smooth shell via CSG (drawers/doors/sink stay separate; guarded — falls back to parts on any failure)."),
          plinth: z.boolean().optional().describe("dresser/case goods: add a 2-tier plinth base."),
          bevel: z.boolean().optional().describe("table: chamfer the top edges (WedgePart, no CSG)."),
          bullnose: z.boolean().optional().describe("cabinet+countertop: rounded front edge (cylinder nose) — KitchenUnit-style smooth counter."),
          countertop: z.boolean().optional().describe("cabinet: add a slab countertop on top."),
          backsplash: z.boolean().optional().describe("cabinet: add a backsplash (needs countertop)."),
          sink: z
            .object({
              width: z.number().optional(),
              depth: z.number().optional(),
              offset: z.number().optional().describe("x offset of the basin from cabinet center."),
              basinDepth: z.number().optional(),
              basinColor: z.array(z.number()).length(3).optional(),
              faucet: z.boolean().optional().describe("default true."),
              apron: z.boolean().optional().describe("farmhouse apron sink: a big exposed white basin front flush at the cabinet face (hero element)."),
            })
            .optional()
            .describe(
              "cabinet+countertop: cut a basin hole THROUGH the counter + carcass top and drop in a sink (basin walls/bottom + gooseneck faucet) so it isn't capped by counter blocks. width/depth in studs (default ~55% inner width × D-1.2). Put doors (or nothing), not drawers, in the section under the sink."
            ),
          hardwareColor: z.array(z.number()).length(3).optional().describe("cabinet: [r,g,b] for pulls/knobs (default aged brass)."),
          interiorColor: z.array(z.number()).length(3).optional().describe("cabinet: [r,g,b] for drawer trays/interior."),
          door: z
            .object({ wall: z.enum(["front", "back", "left", "right"]), width: z.number(), height: z.number() })
            .optional(),
          windows: z
            .array(
              z.object({
                wall: z.enum(["front", "back", "left", "right"]),
                width: z.number(),
                height: z.number(),
                sill: z.number(),
                offset: z.number().optional().describe("Lateral offset from wall center."),
              })
            )
            .optional(),
          floor: z.boolean().optional(),
          ceiling: z.boolean().optional(),
          steps: z.number().optional().describe("stairs: number of steps."),
        })
        .passthrough(),
    },
  },
  async (a) => {
    try {
      // Tolerate a flat call (some clients don't wrap under `spec`) and reject a
      // kindless spec here with a clear message instead of letting the plugin
      // throw the cryptic "unknown build kind: nil".
      const spec: any = a && (a as any).spec ? (a as any).spec : a;
      if (!spec || typeof spec !== "object" || !spec.kind) {
        return errResult(
          new Error(
            "rbx_build: missing spec.kind. Call as {spec:{kind:'chair',center:[x,y,z],size:[w,h,d]}}."
          )
        );
      }
      return textResult(await bridge.sendCommand("build", spec, 60_000));
    } catch (e) {
      return errResult(e);
    }
  }
);

// --- Insert a marketplace/toolbox asset by id (no official insert_model needed) ---
server.registerTool(
  "rbx_insert",
  {
    title: "Insert asset by id",
    description:
      "Insert a Roblox marketplace/toolbox asset by numeric id via InsertService:LoadAsset, then anchor + (optionally) parent/position/rename it. " +
      "The asset must be FREE or owned by you. Use when a store/toolbox asset fits better than building it — the buildkit alternative to the official insert_model. " +
      "(generate_mesh and play-mode start/stop are privileged Roblox APIs a third-party plugin can't replicate — keep using the official MCP for those.)",
    inputSchema: {
      assetId: z.number().describe("Numeric asset/model id to load."),
      name: z.string().optional().describe("Rename the inserted top-level instance."),
      parent: z.string().optional().describe("Name of an existing workspace model to parent into (else workspace)."),
      position: z.array(z.number()).length(3).optional().describe("[x,y,z] to move the inserted model to."),
      anchored: z.boolean().optional().describe("Anchor all inserted parts. Default true."),
    },
  },
  async (a) => {
    try {
      return textResult(await bridge.sendCommand("insert", a, 60_000));
    } catch (e) {
      return errResult(e);
    }
  }
);

// --- GUI: build a styled ScreenGui + render an edit-time preview --------------
server.registerTool(
  "rbx_gui",
  {
    title: "Build styled UI",
    description:
      "Build a styled ScreenGui from a component tree and screenshot it. The real ScreenGui goes into StarterGui (shows at gameplay); " +
      "an edit-time preview is rendered into CoreGui so you can SEE it while editing without entering play mode. " +
      "Re-running with the same name replaces both. Call rbx_gui_preview(name,'off') when done so the UI only shows during gameplay.\n" +
      "Components (node.type): panel, label, button, bar, list, grid, icon, input, divider, spacer. " +
      "Styling (corner/stroke/gradient/padding/font/color) is applied automatically from the theme — override any prop per node. " +
      `Theme presets: ${THEME_NAMES.join(", ")} (or pass a partial token object).`,
    inputSchema: {
      name: z.string().describe("ScreenGui name (unique; same name replaces the previous build)."),
      theme: z
        .union([z.enum(THEME_NAMES as [string, ...string[]]), z.object({}).passthrough()])
        .optional()
        .describe("Preset name or a partial {palette,font,shape,effects} token object. Default 'noir'."),
      enabled: z.boolean().optional().describe("StarterGui ScreenGui.Enabled (shown at runtime). Default true."),
      root: guiNode.describe("Root component node (usually a 'panel'). Children nest via node.children."),
    },
  },
  async (a) => {
    try {
      const spec = normalizeGuiSpec(a as any);
      const res = await bridge.sendCommand("build_gui", spec, 60_000);
      const b64 = await captureWindow(CAPTURE_PS1, res?.viewport);
      return imageResult(
        b64,
        `built GUI "${res?.name}" theme=${spec.themeName} enabled=${res?.enabled} (real in StarterGui, edit-preview in CoreGui). ` +
          `rbx_gui_preview(name,'off') to hide for gameplay-only.`
      );
    } catch (e) {
      return errResult(e);
    }
  }
);

// --- GUI: toggle/clear the CoreGui edit preview ------------------------------
server.registerTool(
  "rbx_gui_preview",
  {
    title: "Toggle UI edit preview",
    description:
      "Show ('on') or clear ('off') the CoreGui edit-time preview of a previously built ScreenGui. " +
      "'off' leaves the real ScreenGui in StarterGui untouched, so the UI only appears during gameplay. " +
      "'on' re-renders the preview from the StarterGui copy and returns a fresh screenshot.",
    inputSchema: {
      name: z.string().describe("ScreenGui name used in rbx_gui."),
      mode: z.enum(["on", "off"]).describe("'on' show edit preview (+screenshot), 'off' clear it."),
    },
  },
  async (a) => {
    try {
      const res = await bridge.sendCommand("gui_preview", { name: a.name, mode: a.mode });
      if (a.mode === "on") {
        const b64 = await captureWindow(CAPTURE_PS1, res?.viewport);
        return imageResult(b64, `preview ON for "${a.name}"`);
      }
      return textResult({ name: a.name, preview: "off", cleared: res?.cleared ?? 0 });
    } catch (e) {
      return errResult(e);
    }
  }
);

// --- lighting toggle for clear captures --------------------------------------
server.registerTool(
  "rbx_set_lighting",
  {
    title: "Set lighting",
    description: "Toggle scene lighting: 'day' for bright neutral capture, 'noir' to restore a dark moody look.",
    inputSchema: { mode: z.enum(["day", "noir"]) },
  },
  async (a) => {
    try {
      return textResult(await bridge.sendCommand("set_lighting", { mode: a.mode }));
    } catch (e) {
      return errResult(e);
    }
  }
);

// --- frame: compute camera coords WITHOUT moving the camera ------------------
server.registerTool(
  "rbx_frame",
  {
    title: "Frame coords (PRIMARY capture path)",
    description:
      "THE primary capture path. Compute camera_position + look_at_position framing a target's bbox, WITHOUT moving the camera, then feed them to the " +
      "official mcp__Roblox_Studio__screen_capture — a clean chrome-free shot that works even when Studio is BACKGROUNDED or MINIMIZED. " +
      "Use a named `view`, OR `azimuth`/`elevation` (degrees) for any angle — loop azimuths for a turntable, calling screen_capture each. " +
      "Prefer this over rbx_capture/montage/orbit (those OS window-grabs are a FALLBACK that needs Studio visible in the foreground).",
    inputSchema: {
      target: z.string().optional().describe("Instance name to frame (recursive). Omit = whole workspace."),
      view: z.enum(VIEWS).optional().describe("Named camera angle. Default 'iso'. (Ignored if azimuth/elevation given.)"),
      azimuth: z.number().optional().describe("Arbitrary angle: degrees around the target (0=front/+Z, 90=right/+X). Use for turntables."),
      elevation: z.number().optional().describe("Arbitrary angle: degrees above the horizon. Default 20 (with azimuth)."),
      zoom: z.number().optional().describe("Fit multiplier; >1 zooms out. Default 1.1."),
    },
  },
  async (a) => {
    try {
      const useDir = a.azimuth !== undefined || a.elevation !== undefined;
      const r = useDir
        ? await bridge.sendCommand("frame_dir_coords", { target: a.target, azimuth: a.azimuth ?? 0, elevation: a.elevation ?? 20, zoom: a.zoom ?? 1.1 })
        : await bridge.sendCommand("frame_coords", { target: a.target, view: a.view ?? "iso", zoom: a.zoom ?? 1.1 });
      return textResult({
        ...r,
        hint: "pass camera_position + look_at_position to mcp__Roblox_Studio__screen_capture (works even if Studio is backgrounded)",
      });
    } catch (e) {
      return errResult(e);
    }
  }
);

// --- edit: transform/recolor/delete/clone an existing target -----------------
server.registerTool(
  "rbx_edit",
  {
    title: "Edit existing instance",
    description:
      "Modify an existing target in place (build -> see -> fix without raw Luau). Each edit is one undo step (rbx_undo / Ctrl+Z). " +
      "ops: move (delta or to), rotate (degrees about bbox center), scale (model: number factor; part: number or [x,y,z]), " +
      "recolor (color), material (name), anchor (anchored bool, default true — fixes qa unanchored), rename (name), delete, clone (offset + optional name). " +
      "Transforms apply to a Model as a whole; recolor/material apply to every BasePart under the target.",
    inputSchema: {
      target: z.string().describe("Instance name to edit (searched recursively)."),
      op: z.enum(["move", "rotate", "scale", "recolor", "material", "anchor", "rename", "delete", "clone"]),
      delta: z.array(z.number()).length(3).optional().describe("move: [dx,dy,dz] world translation."),
      to: z.array(z.number()).length(3).optional().describe("move: absolute [x,y,z] target for the bbox center."),
      degrees: z.array(z.number()).length(3).optional().describe("rotate: [x,y,z] degrees about bbox center."),
      scale: z.union([z.number(), z.array(z.number()).length(3)]).optional().describe("scale: factor (model) or factor/[x,y,z] (part)."),
      color: z.array(z.number()).length(3).optional().describe("recolor: [r,g,b] 0-255."),
      material: z.string().optional().describe("material: Roblox Material enum name."),
      name: z.string().optional().describe("rename: new name; clone: name for the copy."),
      offset: z.array(z.number()).length(3).optional().describe("clone: [dx,dy,dz] world offset for the copy."),
      anchored: z.boolean().optional().describe("anchor: true to anchor every part (default), false to unanchor. Fixes rbx_qa unanchored warnings."),
    },
  },
  async (a) => {
    try {
      return textResult(await bridge.sendCommand("edit", a, 60_000));
    } catch (e) {
      return errResult(e);
    }
  }
);

// --- qa: geometric lint ------------------------------------------------------
server.registerTool(
  "rbx_qa",
  {
    title: "QA lint a build",
    description:
      "Geometric lint you can't eyeball: unanchored parts, duplicate-placed parts (same pos+size), deep interpenetrations, " +
      "Z-FIGHTS (coplanar/overlapping surfaces fighting over depth → the flicker), UNJOINED ASSEMBLY PIECES (a drawer front split from its tray, " +
      "a handle off its panel → 'X splits into N groups'), and part-budget warnings, plus the overall bounding box. " +
      "Pair with rbx_montage / rbx_floor_plan (or rbx_frame + screen_capture) for the visual side of QA. " +
      "fix=true auto-nudges each z-fighting part 0.06 off the shared plane (one undo step) — re-run to confirm. " +
      "fit=true adds the CROSS-ASSEMBLY fit check: pieces from DIFFERENT sub-models whose faces nearly meet but leave a visible slot " +
      "(a leg short of the floor, a panel not meeting its frame, a drawer front not filling its opening) — the gaps assemblyGaps can't see because it only looks WITHIN one model. " +
      "Intended drawer/door slide clearances are excluded (via the Kind attribute). It's opt-in and rotation-approximate, so VERIFY each hit against a capture.",
    inputSchema: {
      target: z.string().describe("Instance name to lint (searched recursively)."),
      fix: z.boolean().optional().describe("Auto-resolve z-fights by nudging coplanar parts 0.06 apart (one undo step)."),
      fit: z.boolean().optional().describe("Also report cross-assembly fit-gaps: different sub-models whose faces nearly meet but don't touch (a piece that should sit snug but leaves a slot). Opt-in; verify vs a capture."),
    },
  },
  async (a) => {
    try {
      return textResult(await bridge.sendCommand("qa", { target: a.target, fix: a.fix ?? false, fit: a.fit ?? false }, 60_000));
    } catch (e) {
      return errResult(e);
    }
  }
);

// --- undo/redo Studio waypoints ----------------------------------------------
server.registerTool(
  "rbx_undo",
  {
    title: "Undo / redo",
    description: "Undo (or redo) the last BuildKit mutation(s). Each rbx_build / rbx_edit / rbx_gui is one recorded waypoint.",
    inputSchema: {
      steps: z.number().optional().describe("How many waypoints to undo/redo. Default 1."),
      redo: z.boolean().optional().describe("Redo instead of undo. Default false."),
    },
  },
  async (a) => {
    try {
      return textResult(await bridge.sendCommand("undo", { steps: a.steps ?? 1, redo: a.redo ?? false }));
    } catch (e) {
      return errResult(e);
    }
  }
);

// --- batch: many build/edit ops as one undo step + one round trip -----------
server.registerTool(
  "rbx_batch",
  {
    title: "Batch build/edit (one undo)",
    description:
      "Run several build/edit ops in ONE call = one undo step + one round trip (place N props, multi-edit a model). " +
      "ops: [{action:'build'|'edit', args:{...}}] where for a build op args is the spec FIELDS DIRECTLY (e.g. {kind:'slab',center:[x,y,z],size:[w,h,d]}) — NOT wrapped in {spec:...} like rbx_build; for an edit op args is exactly what rbx_edit takes. " +
      "Atomic: if any op errors the whole batch reverts. Returns each op's result in order.",
    inputSchema: {
      ops: z
        .array(
          z.object({
            action: z.enum(["build", "edit"]),
            args: z.object({}).passthrough().describe("build: the spec fields directly (kind, center, size, ...) — NOT {spec:...}. edit: the rbx_edit args (target, op, ...)."),
          })
        )
        .describe("Ordered ops, run in one ChangeHistory recording."),
    },
  },
  async (a) => {
    try {
      // Batch op args are passthrough (not schema-validated like rbx_build), so a
      // build op missing `kind` would reach the plugin and throw "unknown build
      // kind: nil". Catch it here with an actionable message + op index.
      for (let i = 0; i < a.ops.length; i++) {
        const op: any = a.ops[i];
        if (op.action === "build" && !(op.args && op.args.kind)) {
          return errResult(
            new Error(
              `rbx_batch op ${i + 1}: build op missing args.kind (got ${JSON.stringify(
                op.args
              )}). Each build op is {action:'build',args:{kind:'chair',center:[x,y,z],size:[w,h,d]}}.`
            )
          );
        }
      }
      return textResult(await bridge.sendCommand("batch", { ops: a.ops }, 120_000));
    } catch (e) {
      return errResult(e);
    }
  }
);

// --- describe: compact text scene readback (cheap "eyes") --------------------
server.registerTool(
  "rbx_describe",
  {
    title: "Describe (text scene readback)",
    description:
      "Compact JSON readback of a target: name/class/bbox per node, plus BasePart props (anchored/material/color) and children to `depth`. " +
      "VERIFY a build/edit in text without spending a screenshot — only capture when geometry is genuinely ambiguous.",
    inputSchema: {
      target: z.string().optional().describe("Instance name (recursive). Omit = whole workspace."),
      depth: z.number().optional().describe("Child recursion depth 0-4. Default 1."),
    },
  },
  async (a) => {
    try {
      return textResult(await bridge.sendCommand("describe", { target: a.target, depth: a.depth ?? 1 }));
    } catch (e) {
      return errResult(e);
    }
  }
);

// --- selection bridge: read what the user clicked / show what you mean -------
server.registerTool(
  "rbx_selection",
  {
    title: "Get/set Studio selection",
    description:
      "mode='get' returns the instances the user has selected in Studio (name/class/path/bbox) — operate on 'this'. " +
      "mode='set' selects <target> so the user SEES what you're referring to (the blue selection box).",
    inputSchema: {
      mode: z.enum(["get", "set"]).describe("'get' read selection, 'set' select target."),
      target: z.string().optional().describe("set: instance name to select (recursive)."),
    },
  },
  async (a) => {
    try {
      return textResult(await bridge.sendCommand("selection", { mode: a.mode, target: a.target }));
    } catch (e) {
      return errResult(e);
    }
  }
);

// --- measure: distance/delta between two points ------------------------------
server.registerTool(
  "rbx_measure",
  {
    title: "Measure distance",
    description:
      "Distance + axis delta between two points. Each of a,b is an instance NAME (uses its bbox center) or explicit [x,y,z]. " +
      "Kills coordinate guessing when aligning or spacing objects.",
    inputSchema: {
      a: z.union([z.string(), z.array(z.number()).length(3)]).describe("Instance name or [x,y,z]."),
      b: z.union([z.string(), z.array(z.number()).length(3)]).describe("Instance name or [x,y,z]."),
    },
  },
  async (a) => {
    try {
      return textResult(await bridge.sendCommand("measure", { a: a.a, b: a.b }));
    } catch (e) {
      return errResult(e);
    }
  }
);

// --- find: query the scene instead of guessing exact names -------------------
server.registerTool(
  "rbx_find",
  {
    title: "Find instances",
    description:
      "Query the scene for instances instead of needing the exact name. Filter by any combination of: name substring (or exact:true), className (matched with :IsA — 'BasePart'/'Model'/'Script'/…), CollectionService tag, attribute (key + optional value), and proximity (near a [x,y,z] point OR another instance, within radius). Returns up to `limit` {path,class,pos,size}. This is the cheap-perception way to LOCATE things before edit/inspect/describe — the internal findInst is name-only + first-match; this is the real search. Prefer it over blind execute_luau scans.",
    inputSchema: {
      name: z.string().optional().describe("Name substring (case-insensitive), or exact match with exact:true."),
      exact: z.boolean().optional(),
      class: z.string().optional().describe("ClassName matched with :IsA (e.g. 'BasePart','Model','ProximityPrompt')."),
      tag: z.string().optional().describe("CollectionService tag."),
      attr: z
        .object({ key: z.string(), value: z.union([z.string(), z.number(), z.boolean()]).optional() })
        .optional()
        .describe("Attribute filter: key present, or key==value."),
      near: z
        .object({
          point: z.array(z.number()).length(3).optional(),
          target: z.string().optional(),
          radius: z.number().optional(),
        })
        .optional()
        .describe("Proximity: within radius of a [x,y,z] point or another instance's bbox center."),
      root: z.string().optional().describe("Limit search under this instance (default whole workspace)."),
      limit: z.number().optional().describe("Max results (default 50, cap 500)."),
    },
  },
  async (a) => {
    try {
      return textResult(await bridge.sendCommand("find", a, 15_000));
    } catch (e) {
      return errResult(e);
    }
  }
);

// --- cast: raycast / volume overlap query ------------------------------------
server.registerTool(
  "rbx_cast",
  {
    title: "Raycast / volume query",
    description:
      "Spatial perception without writing Luau. mode='ray' casts origin→dir (optional length) and returns the first hit {part,position,normal,distance,material} — use for line-of-sight, ground height, wall/window checks (exactly the kind of query gameplay code does by hand). mode='box'/'sphere' returns every part overlapping a region (center+size, or center+radius) — use for placement clearance, containment ('is this spot free'), 'what's here'. `ignore` = instance names to exclude from the query (e.g. the character or the thing you're placing). Returns instance paths.",
    inputSchema: {
      mode: z.enum(["ray", "box", "sphere"]),
      origin: z.array(z.number()).length(3).optional().describe("ray: start point."),
      dir: z.array(z.number()).length(3).optional().describe("ray: direction (scaled by `length` if given, else used as-is)."),
      length: z.number().optional().describe("ray: distance along dir.Unit."),
      center: z.array(z.number()).length(3).optional().describe("box/sphere: center."),
      size: z.array(z.number()).length(3).optional().describe("box: full size."),
      radius: z.number().optional().describe("sphere: radius."),
      ignore: z.array(z.string()).optional().describe("Instance names to exclude from the cast/overlap."),
      limit: z.number().optional().describe("box/sphere: max parts (default 50, cap 500)."),
    },
  },
  async (a) => {
    try {
      return textResult(await bridge.sendCommand("cast", a, 15_000));
    } catch (e) {
      return errResult(e);
    }
  }
);

// --- script: READ Luau source (the read side sync never had) -----------------
server.registerTool(
  "rbx_script",
  {
    title: "Read script source",
    description:
      "READ game code — sync only WRITES it, this reads it back so the agent can understand existing logic without round-tripping through disk or execute_luau. mode='read' returns a Script/LocalScript/ModuleScript's Source (pass from/to to page; sources >1500 lines require a range). mode='list' lists every script under `target` (default whole game) with path+class+line count. mode='find' greps all scripts under `target` for a literal `query` string, returning {path,line,text}. Pair with rbx_sync to then write changes back.",
    inputSchema: {
      mode: z.enum(["read", "list", "find"]),
      target: z.string().optional().describe("read: the script; list/find: root to search under (default whole game)."),
      query: z.string().optional().describe("find: literal substring to search for."),
      from: z.number().optional().describe("read: first line (1-based)."),
      to: z.number().optional().describe("read: last line."),
      limit: z.number().optional().describe("find: max matches (default 100, cap 500)."),
    },
  },
  async (a) => {
    try {
      return textResult(await bridge.sendCommand("script", a, 15_000));
    } catch (e) {
      return errResult(e);
    }
  }
);

// --- prop: get/set/list ANY property (rbx_attr is Attributes only) ------------
server.registerTool(
  "rbx_prop",
  {
    title: "Get/set instance property",
    description:
      "Read or write ANY property on an instance — not just Attributes (that's rbx_attr). mode='get' returns one property {value,type}; mode='set' writes it (one undo step); mode='list' dumps a set of common part properties (or your own `names` list). Values: [x,y,z] becomes a Vector3, or a Color3 if the property name contains 'color'; Enum properties (Material, etc.) take a plain string like 'SmoothPlastic'; scalars/bools pass through. Removes a whole class of execute_luau for tweaking Transparency/Anchored/Material/CanCollide/custom props.",
    inputSchema: {
      mode: z.enum(["get", "set", "list"]),
      target: z.string().describe("Instance name (searched recursively)."),
      name: z.string().optional().describe("get/set: property name (e.g. 'Transparency','Material','Anchored')."),
      value: z.any().optional().describe("set: the value ([x,y,z] → Vector3/Color3; 'SmoothPlastic' → Enum; scalar/bool as-is)."),
      names: z.array(z.string()).optional().describe("list: which properties to read (default: common BasePart props)."),
    },
  },
  async (a) => {
    try {
      return textResult(await bridge.sendCommand("prop", a, 15_000));
    } catch (e) {
      return errResult(e);
    }
  }
);

// --- group: wrap parts into a Model / ungroup / weld -------------------------
server.registerTool(
  "rbx_group",
  {
    title: "Group / ungroup / weld parts",
    description:
      "mode='group' wraps parts into a single Model with a PrimaryPart, so a logical unit (e.g. the upper-right drawer) becomes ONE grouped object with all its parts underneath it — pass `parts` (instance names) or use the current Studio selection; `name` names the model, `primary` picks the PrimaryPart, `kind` tags it (e.g. 'drawer'/'door', which the qa fit check reads). mode='ungroup' dissolves a Model back to its parent. mode='weld' WeldConstraints every BasePart under a target to a single anchored root so the assembly moves as one rigid body. Note: the parametric builders (rbx_build cabinet/desk/etc.) ALREADY group each sub-unit into its own Kind-tagged Model — use this for hand-built or ungrouped geometry, or to regroup after edits. One undo step each.",
    inputSchema: {
      mode: z.enum(["group", "ungroup", "weld"]),
      target: z.string().optional().describe("ungroup/weld: the Model (or root) to act on."),
      parts: z.array(z.string()).optional().describe("group: instance names to pull under the new Model (default = current Studio selection)."),
      name: z.string().optional().describe("group: name for the new Model (default 'Group')."),
      primary: z.string().optional().describe("group: name of the part to set as PrimaryPart (default: first BasePart)."),
      kind: z.string().optional().describe("group: tag the Model's Kind attribute (e.g. 'drawer')."),
      anchored: z.boolean().optional().describe("weld: anchor the root part (default true)."),
    },
  },
  async (a) => {
    try {
      return textResult(await bridge.sendCommand("group", a, 30_000));
    } catch (e) {
      return errResult(e);
    }
  }
);

// --- console: read Studio LogService output ----------------------------------
server.registerTool(
  "rbx_console",
  {
    title: "Read Studio console",
    description:
      "Read the Studio output log (LogService) in-channel — prints, warnings, errors — without leaving BuildKit. `errorsOnly` keeps just warnings+errors; `filter` keeps lines containing a substring; `limit` caps the tail (default 50). For PLAY-mode logs the official get_console_output is better; this is the edit-time channel (e.g. see a build script's warnings right after rbx_run/execute_luau).",
    inputSchema: {
      limit: z.number().optional().describe("Max lines from the tail (default 50, cap 300)."),
      errorsOnly: z.boolean().optional().describe("Only warnings + errors."),
      filter: z.string().optional().describe("Only lines containing this substring."),
    },
  },
  async (a) => {
    try {
      return textResult(await bridge.sendCommand("console", a, 15_000));
    } catch (e) {
      return errResult(e);
    }
  }
);

// --- checkpoint: hard savepoint clone in ServerStorage -----------------------
server.registerTool(
  "rbx_checkpoint",
  {
    title: "Checkpoint / restore",
    description:
      "Hard savepoint: mode='save' clones <target> into ServerStorage under <name>; mode='restore' swaps the live target back to that clone (one undo step). " +
      "Safer than the undo stack for risky multi-step generation — save before, restore if it goes wrong. (Cleared on Studio restart.)",
    inputSchema: {
      mode: z.enum(["save", "restore"]),
      name: z.string().optional().describe("Checkpoint name. Default 'checkpoint'."),
      target: z.string().optional().describe("save: instance name to snapshot."),
    },
  },
  async (a) => {
    try {
      return textResult(await bridge.sendCommand("checkpoint", { mode: a.mode, name: a.name, target: a.target }, 60_000));
    } catch (e) {
      return errResult(e);
    }
  }
);

// --- isolate: hide everything except the target (bracket a clean capture) ----
server.registerTool(
  "rbx_isolate",
  {
    title: "Isolate target (hide the rest)",
    description:
      "mode='on' hides every part NOT under <target> so a capture shows only the object being built; mode='off' restores everything. " +
      "Bracket the official screen_capture between on/off, or just pass isolate=true to rbx_capture for a one-call shot.",
    inputSchema: {
      mode: z.enum(["on", "off"]),
      target: z.string().optional().describe("on: instance to keep visible (recursive)."),
    },
  },
  async (a) => {
    try {
      return textResult(await bridge.sendCommand("isolate", { mode: a.mode, target: a.target }, 60_000));
    } catch (e) {
      return errResult(e);
    }
  }
);

// --- annotate: overlay bbox outline + dimension label ------------------------
server.registerTool(
  "rbx_annotate",
  {
    title: "Annotate target (bbox + dimensions)",
    description:
      "mode='on' overlays a bounding-box outline + a 'W×H×D studs' label on <target> so you can read scale/extent off the screenshot; mode='off' clears it. " +
      "Bracket the official screen_capture between on/off, or pass annotate=true to rbx_capture.",
    inputSchema: {
      mode: z.enum(["on", "off"]),
      target: z.string().optional().describe("on: instance to annotate (recursive)."),
    },
  },
  async (a) => {
    try {
      return textResult(await bridge.sendCommand("annotate", { mode: a.mode, target: a.target }));
    } catch (e) {
      return errResult(e);
    }
  }
);

// --- place routing: pin commands to one Studio when several are open ---------
server.registerTool(
  "rbx_use_place",
  {
    title: "Target a Studio place",
    description:
      "When more than one Studio runs BuildKit, route all subsequent commands only to the Studio whose place name contains <name> " +
      "(case-insensitive). Call with no name to clear the filter (route to any). Server-side; takes effect immediately.",
    inputSchema: { name: z.string().optional().describe("Substring of the target place's game.Name. Omit to clear.") },
  },
  async (a) => {
    bridge.setActivePlace(a.name ?? null);
    return textResult({ activePlace: bridge.getActivePlace(), connectedPlaces: bridge.listPlaces() });
  }
);

// --- runtime harness (LAST RESORT) -------------------------------------------
// PREFER the official mcp__Roblox_Studio__execute_luau(datamodel_type:"Server"|"Client")
// for play-mode testing — zero setup, both contexts. These exist only for a
// PERSISTENT/parallel in-game channel, and require LoadStringEnabled ticked.
server.registerTool(
  "rbx_runtime",
  {
    title: "Install/remove play-mode harness (last resort)",
    description:
      "LAST RESORT — prefer the official mcp__Roblox_Studio__execute_luau(datamodel_type:'Server'|'Client'), which runs Luau in the live game with no setup. " +
      "These tools only earn their keep for a PERSISTENT/parallel in-game channel (a resident coroutine holding state across many rbx_run calls). " +
      "install injects the BuildKitRuntime Script into ServerScriptService. PREREQUISITE the plugin CAN'T do: tick ServerScriptService.LoadStringEnabled in Properties (and ensure HttpService.HttpEnabled). " +
      "Workflow: rbx_runtime install -> (tick LoadStringEnabled) -> start_stop_play(true) -> rbx_run(code) -> start_stop_play(false) -> rbx_runtime remove.",
    inputSchema: { mode: z.enum(["install", "remove"]) },
  },
  async (a) => {
    try {
      const action = a.mode === "install" ? "runtime_install" : "runtime_remove";
      return textResult(await bridge.sendCommand(action, {}, 30_000));
    } catch (e) {
      return errResult(e);
    }
  }
);

server.registerTool(
  "rbx_run",
  {
    title: "Run Luau in the live game (last resort)",
    description:
      "LAST RESORT play-mode eval via the BuildKitRuntime harness — prefer the official execute_luau(datamodel_type:'Server'|'Client'). " +
      "Runs Luau in the RUNNING server datamodel and returns its JSON-safe result (Instances/Vectors come back as strings; large tables truncate at 500 nodes). " +
      "Requires: rbx_runtime install + ServerScriptService.LoadStringEnabled ticked + the game in Play. `return <value>` to get data back.",
    inputSchema: {
      code: z.string().describe("Luau source; `return <value>` to send data back. Runs in the live server datamodel."),
      timeout: z.number().optional().describe("Max wait in seconds. Default 30."),
    },
  },
  async (a) => {
    try {
      const ms = Math.max(1, Math.floor((a.timeout ?? 30) * 1000));
      return textResult(await bridge.sendCommand("eval", { code: a.code }, ms, "runtime"));
    } catch (e) {
      return errResult(e);
    }
  }
);

// --- status ------------------------------------------------------------------
server.registerTool(
  "rbx_status",
  {
    title: "BuildKit status",
    description: "Check whether the Studio plugin is connected and polling, which places are connected, and the active place filter.",
    inputSchema: {},
  },
  async () => {
    const connectedPlaces = bridge.listPlaces();
    const activePlace = bridge.getActivePlace();
    const runtimePlaces = bridge.listRuntimePlaces();
    const cfg = bridge.getConfig() as Record<string, unknown>;
    const config = {
      path: bridge.configPath(),
      openCloudKeySet: !!cfg.openCloudKey, // never echo the key itself
      creatorId: cfg.creatorId ?? null,
      comfyUrl: cfg.comfyUrl ?? null,
    };
    try {
      const pong = await bridge.sendCommand("ping", {}, 6000);
      return textResult({ connected: true, plugin: pong, connectedPlaces, activePlace, runtimePlaces, config });
    } catch (e) {
      return textResult({
        connected: false,
        connectedPlaces,
        activePlace,
        runtimePlaces,
        config,
        hint: "Open Studio and ensure BuildKitPlugin is enabled (Plugins toolbar). " + (e instanceof Error ? e.message : ""),
      });
    }
  }
);

// --- navcheck: pathfinding / walkability QA -----------------------------------
server.registerTool(
  "rbx_navcheck",
  {
    title: "Navigation / walkability check",
    description:
      "Run PathfindingService between two points (each an instance NAME — uses its bbox center — or [x,y,z]) and report reachable?, path length, waypoint + jump counts, and (visualize:true) draw the path as neon dots in the editor (jump waypoints orange). " +
      "The official character_navigation only DRIVES a character; this QAs whether a layout is actually navigable for NPCs/players. Tune agentRadius/agentHeight/agentCanJump/waypointSpacing to the character.",
    inputSchema: {
      from: z.union([z.string(), z.array(z.number()).length(3)]).describe("Start: instance name or [x,y,z]."),
      to: z.union([z.string(), z.array(z.number()).length(3)]).describe("Goal: instance name or [x,y,z]."),
      agentRadius: z.number().optional().describe("Agent radius in studs (default 2)."),
      agentHeight: z.number().optional().describe("Agent height in studs (default 5)."),
      agentCanJump: z.boolean().optional().describe("Allow jump links (default true)."),
      waypointSpacing: z.number().optional().describe("Waypoint spacing in studs (default 4)."),
      visualize: z.boolean().optional().describe("Draw the path under workspace.BuildKitNavPath (delete the folder to clear). Default false."),
    },
  },
  async (a) => {
    try {
      return textResult(await bridge.sendCommand("navcheck", a, 30_000));
    } catch (e) {
      return errResult(e);
    }
  }
);

// --- tag: CollectionService gameplay wiring ----------------------------------
server.registerTool(
  "rbx_tag",
  {
    title: "CollectionService tags",
    description:
      "Manage CollectionService tags (gameplay wiring) without raw execute_luau — cheaper + multi-agent-safe. mode: 'add'/'remove' a tag on a target (one undo step), 'list' a target's tags, or 'query' every instance carrying a tag (returns their full paths).",
    inputSchema: {
      mode: z.enum(["add", "remove", "list", "query"]),
      target: z.string().optional().describe("add/remove/list: instance name (recursive)."),
      tag: z.string().optional().describe("add/remove/query: the tag name."),
    },
  },
  async (a) => {
    try {
      return textResult(await bridge.sendCommand("tag", a));
    } catch (e) {
      return errResult(e);
    }
  }
);

// --- attr: instance attributes -----------------------------------------------
server.registerTool(
  "rbx_attr",
  {
    title: "Instance attributes",
    description:
      "Get/set/list instance Attributes (gameplay state) without raw execute_luau. mode: 'set' (one undo; value is a string/number/bool, or [x,y,z] → Vector3), 'get' a named attribute, or 'list' all attributes on a target. Non-JSON values (Vector3/Color3) come back stringified.",
    inputSchema: {
      mode: z.enum(["set", "get", "list"]),
      target: z.string().describe("Instance name (recursive)."),
      name: z.string().optional().describe("set/get: attribute name."),
      value: z
        .union([z.string(), z.number(), z.boolean(), z.array(z.number())])
        .optional()
        .describe("set: the value. A 3-number array becomes a Vector3."),
    },
  },
  async (a) => {
    try {
      return textResult(await bridge.sendCommand("attr", a));
    } catch (e) {
      return errResult(e);
    }
  }
);

// --- diff: compare two trees / checkpoints -----------------------------------
server.registerTool(
  "rbx_diff",
  {
    title: "Diff two trees / checkpoints",
    description:
      "Compare two instance trees and report added/removed/changed (moved/resized/recolored/material/anchored), keyed by path RELATIVE to each root. Each of a,b is a CHECKPOINT name (from rbx_checkpoint) or a live instance name — e.g. rbx_checkpoint save 'before' → edit → rbx_diff('before','Cabinet'). 'Did my edit do what I meant' with no screenshot. (Lists cap at 100 entries.)",
    inputSchema: {
      a: z.string().describe("Checkpoint name or instance name (the 'before')."),
      b: z.string().describe("Checkpoint name or instance name (the 'after')."),
    },
  },
  async (a) => {
    try {
      return textResult(await bridge.sendCommand("diff", a, 60_000));
    } catch (e) {
      return errResult(e);
    }
  }
);

// --- optimize: performance / streaming audit ---------------------------------
server.registerTool(
  "rbx_optimize",
  {
    title: "Performance / streaming audit",
    description:
      "Audit a target (or the whole workspace) for runtime cost: total parts, Precise-CollisionFidelity MeshParts (expensive), unanchored geometry, parts far from origin, big models, and StreamingEnabled. fix=true lowers Precise→Box CollisionFidelity (one undo). Complements rbx_qa (geometry lint) with the perf side.",
    inputSchema: {
      target: z.string().optional().describe("Instance name (recursive). Omit = whole workspace."),
      fix: z.boolean().optional().describe("Lower Precise MeshPart CollisionFidelity to Box (one undo step). Default false."),
    },
  },
  async (a) => {
    try {
      return textResult(await bridge.sendCommand("optimize", a, 60_000));
    } catch (e) {
      return errResult(e);
    }
  }
);

// --- sync: push disk .luau file(s) into Studio (deterministic Rojo top-up) ----
// Rojo syncs EDITS to existing files but new .luau often don't auto-create in
// Studio mid-session, so require(WaitForChild) silently infinite-yields. This
// reads the file(s) off disk, maps each to its DataModel path from the
// service-named ancestor folder, and creates/updates the script in one undo step.
async function expandLuauPaths(paths: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const p of paths) {
    let st;
    try {
      st = await stat(p);
    } catch {
      throw new Error(`path not found: ${p}`);
    }
    if (st.isDirectory()) {
      const walk = async (d: string) => {
        let entries;
        try {
          entries = await readdir(d, { withFileTypes: true });
        } catch {
          return; // unreadable/vanished subdir — skip it, keep syncing the rest
        }
        for (const e of entries) {
          const fp = path.join(d, e.name);
          if (e.isDirectory()) await walk(fp);
          else if (/\.luau?$/i.test(e.name)) out.push(fp);
        }
      };
      await walk(p);
    } else {
      out.push(p);
    }
  }
  return out;
}

server.registerTool(
  "rbx_sync",
  {
    title: "Sync disk script(s) into Studio",
    description:
      "Push one or more on-disk .luau files into the running Studio's DataModel — the deterministic fix for 'I edited/added a file but Rojo didn't create it in Studio' (new files that make require(WaitForChild) hang). " +
      "Each file's target is derived from its Rojo service-named ancestor folder (ServerScriptService/, ReplicatedStorage/, StarterPlayerScripts/, …) plus suffix: .server.luau→Script, .client.luau→LocalScript, .luau→ModuleScript, init.luau→the parent folder. " +
      "Missing parent Folders are auto-created; existing scripts get their Source updated (a wrong-class instance is replaced, children preserved). One undo step. Pass a DIRECTORY to sync every .luau under it.",
    inputSchema: {
      paths: z.array(z.string()).min(1).describe("Absolute file paths and/or directories (a dir recurses for *.luau)."),
      target: z.string().optional().describe("Fallback DataModel path used ONLY when a single file has NO service-named ancestor folder (auto-mapping fails), dotted e.g. 'ServerScriptService.Foo.Bar'. Ignored when auto-mapping succeeds. Class is inferred from the filename suffix."),
      select: z.boolean().optional().describe("Select the synced instances in Studio so you can see them. Default true."),
    },
  },
  async (a) => {
    try {
      const files = await expandLuauPaths(a.paths);
      if (files.length === 0) return errResult("no .luau files found in the given paths");
      const items: { dmPath: string[]; className: string; source: string; file: string }[] = [];
      const skipped: { file: string; reason: string }[] = [];
      const useTarget = a.target && files.length === 1;
      for (const f of files) {
        const source = await readFile(f, "utf8");
        let map = mapFile(f);
        if (!map && useTarget) {
          const cls = classOf(path.basename(f));
          map = { dmPath: a.target!.split("."), className: cls?.className ?? "ModuleScript" };
        }
        if (!map) {
          skipped.push({ file: f, reason: "no service-named ancestor folder (pass `target` for a single file)" });
          continue;
        }
        items.push({ ...map, source, file: f });
      }
      if (items.length === 0) return errResult(`nothing mappable. skipped:\n${skipped.map((s) => `  ${s.file} — ${s.reason}`).join("\n")}`);
      const res = await bridge.sendCommand("sync", { items, select: a.select !== false }, 60_000);
      return textResult({ ...res, skipped: skipped.length ? skipped : undefined });
    } catch (e) {
      return errResult(e);
    }
  }
);

// --- watch: a burst of screenshots over time = a "live feed" for the agent ----
server.registerTool(
  "rbx_watch",
  {
    title: "Watch (live-feed burst, OS-grab)",
    description:
      "Grab the Studio window repeatedly over a span of time and return the frames as ONE labeled sequence (t=0.0s, t=0.5s, …) — a poor-man's live camera feed for WATCHING motion: NPCs walking, physics settling, a tween playing, play-mode action. " +
      "OS window-grab (like rbx_capture): needs Studio VISIBLE in the foreground. If Studio/BuildKit isn't detected (or every grab fails), it returns a fallback directive — switch to looping rbx_frame -> the official screen_capture, or ask the user to open Studio. " +
      "Give `target` to frame it once and hold the camera steady (motion reads against a fixed view), or `follow:true` to re-frame each shot and track a mover. In Play mode pass play:true to just grab the running game's own camera.",
    inputSchema: {
      seconds: z.number().optional().describe("Total span to watch. Default 5 (capped so frames ≤ 40)."),
      interval: z.number().optional().describe("Seconds between frames. Default 0.5 (effective interval ≥ ~0.5-1s grab cost)."),
      target: z.string().optional().describe("Frame this instance once at the start and hold the camera (omit = use the current view)."),
      follow: z.boolean().optional().describe("Re-frame `target` every shot to track a moving object. Default false (steady cam shows motion better)."),
      view: z.enum(VIEWS).optional().describe("Camera angle for the framing. Default 'iso'."),
      zoom: z.number().optional().describe("Fit multiplier; >1 zooms out. Default 1.1."),
      play: z.boolean().optional().describe("Play mode: skip all camera ops, just grab frames of the running game. Default false."),
    },
  },
  async (a) => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    // Fallback guidance the agent acts on — this MCP server can't call the
    // official screen_capture itself (separate server), so when the OS-grab
    // can't see Studio we tell the caller to switch to it, or to open Studio.
    const FALLBACK =
      "Watch via OS window-grab failed. FALLBACK: if the official Roblox_Studio MCP is connected, watch instead by looping " +
      "rbx_frame(target or azimuth) -> mcp__Roblox_Studio__screen_capture once per frame (works even when Studio is backgrounded). " +
      "If that MCP isn't available either, ASK the user to bring Roblox Studio to the foreground (BuildKit running, viewport visible), then retry.";
    // Pre-flight: is BuildKit/Studio even there? Ping cheaply before a long loop.
    try {
      await bridge.sendCommand("ping", {}, 6000);
    } catch {
      return textResult(`rbx_watch: BuildKit plugin / Roblox Studio not detected (ping timed out). ${FALLBACK}`);
    }
    const seconds = Math.max(0.5, a.seconds ?? 5);
    const interval = Math.max(0.25, a.interval ?? 0.5);
    let frames = Math.floor(seconds / interval) + 1;
    const capped = frames > 40;
    if (capped) frames = 40;
    const moveCam = !a.play && (a.target !== undefined);
    let saved: any = null;
    let grabbed = 0;
    // Only ever move the camera if save_camera succeeded — framing sets CameraType=Scriptable,
    // and restore_camera (the only thing that resets it) runs in finally ONLY when `saved`. If the
    // snapshot failed we'd otherwise leave the user's Edit camera frozen/locked with no restore.
    let canMove = false;
    try {
      if (moveCam) {
        saved = await bridge.sendCommand("save_camera").catch(() => null);
        canMove = !!saved;
        if (canMove && !a.follow) await bridge.sendCommand("frame", { target: a.target, view: a.view ?? "iso", zoom: a.zoom ?? 1.1 });
      }
      const header =
        `watching ${a.target ?? "current view"} — ${frames} frames every ~${interval}s` +
        `${a.follow ? " (following)" : ""}${capped ? " [capped at 40 frames]" : ""}. OS window-grab: Studio must be the visible foreground window.`;
      const content: any[] = [{ type: "text" as const, text: header }];
      for (let i = 0; i < frames; i++) {
        const t = (i * interval).toFixed(1);
        try {
          if (canMove && a.follow) await bridge.sendCommand("frame", { target: a.target, view: a.view ?? "iso", zoom: a.zoom ?? 1.1 });
          const b64 = await captureWindow(CAPTURE_PS1, saved?.viewport);
          content.push({ type: "text" as const, text: `--- t=${t}s ---` });
          content.push({ type: "image" as const, data: b64, mimeType: "image/png" });
          grabbed++;
        } catch (e) {
          content.push({ type: "text" as const, text: `t=${t}s: ERROR ${e instanceof Error ? e.message : String(e)}` });
        }
        if (i < frames - 1) await sleep(interval * 1000);
      }
      // Every grab failed (Studio connected but not the visible window) -> direct the fallback.
      if (grabbed === 0) content.push({ type: "text" as const, text: FALLBACK });
      return { content };
    } catch (e) {
      return errResult(e);
    } finally {
      if (saved) await bridge.sendCommand("restore_camera", saved).catch(() => {});
    }
  }
);

// --- local-gen pipeline: prompt/image -> mesh -> Roblox asset -> insert ------
const PIPELINE_PY = path.resolve(__dirname, "..", "pipeline", "gen_to_roblox.py");

function runPipeline(args: string[], env: Record<string, string>): Promise<any> {
  return new Promise((resolve, reject) => {
    const py = process.env.BK_PYTHON || "python";
    const child = spawn(py, [PIPELINE_PY, ...args], { env: { ...process.env, ...env } });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`pipeline exited ${code}: ${err.slice(-800)}`));
      const line = out.trim().split(/\r?\n/).filter(Boolean).pop() || "";
      try {
        resolve(JSON.parse(line));
      } catch {
        reject(new Error(`pipeline gave no JSON result. stderr tail: ${err.slice(-800)}`));
      }
    });
  });
}

server.registerTool(
  "rbx_gen_mesh",
  {
    title: "Generate a 3D mesh and import it to Roblox",
    description:
      "Local AI-gen -> Roblox pipeline: a text PROMPT (or an existing IMAGE) becomes a 3D mesh inserted into Studio as a MeshPart. " +
      "Chain: ComfyUI (RealVisXL concept image) -> Hunyuan3D (shape, ~20s on the local GPU) -> Blender glb->fbx -> Roblox Open Cloud upload -> InsertService:LoadAsset. " +
      "Shape-only by default (gray/untextured — color it with rbx_edit material/recolor); texture:true bakes a texture (~60s, heavier on the GPU). " +
      "REQUIRES the Open Cloud key + Creator ID in the BuildKit Settings panel (held server-side, never in a place file). Slow (~60-90s): it runs real generation locally.",
    inputSchema: {
      prompt: z.string().optional().describe("What to generate, e.g. 'a wooden barrel with iron hoops'. Omit if using image."),
      image: z.string().optional().describe("Absolute path to an existing concept image (skips ComfyUI)."),
      name: z.string().optional().describe("Name for the asset + inserted model. Default 'GenAsset'."),
      place: z.array(z.number()).length(3).optional().describe("[x,y,z] world position. Default near origin."),
      size: z.number().optional().describe("Target largest dimension in studs (auto-scales the import). Default 4."),
      texture: z.boolean().optional().describe("Bake a texture via Hunyuan3D-Paint (~60s). Default false (shape-only)."),
      split: z.boolean().optional().describe("Split into a base + opening lid (chest/box/crate) — inserts an openable assembly with a ProximityPrompt open/close. Default false."),
      faces: z.number().optional().describe("Triangle budget. Default 6000."),
    },
  },
  async (a) => {
    try {
      if (!a.prompt && !a.image) return errResult("need a prompt or an image");
      const cfg = bridge.getConfig() as Record<string, string>;
      const key = cfg.openCloudKey || process.env.RBX_KEY;
      if (!key) return errResult("Open Cloud key not set — enter it in the BuildKit Settings panel and hit Save.");
      const creator = cfg.creatorId || "0";
      const args: string[] = [
        "--name", a.name || "GenAsset",
        "--creator-id", String(creator),
        "--faces", String(a.faces ?? 6000),
      ];
      if (a.prompt) args.push("--prompt", a.prompt);
      if (a.image) args.push("--image", a.image);
      if (a.texture) args.push("--texture");
      if (a.split) args.push("--split");
      const env: Record<string, string> = { RBX_KEY: String(key) };
      if (cfg.comfyUrl) env.BK_COMFY_URL = String(cfg.comfyUrl);
      const res = await runPipeline(args, env);
      const place = a.place ?? [0, (a.size ?? 4) / 2 + 0.5, 0];
      const onErr = (e: unknown) => ({ insertError: e instanceof Error ? e.message : String(e) });
      const inserted = res.split
        ? await bridge
            .sendCommand("insertChest", { baseAssetId: res.base.assetId, lidAssetId: res.lid.assetId, name: res.name, place, size: a.size ?? 4 }, 60_000)
            .catch(onErr)
        : await bridge
            .sendCommand("insertAsset", { assetId: res.assetId, name: res.name, place, size: a.size ?? 4 }, 60_000)
            .catch(onErr);
      return textResult({ ...res, inserted });
    } catch (e) {
      return errResult(e);
    }
  }
);

async function main() {
  await bridge.start(PORT);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[buildkit] MCP server ready (stdio)");
  // Exit when the MCP host (our stdin peer) goes away, so we don't orphan and
  // squat port 44760 — that EADDRINUSE squat breaks the next client's reconnect.
  process.stdin.on("end", () => process.exit(0));
  process.stdin.on("close", () => process.exit(0));
}
main().catch((e) => {
  console.error("[buildkit] fatal:", e);
  process.exit(1);
});
