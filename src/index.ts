// roblox-buildkit MCP server.
// Pairs with BuildKitPlugin (Luau) running in Studio: this process queues
// commands the plugin executes in the Edit datamodel, and screenshots the
// Studio window for captures the plugin has framed.
import { McpServer, type RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFile, readdir, stat, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { Bridge } from "./bridge.js";
import { captureWindow } from "./capture.js";
import { guiNode, normalizeGuiSpec, THEME_NAMES } from "./gui.js";
import { mapFile, classOf } from "./sync.js";
import { BUILD_SPEC, EDIT_ARGS, targetReference, targetReferences, validateBatchOps, rgb255, cap } from "./schemas.js";
import { GeneratorWatcher } from "./generators.js";
import { StageState, type StageOp } from "./stage-state.js";
import { StageSessionRegistry, stageSessionId } from "./stage-sessions.js";
import { StageHistory, type StageEditState } from "./stage-history.js";
import { decodeStageArtifact, MAX_STAGE_ITEMS } from "./stage-share.js";
import { loadAsset, parseAssetId } from "./assets.js";
import { liveSyncPayload, MAX_SYNC_PARTS, normalizeSyncScope, requireRegionEcho } from "./sync-scope.js";
import { buildDetachedRestartCommand, findListenerPid, runDetachedRestart } from "./dev-reload.js";
import { LibraryStore, libraryPreview, validateLibraryPreset } from "./library.js";
import { StageRenderer } from "./stage-render.js";
import { applyStageReparent, parseStageReparentRequest } from "./stage-reparent.js";
import { overlayMirrorTransforms, type MirrorTransform } from "./mirror-sync.js";
import { writeAtomicFile } from "./atomic-file.js";
import { diffMapRules, MapWatcher, type MapFileState, type MapPlacementRule } from "./map-workflow.js";
import {
  compareConformance,
  createConformanceProfile,
  serializeConformanceProfile,
  validateConformanceProfile,
  type ConformanceProfile,
  type SceneDump,
} from "./conformance.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CAPTURE_PS1 = path.resolve(__dirname, "..", "scripts", "capture.ps1");
const PORT = Number(process.env.BUILDKIT_PORT || 44760);
const VIEWER_PORT = Number(process.env.BUILDKIT_VIEWER_PORT || 8642);
const GENERATORS_DIR = path.resolve(__dirname, "..", "generators");
const MAPS_DIR = path.resolve(__dirname, "..", "map");
const LIBRARY_DIR = path.resolve(process.env.BUILDKIT_LIBRARY_DIR || path.resolve(__dirname, "..", "library"));
const PROFILES_DIR = path.resolve(__dirname, "..", "profiles");

// Single source of truth for the version: package.json. Read at startup so a version
// bump is one edit instead of two (previously hardcoded here AND in package.json).
const SERVER_VERSION = (await readFile(path.resolve(__dirname, "..", "package.json"), "utf8"))
  .match(/"version":\s*"([^"]+)"/)?.[1] ?? "0.0.0";

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

// Short timeout for scene-teardown calls. The plugin was already proven alive at
// save_camera, so on the failure path (plugin died mid-capture) a full 30s wait per
// restore would turn one failed capture into a multi-minute hang. Run them in parallel
// with a short deadline: an already-failed call gets faster, not slower.
const TEARDOWN_MS = 5_000;
async function teardown(ops: ({ action: string; args?: any } | null)[]) {
  await Promise.allSettled(
    ops.filter((x): x is { action: string; args?: any } => !!x).map((op) => bridge.sendCommand(op.action, op.args, TEARDOWN_MS).catch(() => {}))
  );
}
// Frame calls inside a per-shot loop (orbit/watch): the plugin is proven alive at setup,
// so a frame that stalls is a dead plugin — fail each shot fast instead of eating the
// default 30s for every one of up to 24 shots.
const FRAME_MS = 12_000;
// Screenshot with the active place filter threaded through, so capture.ps1 picks the
// right Studio window when several are open (matches the bridge's command routing).
function shot(viewport?: any) {
  return captureWindow(CAPTURE_PS1, viewport, bridge.getActivePlace() ?? undefined);
}

// The ~30 plain dispatch tools all share the same shape: send a command, return its
// result as text, or wrap the error. This helper collapses that boilerplate — a tool
// handler becomes `async (a) => run("action", a, 60_000)`.
async function run(action: string, args: unknown, timeoutMs = 30_000) {
  try {
    return textResult(await bridge.sendCommand(action, args, timeoutMs));
  } catch (e) {
    return errResult(e);
  }
}

const server = new McpServer({ name: "roblox-buildkit", version: SERVER_VERSION });

type ToolCatalogEntry = {
  handle: RegisteredTool;
  title?: string;
  description?: string;
};

// Keep registration syntax unchanged while retaining the SDK handles needed to toggle
// visibility in tools/list. The SDK's registerTool config has no enabled field; disable
// handles after every tool has been registered, before the stdio transport connects.
const toolCatalog = new Map<string, ToolCatalogEntry>();
const nativeRegisterTool = server.registerTool.bind(server);
const registerTool = ((name: string, config: any, callback: any) => {
  const handle = nativeRegisterTool(name, config, callback);
  if (handle) {
    toolCatalog.set(name, { handle, title: config.title, description: config.description });
  }
  return handle;
}) as McpServer["registerTool"];

const VIEWS = ["front", "back", "left", "right", "iso", "top"] as const;
const SYNC_REGION = z.union([
  z.object({ center: z.array(z.number()).length(3), radius: z.number().positive() }),
  z.object({ min: z.array(z.number()).length(3), max: z.array(z.number()).length(3) }),
]);

registerTool(
  "rbx_build",
  {
    title: "Build primitive",
    description:
      "Create a parametric build — prefer this over hand-writing geometry: every piece is z-fight- and gap-free by construction, with textured-material defaults. " +
      "Structure: 'slab' (one box), 'room' (walls+floor+ceiling, with door/window openings), 'stairs'. " +
      "Furniture: 'cabinet', 'table', 'shelf', 'bed', 'chair', 'sofa'/'armchair', 'desk', 'nightstand', 'dresser', 'wardrobe', 'fridge', 'stove', 'toilet', 'bathtub'. " +
      "Props: kind='prop' with either a `prop` preset or a custom `parts` list. " +
      "\n\nConventions that apply throughout: everything faces +Z. Furniture auto-sizes to real proportions when `size` is omitted, and is PARAMETRIC — each piece carries " +
      "Width/Height/Depth/Color attributes, and editing those in the Properties panel regenerates it in place. Storage pieces (cabinet/desk/nightstand/dresser/wardrobe/fridge/stove) " +
      "get real pull-out drawers and swing-out doors driven by a ProximityPrompt controller Script; chair/sofa/armchair get a sit-on Seat. " +
      "`csg:true` unions the static shell into one smooth solid (moving parts stay separate), and inside a prop each part may set `op:'union'|'subtract'|'intersect'` (`negate:true` aliases subtract) — that's how you get " +
      "genuinely hollow mugs/bowls and clipped shapes. CSG output is a final bake, no longer parametric. " +
      "\n\nReturns the model name and part count. Verify with rbx_qa, then capture (rbx_frame + the official screen_capture). Per-kind options are documented on the fields below.",
    inputSchema: {
      spec: BUILD_SPEC,
    },
  },
  async (a) => {
    try {
      // a.spec is validated against BUILD_SPEC by the MCP SDK before we get here, so
      // kind is guaranteed present — no need for the old kindless-spec check.
      return textResult(await bridge.sendCommand("build", a.spec, 60_000));
    } catch (e) {
      return errResult(e);
    }
  }
);

// --- Insert a marketplace/toolbox asset by id (no official insert_model needed) ---
registerTool(
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
  async (a) => run("insert", a, 60_000)

);

// --- GUI: build a styled ScreenGui + render an edit-time preview --------------
registerTool(
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
      const b64 = await shot(res?.viewport);
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
registerTool(
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
        const b64 = await shot(res?.viewport);
        return imageResult(b64, `preview ON for "${a.name}"`);
      }
      return textResult({ name: a.name, preview: "off", cleared: res?.cleared ?? 0 });
    } catch (e) {
      return errResult(e);
    }
  }
);

// --- lighting toggle for clear captures --------------------------------------
registerTool(
  "rbx_set_lighting",
  {
    title: "Set lighting",
    description: "Toggle scene lighting: 'day' for bright neutral capture, 'noir' to restore a dark moody look.",
    inputSchema: { mode: z.enum(["day", "noir"]) },
  },
  async (a) => run("set_lighting", { mode: a.mode })

);

// --- frame: compute camera coords WITHOUT moving the camera ------------------
registerTool(
  "rbx_frame",
  {
    title: "Frame coords (PRIMARY capture path)",
    description:
      "THE primary capture path. Compute camera_position + look_at_position framing a target's bbox, WITHOUT moving the camera, then feed them to the " +
      "official mcp__Roblox_Studio__screen_capture — a clean chrome-free shot that works even when Studio is BACKGROUNDED or MINIMIZED. " +
      "Use a named `view`, OR `azimuth`/`elevation` (degrees) for any angle — loop azimuths for a turntable, calling screen_capture each. " +
      "Prefer this for a plain screenshot; reach for rbx_view for guaranteed setup/teardown (isolate/cutaway/contrast) or a batched turntable.",
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
registerTool(
  "rbx_edit",
  {
    title: "Edit existing instance",
    description:
      "Modify an existing target in place (build -> see -> fix without raw Luau). Each edit is one undo step (rbx_undo / Ctrl+Z). " +
      "ops: move (delta or to), rotate (degrees about bbox center), scale (model: number factor; part: number or [x,y,z]), transform (absolute BasePart position/rotation/size), " +
      "recolor (color), material (name), anchor (anchored bool, default true — fixes qa unanchored), rename (name), delete, clone (offset + optional name). " +
      "Transforms apply to a Model as a whole; recolor/material apply to every BasePart under the target.",
    inputSchema: EDIT_ARGS,
  },
  async (a) => run("edit", a, 60_000)

);

// --- qa: geometric lint ------------------------------------------------------
registerTool(
  "rbx_qa",
  {
    title: "QA lint a build",
    description:
      "Geometric lint you can't eyeball: unanchored parts, duplicate-placed parts (same pos+size), deep interpenetrations, " +
      "Z-FIGHTS (coplanar/overlapping surfaces fighting over depth → the flicker), UNJOINED ASSEMBLY PIECES (a drawer front split from its tray, " +
      "a handle off its panel → 'X splits into N groups'), and part-budget warnings, plus the overall bounding box. " +
      "Pair with rbx_view (angles/isolate/cutaway) or rbx_frame + screen_capture for the visual side of QA. " +
      "fix=true auto-nudges each z-fighting part 0.06 off the shared plane (one undo step) — re-run to confirm. " +
      "fit=true adds the CROSS-ASSEMBLY fit check (see the field). It's opt-in and rotation-approximate, so VERIFY each hit against a capture.",
    inputSchema: {
      target: z.string().optional().describe("Instance name to lint (searched recursively); defaults to Workspace."),
      fix: z.boolean().optional().describe("Auto-resolve z-fights by nudging coplanar parts 0.06 apart (one undo step)."),
      fit: z.boolean().optional().describe("Also report cross-assembly fit-gaps: different sub-models whose faces nearly meet but don't touch (a piece that should sit snug but leaves a slot). Opt-in; verify vs a capture."),
      region: SYNC_REGION.optional().describe("Limit QA to intersecting parts in a center/radius or min/max region; filtering happens before the 1200-part cap."),
    },
  },
  async (a) => {
    try {
      const result = await bridge.sendCommand("qa", { target: a.target, fix: a.fix ?? false, fit: a.fit ?? false, region: a.region }, 60_000);
      return textResult(requireRegionEcho(a.region, result));
    } catch (e) {
      return errResult(e);
    }
  }

);

// --- undo/redo Studio waypoints ----------------------------------------------
registerTool(
  "rbx_undo",
  {
    title: "Undo / redo",
    description: "Undo (or redo) the last BuildKit mutation(s). Each rbx_build / rbx_edit / rbx_gui is one recorded waypoint.",
    inputSchema: {
      steps: z.number().optional().describe("How many waypoints to undo/redo. Default 1."),
      redo: z.boolean().optional().describe("Redo instead of undo. Default false."),
    },
  },
  async (a) => run("undo", { steps: a.steps ?? 1, redo: a.redo ?? false })

);

// --- terrain: the voxel layer BuildKit never had -----------------------------
// Terrain is a separate system from BaseParts; without this every hill/lake/cave fell
// back to raw execute_luau. Voxels are on a 4-stud grid, so regions snap outward.
registerTool(
  "rbx_terrain",
  {
    title: "Sculpt Roblox Terrain",
    description:
      "Fill / clear / repaint the voxel Terrain — ground, hills, water, caves. " +
      "mode 'fill' + shape block|ball|cylinder|wedge|region; 'clear' (a region, or ALL terrain when min/max omitted); " +
      "'paint' swaps one material for another inside a region. Materials: grass sand rock slate concrete brick sandstone mud " +
      "basalt ground crackedlava asphalt cobblestone ice leafygrass salt limestone pavement snow woodplanks water air. " +
      "Regions snap outward to Terrain's 4-stud voxel grid. Use this for ground/hills/water; use parts for built form.",
    inputSchema: {
      mode: z.enum(["fill", "clear", "paint"]).optional().describe("Default fill."),
      shape: z.enum(["block", "ball", "cylinder", "wedge", "region"]).optional().describe("fill shape. Default block."),
      material: z.string().optional().describe("Terrain material name. Default grass."),
      center: z.array(z.number()).length(3).optional().describe("block/ball/cylinder/wedge centre."),
      size: z.array(z.number()).length(3).optional().describe("block/wedge [x,y,z] size."),
      radius: z.number().optional().describe("ball/cylinder radius."),
      height: z.number().optional().describe("cylinder height."),
      rotation: z.array(z.number()).length(3).optional().describe("block/cylinder/wedge [rx,ry,rz] degrees."),
      min: z.array(z.number()).length(3).optional().describe("region/clear/paint lower corner."),
      max: z.array(z.number()).length(3).optional().describe("region/clear/paint upper corner."),
      from: z.string().optional().describe("paint: material to replace."),
      to: z.string().optional().describe("paint: material to replace it with."),
    },
  },
  async (a) => run("terrain", a, 60_000)
);

// --- collision groups --------------------------------------------------------
registerTool(
  "rbx_collision",
  {
    title: "Collision groups",
    description:
      "Register collision groups and assign parts to them, so scenery can stop blocking NPCs (or vice versa) " +
      "WITHOUT switching CanCollide off entirely. mode: list | create | delete | assign (target/targets/select) | " +
      "collidable (name + other + canCollide).",
    inputSchema: {
      mode: z.enum(["list", "create", "delete", "assign", "collidable"]).optional().describe("Default list."),
      name: z.string().optional().describe("Group name."),
      other: z.string().optional().describe("collidable: the second group."),
      canCollide: z.boolean().optional().describe("collidable: should the two groups collide."),
      target: z.string().optional().describe("assign: instance name."),
      targets: z.array(z.string()).optional().describe("assign: several instance names."),
      select: z.object({}).passthrough().optional().describe("assign: rbx_map-style filter."),
    },
  },
  async (a) => run("collision", a)
);

// --- sound -------------------------------------------------------------------
registerTool(
  "rbx_sound",
  {
    title: "Place sounds",
    description:
      "Add / remove / list Sounds. Parented to a BasePart it is positional 3D audio; with no target it lands in " +
      "SoundService as global ambience. soundId accepts a bare numeric id or an rbxassetid:// string.",
    inputSchema: {
      mode: z.enum(["add", "remove", "list"]).optional().describe("Default add."),
      target: z.string().optional().describe("Part/instance to host the sound. Omit = SoundService (global)."),
      soundId: z.union([z.number(), z.string()]).optional().describe("add: asset id."),
      name: z.string().optional().describe("Sound name (also filters remove)."),
      volume: z.number().optional().describe("0-10. Default 0.5."),
      looped: z.boolean().optional(),
      speed: z.number().optional().describe("PlaybackSpeed. Default 1."),
      rollOffMin: z.number().optional().describe("Positional: full-volume radius."),
      rollOffMax: z.number().optional().describe("Positional: silence radius."),
    },
  },
  async (a) => run("sound", a)
);

// --- physical constraints ----------------------------------------------------
registerTool(
  "rbx_constraint",
  {
    title: "Physical constraints (hinges, welds, motors)",
    description:
      "Create real physical joints — the articulation ProximityPrompt scripts can't do. kind: hinge | weld | motor | " +
      "spring | prismatic | ball | rope | rod. Attachment-based kinds accept offsetA/offsetB (local) and an `axis` " +
      "(hinge swings about it). hinge also takes limits+lower/upper, or motor+velocity/torque for a powered joint. " +
      "`weld` uses a WeldConstraint on the parts directly.",
    inputSchema: {
      mode: z.enum(["add", "remove", "list"]).optional().describe("Default add."),
      kind: z.string().optional().describe("hinge (default) | weld | motor | spring | prismatic | ball | rope | rod."),
      a: z.string().optional().describe("First BasePart name."),
      b: z.string().optional().describe("Second BasePart name."),
      offsetA: z.array(z.number()).length(3).optional().describe("Attachment offset inside a."),
      offsetB: z.array(z.number()).length(3).optional().describe("Attachment offset inside b."),
      axis: z.array(z.number()).length(3).optional().describe("Hinge/prismatic axis, e.g. [0,1,0] for a door."),
      limits: z.boolean().optional().describe("hinge: enable angle limits."),
      lower: z.number().optional().describe("hinge: LowerAngle degrees."),
      upper: z.number().optional().describe("hinge: UpperAngle degrees."),
      motor: z.boolean().optional().describe("hinge: drive it as a motor."),
      velocity: z.number().optional().describe("hinge motor: AngularVelocity."),
      torque: z.number().optional().describe("hinge motor: MotorMaxTorque."),
      name: z.string().optional(),
      target: z.string().optional().describe("remove/list: scope. Default workspace."),
    },
  },
  async (a) => run("constraint", a)
);

// --- batch: many build/edit ops as one undo step + one round trip -----------
// Batch op args are passthrough (each op is {action, args}) — validate build ops against
// the SAME spec schema rbx_build uses, so a malformed op (bad size, unknown kind) is
// rejected here with an actionable message + op index instead of reaching the plugin and
// throwing a cryptic error (or worse, silently building wrong geometry through the

registerTool(
  "rbx_batch",
  {
    title: "Batch build/edit (one undo)",
    description:
      "Run several build/edit ops in ONE call = one undo step + one round trip (place N props, multi-edit a model). " +
      "ops: [{action:'build'|'edit', args:{...}}] where for a build op args is the spec FIELDS DIRECTLY (e.g. {kind:'slab',center:[x,y,z],size:[w,h,d]}) — NOT wrapped in {spec:...} like rbx_build; prop parts may use op:'union'|'subtract'|'intersect' (negate:true aliases subtract); for an edit op args is exactly what rbx_edit takes. " +
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
      const validated = validateBatchOps(a.ops);
      return textResult(await bridge.sendCommand("batch", { ops: validated }, 120_000));
    } catch (e) {
      return errResult(e);
    }
  }
);

// --- stage: build ops previewed live in a browser BEFORE touching Studio -----
// Reuses validateBatchOps (same as rbx_batch) so a staged op is guaranteed byte-identical
// to what rbx_batch would send Studio — no separate translation step to drift out of sync.
type StagedOp = StageOp;
const stageSessions = new StageSessionRegistry();
const libraryStore = new LibraryStore(LIBRARY_DIR);
const stageRenderer = new StageRenderer({
  viewerUrl: `http://127.0.0.1:${VIEWER_PORT}/stage.html`,
  maxPages: 6,
});
let stageReady = false;

type StageRuntime = {
  id: string;
  state: StageState;
  manualOps: StageOp[];
  history: StageHistory;
  revision: number;
  dirty: boolean;
  csgMax: number;
  clients: Set<import("node:http").ServerResponse>;
};

const stageRuntimes = new Map<string, StageRuntime>();
let latestGenerations: Parameters<StageState["setGenerations"]>[0] = [];

function stageRuntime(value?: unknown): StageRuntime {
  const id = stageSessionId(value);
  const existing = stageRuntimes.get(id);
  if (existing) {
    stageSessions.get(id);
    return existing;
  }
  let state: StageState;
  try {
    state = stageSessions.get(id);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("maximum of")) throw error;
    const activity = new Map(stageSessions.list().map((session) => [session.id, session.lastActive]));
    const evict = [...stageRuntimes.values()]
      .filter((runtime) => runtime.id !== "default" && runtime.clients.size === 0)
      .sort((a, b) => (activity.get(a.id) ?? 0) - (activity.get(b.id) ?? 0))[0];
    if (!evict) throw error;
    stageRuntimes.delete(evict.id);
    stageSessions.remove(evict.id);
    state = stageSessions.get(id);
  }
  const runtime: StageRuntime = {
    id,
    state,
    manualOps: [],
    history: new StageHistory(),
    revision: 0,
    dirty: false,
    csgMax: 100,
    clients: new Set(),
  };
  runtime.state.setGenerations(latestGenerations);
  stageRuntimes.set(id, runtime);
  return runtime;
}

type StageBounds = { min: number[]; max: number[] };

function finiteVec3(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const result = value.map(Number);
  return result.every(Number.isFinite) ? result : null;
}

function includeStageBounds(current: StageBounds | null, center: number[], size: number[]): StageBounds {
  const half = size.map((value) => Math.abs(value) / 2);
  const min = center.map((value, index) => value - half[index]);
  const max = center.map((value, index) => value + half[index]);
  if (!current) return { min, max };
  return {
    min: current.min.map((value, index) => Math.min(value, min[index])),
    max: current.max.map((value, index) => Math.max(value, max[index])),
  };
}

function stageOpBounds(op: StageOp): StageBounds | null {
  if (op.action !== "build") return null;
  const args = op.args;
  const center = finiteVec3(args.center);
  if (!center) return null;
  if (Array.isArray(args.parts)) {
    let bounds: StageBounds | null = null;
    for (const rawPart of args.parts) {
      if (!rawPart || typeof rawPart !== "object" || Array.isArray(rawPart)) continue;
      const part = rawPart as Record<string, unknown>;
      const size = finiteVec3(part.size);
      if (!size || size.some((value) => value <= 0)) continue;
      const offset = finiteVec3(part.pos) ?? [0, 0, 0];
      bounds = includeStageBounds(bounds, center.map((value, index) => value + offset[index]), size);
    }
    return bounds;
  }
  const size = finiteVec3(args.size);
  return size && size.every((value) => value > 0) ? includeStageBounds(null, center, size) : null;
}

function stageOpStatus(op: StageOp, index: number) {
  if (op.action !== "build") return { index, action: op.action, renderable: false, empty: false, bounds: null };
  const kind = typeof op.args.kind === "string" ? op.args.kind : undefined;
  const name = typeof op.args.name === "string" ? op.args.name : undefined;
  const hasParts = Array.isArray(op.args.parts) && op.args.parts.length > 0;
  const hasPreset = kind === "prop" && typeof op.args.prop === "string" && op.args.prop.trim() !== "";
  const empty = !kind || (kind === "prop" && !hasParts && !hasPreset);
  return {
    index,
    action: op.action,
    ...(kind ? { kind } : {}),
    ...(name ? { name } : {}),
    renderable: !empty,
    empty,
    bounds: stageOpBounds(op),
    ...(empty ? { reason: kind === "prop" ? "prop has no preset or parts" : "build has no kind" } : {}),
  };
}

function stageStatusSummary(stage: StageRuntime, detail = false) {
  const snapshot = stage.state.snapshot();
  const ops = snapshot.ops;
  const details = ops.map(stageOpStatus);
  const builds = details.filter((op) => op.action === "build");
  const knownBounds = builds.map((op) => op.bounds).filter((value): value is StageBounds => value !== null);
  const combined = knownBounds.reduce<StageBounds | null>((current, value) => includeStageBounds(current, value.min.map((n, i) => (n + value.max[i]) / 2), value.max.map((n, i) => n - value.min[i])), null);
  const history = stage.history.serialize();
  const historyPosition = history.history.findIndex((entry) => entry.current);
  const empty = details.filter((op) => op.empty);
  const bounds = combined
    ? {
        min: combined.min,
        max: combined.max,
        center: combined.min.map((value, index) => (value + combined.max[index]) / 2),
        size: combined.min.map((value, index) => combined.max[index] - value),
      }
    : null;
  return {
    session: stage.id,
    revision: stage.revision,
    dirty: stage.dirty,
    pending: {
      commit: stage.dirty,
      undo: historyPosition > 0,
      redo: historyPosition >= 0 && historyPosition < history.history.length - 1,
    },
    ops: {
      total: ops.length,
      builds: builds.length,
      edits: ops.length - builds.length,
      renderable: builds.filter((op) => op.renderable).length,
      empty: empty.length,
      emptyIndices: empty.slice(0, 20).map((op) => op.index),
      ...(empty.length > 20 ? { emptyIndicesTruncated: true } : {}),
      ...(detail ? { details } : {}),
    },
    generators: snapshot.generations.map((generation) => ({
      name: generation.name,
      enabled: generation.enabled,
      ops: generation.ops.length,
      ...(generation.error ? { error: generation.error } : {}),
    })),
    errors: snapshot.errors,
    bounds,
    boundsComplete: builds.every((op) => op.bounds !== null),
    history: { index: history.index, entries: history.history.length },
  };
}

function stageSnapshot(stage: StageRuntime) {
  return { ...stage.state.snapshot(), session: stage.id, revision: stage.revision };
}

function captureStageEdit(stage: StageRuntime): StageEditState {
  const enabled: Record<string, boolean> = {};
  for (const generation of stage.state.snapshot().generations) enabled[generation.name] = generation.enabled;
  return { manualOps: structuredClone(stage.manualOps), enabled };
}

function setManualStage(stage: StageRuntime, ops: StageOp[]) {
  stage.manualOps = structuredClone(ops);
  stage.state.clearManual();
  stage.state.appendManual(stage.manualOps);
}

function restoreStageEdit(stage: StageRuntime, state: StageEditState) {
  setManualStage(stage, state.manualOps);
  for (const generation of stage.state.snapshot().generations) {
    const enabled = state.enabled[generation.name];
    if (typeof enabled === "boolean") stage.state.setGenerationEnabled(generation.name, enabled);
  }
}

function mutateStage(stage: StageRuntime, change: () => void, label = "Stage edit"): boolean {
  const before = captureStageEdit(stage);
  change();
  const after = captureStageEdit(stage);
  return stage.history.record(before, after, label);
}

function parseStageOps(value: unknown): StageOp[] {
  if (!Array.isArray(value)) throw new Error("stage ops must be an array");
  const raw = value.map((op, index) => {
    if (!op || typeof op !== "object" || Array.isArray(op)) throw new Error(`stage op ${index + 1} must be an object`);
    const item = op as Record<string, unknown>;
    if (item.action !== "build" && item.action !== "edit") throw new Error(`stage op ${index + 1} has an invalid action`);
    if (!item.args || typeof item.args !== "object" || Array.isArray(item.args)) throw new Error(`stage op ${index + 1} args must be an object`);
    return { action: item.action, args: item.args as Record<string, unknown> } as StagedOp;
  });
  const parts = raw.reduce((total, op) => total + (Array.isArray(op.args.parts) ? op.args.parts.length : 0), 0);
  if (raw.length + parts > MAX_STAGE_ITEMS) throw new Error(`stage ops exceed the ${MAX_STAGE_ITEMS}-item cap`);
  return validateBatchOps(raw).map((op) => ({ action: op.action, args: { ...(op.args as Record<string, unknown>) } }));
}

// Stage-wide CSG part budget, settable from the viewer. An op that names its own csgMax
// keeps it — the per-op value always wins over the global default.
function applyCsgMax(stage: StageRuntime, ops: StageOp[]): StageOp[] {
  return ops.map((op) => {
    if (op.action !== "build") return op;
    const args = op.args as Record<string, unknown>;
    if (!args?.csg || args.csgMax !== undefined) return op;
    return { action: op.action, args: { ...args, csgMax: stage.csgMax } };
  });
}

async function commitStage(stage: StageRuntime, origin: "user" | "ai"): Promise<unknown> {
  const ops = applyCsgMax(stage, stage.state.getOps());
  if (ops.length === 0) throw new Error("nothing staged — add a generator file or call rbx_stage_build first");
  const commitRevision = stage.revision;
  const result = await bridge.sendCommand("batch", { ops }, 120_000);
  const recent = await saveRecentGeneration(`stage-${new Date().toISOString().replace(/[:.]/g, "-")}`, ops, origin);
  if (stage.revision === commitRevision) stage.dirty = false;
  return { result, recent };
}

async function saveRecentGeneration(name: string, ops: StageOp[], origin: "user" | "ai") {
  const entry = await libraryStore.save({
    name,
    ops,
    origin,
    kind: "recent",
    filename: `recent-${randomUUID()}`,
  });
  return { ...entry, id: entry.file };
}

const liveClients = new Set<import("node:http").ServerResponse>();
function liveBroadcast(event: string, data: unknown) {
  const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of liveClients) {
    if (res.writableEnded) {
      liveClients.delete(res);
      continue;
    }
    res.write(chunk);
  }
}
function broadcastStage(stage: StageRuntime) {
  stage.revision += 1;
  if (stageReady) stage.dirty = true;
  const send = (event: string, data: unknown) => {
    const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of stage.clients) {
      if (res.writableEnded) stage.clients.delete(res);
      else res.write(chunk);
    }
  };
  send("stage-sync", stageSnapshot(stage));
  send("stage-history", stage.history.serialize());
}

const generatorWatcher = new GeneratorWatcher(GENERATORS_DIR, {
  onChange: (states) => {
    latestGenerations = states;
    for (const stage of stageRuntimes.values()) {
      stage.state.setGenerations(states);
      broadcastStage(stage);
    }
  },
  onError: (error) => console.error("[buildkit] generator watcher error:", error),
});

type AppliedMapState = {
  rules: MapPlacementRule[];
  lastApply: string;
  result: unknown;
};

const mapStates = new Map<string, MapFileState>();
const appliedMaps = new Map<string, AppliedMapState>();
let mapAutoApply = false;
let mapApplyTail: Promise<void> = Promise.resolve();

type GroundTargetState = {
  target: string;
  name: string;
  class: string;
  place: string | null;
};

let currentGroundTarget: GroundTargetState | null = null;

function groundTargetName(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("ground target must be a non-empty instance path or name");
  const target = value.trim();
  if (target.length > 512) throw new Error("ground target is too long");
  return target;
}

async function validateGroundTarget(value: unknown): Promise<GroundTargetState> {
  const requested = groundTargetName(value);
  const description = await bridge.sendCommand("describe", { target: requested, depth: 0 }, 30_000);
  if (!description || typeof description !== "object") throw new Error("ground target describe returned no instance");
  const detail = description as Record<string, unknown>;
  const isBasePart = detail.isBasePart === true || detail.anchored !== undefined;
  const isModel = detail.isModel === true || detail.class === "Model";
  if (!isBasePart && !isModel) throw new Error("ground target must be a BasePart or Model with geometry");
  if (detail.hasGeometry === false) throw new Error("ground target must contain geometry");
  if (typeof detail.name !== "string" || typeof detail.class !== "string") throw new Error("ground target describe returned an invalid instance");
  return {
    target: typeof detail.path === "string" && detail.path ? detail.path : requested,
    name: detail.name,
    class: detail.class,
    place: bridge.getActivePlace(),
  };
}

function groundTargetStatus() {
  if (currentGroundTarget) {
    const storedPlace = currentGroundTarget.place?.trim().toLowerCase() ?? null;
    const activePlace = bridge.getActivePlace()?.trim().toLowerCase() ?? null;
    if (storedPlace !== activePlace) currentGroundTarget = null;
  }
  return { groundTarget: currentGroundTarget };
}

async function groundTargetAction(mode: unknown, target?: unknown) {
  if (mode === "get") return { mode, ...groundTargetStatus() };
  if (mode === "clear") {
    currentGroundTarget = null;
    return { mode, ...groundTargetStatus() };
  }
  if (mode !== "set") throw new Error("ground target mode must be set, clear, or get");
  const next = await validateGroundTarget(target);
  currentGroundTarget = next;
  return { mode, ...groundTargetStatus() };
}

function mapHasChanges(diff: ReturnType<typeof diffMapRules>) {
  return diff.added + diff.changed + diff.removed > 0;
}

function mapStatusSummary() {
  return {
    directory: MAPS_DIR,
    autoApply: mapAutoApply,
    ...groundTargetStatus(),
    maps: [...mapStates.values()].map((state) => {
      const applied = appliedMaps.get(state.name);
      const diff = diffMapRules(applied?.rules ?? [], state.rules);
      return {
        name: state.name,
        rules: state.rules.length,
        ...(state.error ? { error: state.error } : {}),
        applied: !!applied,
        ...(applied ? { lastApply: applied.lastApply } : {}),
        pending: mapHasChanges(diff),
      };
    }),
  };
}

function queueMapApply<T>(work: () => Promise<T>): Promise<T> {
  const request = mapApplyTail.then(work, work);
  mapApplyTail = request.then(() => undefined, () => undefined);
  return request;
}

async function applyMapFile(name: string, rules: readonly MapPlacementRule[]) {
  return queueMapApply(async () => {
    const previous = appliedMaps.get(name)?.rules ?? [];
    const nextRules = structuredClone(rules) as MapPlacementRule[];
    const groundTarget = groundTargetStatus().groundTarget;
    const diff = diffMapRules(previous, nextRules);
    const checkpointName = `BuildKitMap_${name.replace(/[^A-Za-z0-9_.-]/g, "_")}_${Date.now()}`;
    await bridge.sendCommand("checkpoint", { mode: "save", name: checkpointName, target: "Workspace" }, 60_000);
    const result = await bridge.sendCommand("map_apply", {
      map: name,
      rules: nextRules,
      groundTarget: groundTarget?.target ?? null,
    }, 120_000);
    appliedMaps.set(name, { rules: nextRules, lastApply: new Date().toISOString(), result });
    liveBroadcast("map-sync", mapStatusSummary());
    return { ok: true, file: name, diff, groundTarget, result };
  });
}

function mapNameFromInput(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    const name = value.trim();
    if (!mapStates.has(name)) throw new Error(`map file not found: ${name}`);
    return name;
  }
  const names = [...mapStates.keys()];
  if (names.length === 0) throw new Error(`no map files in ${MAPS_DIR}`);
  if (names.length !== 1) throw new Error("map file is required when more than one map/*.js file exists");
  return names[0];
}

async function applyCurrentMap(name: string) {
  const state = mapStates.get(name);
  if (!state) throw new Error(`map file not found: ${name}`);
  if (state.error) throw new Error(state.error);
  return applyMapFile(name, state.rules);
}

async function autoApplyMaps(states: MapFileState[], removed: string[]) {
  if (!mapAutoApply) return;
  for (const state of states) {
    if (state.error) continue;
    const previous = appliedMaps.get(state.name)?.rules ?? [];
    if (appliedMaps.has(state.name) && !mapHasChanges(diffMapRules(previous, state.rules))) continue;
    await applyMapFile(state.name, state.rules);
  }
  for (const name of removed) {
    if (appliedMaps.has(name)) await applyMapFile(name, []);
  }
}

const mapWatcher = new MapWatcher(MAPS_DIR, {
  onChange: async (states, removed) => {
    mapStates.clear();
    for (const state of states) mapStates.set(state.name, state);
    liveBroadcast("map-sync", mapStatusSummary());
    await autoApplyMaps(states, removed);
  },
  onError: (error) => console.error("[buildkit] map watcher error:", error),
});

registerTool(
  "rbx_map_status",
  {
    title: "Read declarative map status",
    description: "List repo-local map/*.js files, rule counts, parse errors, pending changes, and the explicit auto-apply state.",
    inputSchema: {},
  },
  async () => textResult(mapStatusSummary()),
);

registerTool(
  "rbx_map_apply",
  {
    title: "Apply one declarative map",
    description: "Checkpoint Studio, then replace this map file's owned MapPlacements groups in one recorded operation. Omit file only when exactly one map file exists.",
    inputSchema: { file: z.string().min(1).optional().describe("map/*.js filename; omit only when there is one map file") },
  },
  async (args) => {
    try {
      return textResult(await applyCurrentMap(mapNameFromInput(args.file)));
    } catch (error) {
      return errResult(error);
    }
  },
);

registerTool(
  "rbx_map_auto_apply",
  {
    title: "Toggle declarative map auto-apply",
    description: "Explicitly enable or disable applying valid map/*.js edits as they are saved. Defaults OFF; enabling applies current valid maps once.",
    inputSchema: { enabled: z.boolean().describe("true enables the file watcher to apply valid map edits") },
  },
  async (args) => {
    try {
      mapAutoApply = args.enabled;
      if (mapAutoApply) await autoApplyMaps([...mapStates.values()], []);
      return textResult(mapStatusSummary());
    } catch (error) {
      return errResult(error);
    }
  },
);

registerTool(
  "rbx_ground_part",
  {
    title: "Set the map ground target",
    description: "Set, clear, or read the in-memory BasePart/Model used by grounded rbx_place and map placements. Setting validates the target through Studio's describe route; it is cleared by restarting this bridge.",
    inputSchema: z.object({
      mode: z.enum(["set", "clear", "get"]),
      target: z.string().min(1).max(512).optional().describe("set: full instance path preferred; an unambiguous instance name is also accepted."),
    }).superRefine((args, ctx) => {
      if (args.mode === "set" && args.target === undefined) {
        ctx.addIssue({ code: "custom", path: ["target"], message: "set requires target" });
      }
      if (args.mode !== "set" && args.target !== undefined) {
        ctx.addIssue({ code: "custom", path: ["target"], message: "target is only valid with mode='set'" });
      }
    }),
  },
  async (args) => {
    try {
      return textResult(await groundTargetAction(args.mode, args.target));
    } catch (error) {
      return errResult(error);
    }
  },
);

function conformanceProfileFile(value: unknown): { name: string; path: string } {
  if (typeof value !== "string") throw new Error("profile must be a safe name");
  const name = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) {
    throw new Error("profile must be a safe name (letters, numbers, ., _ and - only)");
  }
  const profilePath = path.resolve(PROFILES_DIR, `${name}.json`);
  const relative = path.relative(PROFILES_DIR, profilePath);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("profile path must stay inside the repo-local profiles directory");
  }
  return { name, path: profilePath };
}

function conformanceSummary(profile: ConformanceProfile) {
  return {
    coverage: profile.coverage,
    incomplete: profile.incomplete,
    partCount: profile.partCount,
    capturedPartCount: profile.capturedPartCount,
    bounds: profile.bounds,
  };
}

async function freshConformanceSnapshot(target: string | undefined, maxParts: number | undefined) {
  const scope = normalizeSyncScope({ target, lod: "parts", maxParts });
  const dump = await bridge.sendCommand("scene_dump", scope, 30_000) as SceneDump;
  return { dump, profile: createConformanceProfile(dump) };
}

async function readConformanceProfile(value: unknown) {
  const file = conformanceProfileFile(value);
  const raw = await readFile(file.path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`profile '${file.name}' is not valid JSON`);
  }
  return { ...file, profile: validateConformanceProfile(parsed) };
}

const CONFORMANCE_TOLERANCE = z.union([
  z.number().nonnegative(),
  z.object({
    partCount: z.number().nonnegative().optional(),
    bounds: z.number().nonnegative().optional(),
    materialShare: z.number().nonnegative().optional(),
    classCount: z.number().nonnegative().optional(),
    part: z.number().nonnegative().optional(),
  }),
]);

registerTool(
  "rbx_conformance",
  {
    title: "Capture or check a scene conformance profile",
    description:
      "Capture a fresh bounded Studio scene profile into repo-local profiles/, or check a fresh scene against a saved profile or a second live target. " +
      "Checks are never clean when either snapshot is truncated or missing.",
    inputSchema: {
      mode: z.enum(["capture", "check"]).describe("capture saves a profile; check compares a fresh scene"),
      target: z.string().min(1).optional().describe("Actual scene target; omit for Workspace."),
      referenceTarget: z.string().min(1).optional().describe("Live reference target for check mode; mutually exclusive with profile."),
      profile: z.string().min(1).optional().describe("Safe repo-local profile name, without .json."),
      maxParts: z.number().int().min(1).max(MAX_SYNC_PARTS).optional().describe("Maximum parts read per snapshot (cap 800)."),
      tolerance: CONFORMANCE_TOLERANCE.optional().describe("One non-negative tolerance, or per-metric tolerances."),
    },
  },
  async (args) => {
    try {
      if (args.mode === "capture") {
        const file = conformanceProfileFile(args.profile);
        const current = await freshConformanceSnapshot(args.target, args.maxParts);
        await mkdir(PROFILES_DIR, { recursive: true });
        await writeAtomicFile(file.path, serializeConformanceProfile(current.profile));
        return textResult({ mode: "capture", profile: file.name, path: file.path, ...conformanceSummary(current.profile) });
      }

      const hasProfile = args.profile !== undefined;
      const hasReferenceTarget = args.referenceTarget !== undefined;
      if (hasProfile === hasReferenceTarget) {
        throw new Error("check mode requires exactly one of profile or referenceTarget");
      }

      const current = await freshConformanceSnapshot(args.target, args.maxParts);
      const reference = hasProfile
        ? await readConformanceProfile(args.profile)
        : { name: args.referenceTarget, profile: (await freshConformanceSnapshot(args.referenceTarget, args.maxParts)).profile };
      const report = compareConformance(current.profile, reference.profile, { tolerance: args.tolerance });
      return textResult({
        mode: "check",
        ...(hasProfile ? { profile: reference.name } : { referenceTarget: reference.name }),
        actual: conformanceSummary(current.profile),
        reference: conformanceSummary(reference.profile),
        report,
      });
    } catch (error) {
      return errResult(error);
    }
  },
);

registerTool(
  "rbx_library_save",
  {
    title: "Save staged prop ops to the AI library",
    description: "Persist validated prop build ops in the shared library without touching Roblox Studio.",
    inputSchema: {
      name: z.string().min(1),
      ops: z.array(z.object({ action: z.enum(["build", "edit"]), args: z.object({}).passthrough() })),
      category: z.string().min(1).optional(),
    },
  },
  async (args) => {
    try {
      const ops = parseStageOps(args.ops);
      const preview = libraryPreview(ops);
      const entry = await libraryStore.save({ name: args.name, ops, preview: preview ? JSON.stringify(preview) : undefined, origin: "ai", kind: "saved", category: args.category ?? null });
      return textResult(entry);
    } catch (error) {
      return errResult(error);
    }
  },
);

registerTool(
  "rbx_library_list",
  {
    title: "List saved and recent library props",
    description: "Refresh the persistent prop library, optionally filtering by origin, kind, or category.",
    inputSchema: {
      origin: z.enum(["user", "ai"]).optional(),
      kind: z.enum(["saved", "recent"]).optional(),
      category: z.string().optional(),
    },
  },
  async (args) => {
    let entries = await libraryStore.discover();
    if (args.origin) entries = entries.filter((entry) => entry.origin === args.origin);
    if (args.kind) entries = entries.filter((entry) => entry.kind === args.kind);
    if (args.category !== undefined) entries = entries.filter((entry) => entry.category === (args.category || null));
    return textResult({ entries, categories: libraryStore.listCategories() });
  },
);

registerTool(
  "rbx_library_category_create",
  {
    title: "Create an AI library category",
    description: "Create or return a persistent library category. Category deletion remains viewer-only.",
    inputSchema: { name: z.string().min(1) },
  },
  async (args) => {
    try {
      return textResult(await libraryStore.createCategory(args.name, "ai"));
    } catch (error) {
      return errResult(error);
    }
  },
);

registerTool(
  "rbx_stage_build",
  {
      title: "Stage build ops in the live three.js preview (no Studio round-trip)",
      description:
      "Validates ops (same rules as rbx_batch) and appends them after the enabled generator files, broadcast live to any open " +
      "viewer/stage.html tab. Does NOT touch Studio — free, instant iteration. Only kind:'prop' (raw parts) renders " +
      "with real geometry in the preview; other kinds show as a labeled bbox placeholder (their fine detail only " +
      "exists in the Studio-side builders). Call rbx_stage_commit when the layout looks right.",
    inputSchema: {
      session: z.string().optional().describe("Independent stage session id. Default 'default'."),
      ops: z
        .array(z.object({ action: z.enum(["build", "edit"]), args: z.object({}).passthrough() }))
        .describe("Same shape as rbx_batch's ops."),
    },
  },
  async (a) => {
    try {
      const stage = stageRuntime(a.session);
      const validated = parseStageOps(a.ops);
      mutateStage(stage, () => setManualStage(stage, [...stage.manualOps, ...validated]), "Stage build");
      broadcastStage(stage);
      return textResult(`staged ${validated.length} ops (${stage.state.getOps().length} total) at http://localhost:${VIEWER_PORT}/stage.html?session=${encodeURIComponent(stage.id)}`);
    } catch (e) {
      return errResult(e);
    }
  }
);

registerTool(
  "rbx_stage_clear",
  {
    title: "Clear the staged build (reset the live preview)",
    description: "Clears manual stage ops while keeping enabled generator files live; tells open viewer/stage.html tabs to resync. Studio is untouched.",
    inputSchema: { session: z.string().optional().describe("Independent stage session id. Default 'default'.") },
  },
  async (a) => {
    const stage = stageRuntime(a.session);
    mutateStage(stage, () => setManualStage(stage, []), "Clear stage");
    broadcastStage(stage);
    return textResult("stage cleared");
  }
);

registerTool(
  "rbx_stage_commit",
  {
    title: "Commit the staged build into real Studio",
    description:
      "Sends every enabled generator op plus manual staged ops into Studio as one atomic batch (identical to calling rbx_batch with the same ops) — " +
      "the exact same 'batch' bridge call rbx_batch makes, so what you saw staged is what gets built. Studio must be connected for this call only (staging itself works offline).",
    inputSchema: { session: z.string().optional().describe("Independent stage session id. Default 'default'.") },
  },
  async (a) => {
    try {
      return textResult(await commitStage(stageRuntime(a.session), "ai"));
    } catch (e) {
      return errResult(e);
    }
  }
);

registerTool(
  "rbx_stage_status",
  {
    title: "Read staged build status",
    description:
      "Return a compact summary of the browser stage without the full ops payload: revision, renderable/empty build counts, generator enabled/error state, approximate bounds, dirty/pending commit state, and undo/redo availability. Set detail=true for per-op summaries.",
    inputSchema: {
      session: z.string().optional().describe("Independent stage session id. Default 'default'."),
      detail: z.boolean().optional().describe("Include per-op kind/name/renderability details. Default false."),
    },
  },
  async (a) => textResult(stageStatusSummary(stageRuntime(a.session), a.detail === true)),
);

registerTool(
  "rbx_stage_render",
  {
    title: "Render a headless Stage session",
    description: "Capture the browser Stage for a session without touching Roblox Studio. Reuses one headless browser and an idle-cleaned page per session.",
    inputSchema: {
      session: z.string().optional().describe("Independent stage session id. Default 'default'."),
      angles: z.array(z.object({ azimuth: z.number(), elevation: z.number() })).min(1).max(8).optional(),
    },
  },
  async (args) => {
    try {
      const session = stageSessionId(args.session);
      stageRuntime(session);
      const images = await stageRenderer.render(session, args.angles);
      return {
        content: images.flatMap((image, index) => [
          { type: "image" as const, data: image.toString("base64"), mimeType: "image/png" },
          ...(images.length > 1 ? [{ type: "text" as const, text: `angle ${index + 1}/${images.length}` }] : []),
        ]),
      };
    } catch (error) {
      return errResult(error);
    }
  },
);

// --- describe: compact text scene readback (cheap "eyes") --------------------


// --- scene_dump: flat pos+rotation+shape+color dump for the three.js mirror viewer -
const VIEWER_DIR = path.resolve(__dirname, "..", "viewer");
const ASSET_CACHE_DIR = path.join(VIEWER_DIR, ".assetcache");
const DEFAULT_LIVE_SYNC_INTERVAL_MS = 1_500;
let mirrorContentJson: string | null = null;
let mirrorDump: Record<string, unknown> | null = null;
let mirrorRevision = 0;
const mirrorClientOverrides = new Map<string, MirrorTransform>();
let mirrorWriteTail: Promise<void> = Promise.resolve();

function withoutMirrorRevision(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const copy = structuredClone(value) as Record<string, unknown>;
  delete copy._buildkitMirrorRevision;
  return copy;
}

async function loadMirrorFromDisk() {
  if (mirrorDump) return;
  try {
    const raw = await readFile(path.join(VIEWER_DIR, "scene.json"), "utf8");
    const parsed = JSON.parse(raw);
    const dump = withoutMirrorRevision(parsed);
    if (!dump || !Array.isArray(dump.parts)) return;
    mirrorDump = parsed as Record<string, unknown>;
    mirrorContentJson = JSON.stringify(dump);
    const revision = Number((parsed as Record<string, unknown>)._buildkitMirrorRevision);
    if (Number.isInteger(revision) && revision >= 0) mirrorRevision = revision;
  } catch {
    // The first plugin push or scene_dump seeds the mirror when no file exists yet.
  }
}

async function writeMirror(dump: unknown, notify: boolean, acknowledge = notify) {
  const overlay = overlayMirrorTransforms(dump, [...mirrorClientOverrides.values()], acknowledge);
  for (const target of [...overlay.acknowledged, ...overlay.missing]) mirrorClientOverrides.delete(target);
  const candidate = withoutMirrorRevision(overlay.dump);
  if (!candidate || !Array.isArray(candidate.parts)) return false;
  const contentJson = JSON.stringify(candidate) ?? "null";
  if (contentJson === mirrorContentJson) return false;
  mirrorRevision += 1;
  const published = { ...candidate, _buildkitMirrorRevision: mirrorRevision };
  const json = JSON.stringify(published) ?? "null";
  mirrorDump = published;
  mirrorContentJson = contentJson;
  const write = mirrorWriteTail.then(async () => {
    await mkdir(VIEWER_DIR, { recursive: true });
    await writeAtomicFile(path.join(VIEWER_DIR, "scene.json"), json);
    if (notify) liveBroadcast("mirror-sync", published);
  });
  mirrorWriteTail = write.catch(() => {});
  await write;
  return true;
}

function currentMirrorSnapshot(): Record<string, unknown> | null {
  return mirrorDump ? structuredClone(mirrorDump) as Record<string, unknown> : null;
}

bridge.setMirrorHandler(async (place, dump) => {
  const activePlace = bridge.getActivePlace();
  if (activePlace && !place.toLowerCase().includes(activePlace.toLowerCase())) return false;
  await writeMirror(dump, true, true);
  return true;
});

registerTool(
  "rbx_scene_dump",
  {
    title: "Dump scene for the local three.js mirror viewer",
    description:
      "Writes an exact flat part dump (position/rotation/shape/color/material, NOT just AABB) to viewer/scene.json. " +
      `Open http://localhost:${VIEWER_PORT}/stage.html?mirror=1 for a free-camera local render — cheaper than a screenshot, no Studio foreground needed. ` +
      "The mirror supports move/rotate/scale on dumped BaseParts; those transforms are sent to Studio as one undoable edit.",
    inputSchema: {
      target: z.string().optional().describe("Instance full path preferred; an unambiguous name is also accepted. Omit = whole workspace."),
      region: z
        .union([
          z.object({ center: z.array(z.number()).length(3), radius: z.number().positive() }),
          z.object({ min: z.array(z.number()).length(3), max: z.array(z.number()).length(3) }),
        ])
        .optional()
        .describe("Optional world scope: center/radius or min/max."),
      lod: z.enum(["parts", "bbox"]).optional().describe("parts sends leaves; bbox sends one box for the scope."),
      maxParts: z.number().int().min(1).max(MAX_SYNC_PARTS).optional().describe("Maximum parts in the snapshot (cap 800)."),
    },
  },
  async (a) => {
    try {
      const scope = normalizeSyncScope({ target: a.target, region: a.region, lod: a.lod, maxParts: a.maxParts });
      const dump = await bridge.sendCommand("scene_dump", scope, 30_000);
      await writeMirror(dump, false);
      const d = dump as any;
      return textResult(
        `wrote ${d.dumped}/${d.totalParts} parts to viewer/scene.json` +
          (d.truncated ? " (truncated — target has more parts than the 800 cap, narrow the target)" : "")
      );
    } catch (e) {
      return errResult(e);
    }
  }
);

registerTool(
  "rbx_live_sync_start",
  {
    title: "Start live Studio mirror sync",
    description:
      "Enables the plugin-side Studio→browser autosync and sets its snapshot interval. The plugin reads the Edit datamodel " +
      "directly and pushes changed scene dumps to the local bridge; browser stage→Studio still requires rbx_stage_commit.",
    inputSchema: {
      intervalMs: z.number().int().min(100).max(60_000).optional().describe("Polling interval in milliseconds. Default 1500."),
      target: z.string().optional().describe("Optional instance name to mirror instead of the whole workspace."),
      region: z
        .union([
          z.object({ center: z.array(z.number()).length(3), radius: z.number().positive() }),
          z.object({ min: z.array(z.number()).length(3), max: z.array(z.number()).length(3) }),
        ])
        .optional()
        .describe("Optional world scope: center/radius or min/max."),
      lod: z.enum(["parts", "bbox"]).optional().describe("parts sends leaves; bbox sends one box for the scope."),
      maxParts: z.number().int().min(1).max(MAX_SYNC_PARTS).optional().describe("Maximum parts in each snapshot (cap 800)."),
    },
  },
  async (a) => {
    try {
      const payload = liveSyncPayload(
        { target: a.target, region: a.region, lod: a.lod, maxParts: a.maxParts },
        a.intervalMs ?? DEFAULT_LIVE_SYNC_INTERVAL_MS,
      );
      const status = await bridge.sendCommand("live_sync", payload, 30_000);
      return textResult({ ...status, viewer: `http://localhost:${VIEWER_PORT}/index.html` });
    } catch (e) {
      return errResult(e);
    }
  }
);

registerTool(
  "rbx_live_sync_stop",
  {
    title: "Stop live Studio mirror sync",
    description: "Disables the plugin-side Studio→browser autosync. The last mirror remains available in viewer/scene.json.",
    inputSchema: {},
  },
  async () => {
    try {
      const status = await bridge.sendCommand("live_sync", { enabled: false }, 30_000);
      return textResult(`plugin live sync stopped (${status.intervalMs}ms configured)`);
    } catch (e) {
      return errResult(e);
    }
  }
);

type DumpPart = Record<string, any>;

function globMatch(value: string, pattern?: string): boolean {
  if (!pattern) return true;
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*").replace(/\\\?/g, ".");
  return new RegExp(`^${escaped}$`, "i").test(value);
}

function mapBounds(parts: DumpPart[]) {
  let min: number[] | undefined;
  let max: number[] | undefined;
  for (const part of parts) {
    if (!Array.isArray(part.pos) || !Array.isArray(part.size) || part.pos.length !== 3 || part.size.length !== 3) continue;
    const lo = part.pos.map((n: number, i: number) => n - Math.abs(part.size[i]) / 2);
    const hi = part.pos.map((n: number, i: number) => n + Math.abs(part.size[i]) / 2);
    min = min ? min.map((n, i) => Math.min(n, lo[i])) : lo;
    max = max ? max.map((n, i) => Math.max(n, hi[i])) : hi;
  }
  if (!min || !max) return null;
  const center = min.map((n, i) => (n + max![i]) / 2);
  return { center, size: min.map((n, i) => max![i] - n) };
}

function partInRegion(part: DumpPart, region: any): boolean {
  if (!region) return true;
  if (!Array.isArray(part.pos) || part.pos.length !== 3) return false;
  const position = part.pos.map(Number);
  if (!position.every(Number.isFinite)) return false;
  const size = Array.isArray(part.size) && part.size.length === 3
    ? part.size.map((value: number) => Math.abs(Number(value)) / 2)
    : [0, 0, 0];
  if (region.center) {
    const distance = position.reduce((sum, value, index) => {
      const delta = Math.max(Math.abs(value - Number(region.center[index])) - size[index], 0);
      return sum + delta * delta;
    }, 0);
    return distance <= Number(region.radius) ** 2;
  }
  return position.every((value, index) =>
    value + size[index] >= Number(region.min[index]) && value - size[index] <= Number(region.max[index]),
  );
}

async function getMapDump(filter: any) {
  if (filter.selection && (filter.target !== undefined || filter.region !== undefined)) {
    throw new Error("map selection cannot be combined with target or region");
  }
  const scope = normalizeSyncScope({ target: filter.target, region: filter.region, lod: filter.lod, maxParts: filter.maxParts });
  let dumps: any[];
  if (filter.selection) {
    const selected = await bridge.sendCommand("selection", { mode: "get" }, 30_000);
    const targets = Array.isArray(selected?.selection) ? selected.selection : [];
    dumps = await Promise.all(targets.map((entry: any) => bridge.sendCommand("scene_dump", { target: targetReference(entry), lod: scope.lod, maxParts: scope.maxParts }, 30_000)));
  } else {
    dumps = [await bridge.sendCommand("scene_dump", scope, 30_000)];
  }
  const tagPaths = filter.tag
    ? new Set<string>((await bridge.sendCommand("tag", { mode: "query", tag: filter.tag }, 30_000))?.instances ?? [])
    : undefined;
  const parts: DumpPart[] = dumps
    .flatMap((dump) => Array.isArray(dump?.parts) ? dump.parts : [])
    .filter((part: DumpPart) => {
      if (!partInRegion(part, filter.region)) return false;
      if (!globMatch(String(part.name ?? ""), filter.name)) return false;
      const className = filter.className ?? filter.class;
      if (className && String(part.class ?? "").toLowerCase() !== String(className).toLowerCase()) return false;
      if (filter.material && String(part.material ?? "").toLowerCase() !== String(filter.material).toLowerCase()) return false;
      if (tagPaths && ![...tagPaths].some((path) => String(part.path ?? "") === path || String(part.path ?? "").startsWith(`${path}.`))) return false;
      return true;
    });
  const counts = { classes: {} as Record<string, number>, materials: {} as Record<string, number> };
  for (const part of parts) {
    const cls = String(part.class ?? "Unknown");
    const mat = String(part.material ?? "Unknown");
    counts.classes[cls] = (counts.classes[cls] ?? 0) + 1;
    counts.materials[mat] = (counts.materials[mat] ?? 0) + 1;
  }
  const truncated = dumps.some((dump) => dump?.coverage === "truncated" || dump?.truncated === true || (Number(dump?.totalParts) || 0) > scope.maxParts);
  return {
    scope: filter.selection ? { target: "selection", lod: scope.lod, maxParts: scope.maxParts } : scope,
    totalParts: dumps.reduce((total, dump) => total + (Number(dump?.totalParts) || 0), 0),
    matchedParts: parts.length,
    truncated,
    coverage: dumps.some((dump) => dump?.coverage === "missing") ? "missing" : truncated ? "truncated" : "complete",
    bounds: mapBounds(parts),
    counts,
    parts,
    tree: dumps.length === 1 ? dumps[0]?.tree : undefined,
  };
}

registerTool(
  "rbx_map",
  {
    title: "Map the live place",
    description:
      "Read a scoped live scene as data. Filter by name glob, class, material, region, tag, or current Studio selection. " +
      "Returns counts, an approximate bounds box, samples by default, and full part details when detail='parts'.",
    inputSchema: {
      target: z.string().optional().describe("Instance full path preferred; an unambiguous name is also accepted."),
      name: z.string().optional().describe("Part name glob, e.g. 'Oak*'."),
      className: z.string().optional().describe("Exact Roblox class name."),
      material: z.string().optional().describe("Exact Roblox material name."),
      region: SYNC_REGION.optional().describe("World scope: center/radius or min/max."),
      tag: z.string().optional().describe("CollectionService tag."),
      selection: z.boolean().optional().describe("Map the current Studio selection."),
      lod: z.enum(["parts", "bbox"]).optional().describe("parts sends leaves; bbox sends one box per target."),
      maxParts: z.number().int().min(1).max(MAX_SYNC_PARTS).optional(),
      detail: z.enum(["summary", "parts"]).optional().describe("summary returns samples; parts returns every matched part."),
    },
  },
  async (a) => {
    try {
      const result = await getMapDump(a);
      const sample = result.parts.slice(0, 20).map(({ name, class: className, material, path, pos, size }: DumpPart) => ({ name, class: className, material, path, pos, size }));
      return textResult({ ...result, parts: a.detail === "parts" ? result.parts : undefined, sample });
    } catch (e) {
      return errResult(e);
    }
  },
);

async function captureView(options: any) {
  const target = options.target as string | undefined;
  const angles = Math.max(1, Math.min(24, Math.floor(options.angles ?? 1)));
  const elevation = options.elevation ?? 20;
  const zoom = options.zoom ?? 1.1;
  let saved: any = null;
  let isolateToken: string | null = null;
  try {
    if (options.isolate && target) {
      const isolated = await bridge.sendCommand("isolate", { target, mode: "on" }, 60_000);
      isolateToken = isolated?.token ?? null;
    }
    if (options.cutawayY !== undefined || options.cutaway === "roof") {
      await bridge.sendCommand(
        "cutaway",
        options.cutaway === "roof" ? { target, mode: "roof" } : { target, mode: "y", y: options.cutawayY },
        60_000,
      );
    }
    if (options.annotate && target) await bridge.sendCommand("annotate", { target, mode: "on" }, 60_000);
    if (options.contrast && target) await bridge.sendCommand("contrast", { target, mode: "on" }, 60_000);
    saved = await bridge.sendCommand("save_camera", {}, FRAME_MS);
    const content: any[] = [{ type: "text" as const, text: `view of ${target ?? "workspace"}` }];
    for (let i = 0; i < angles; i += 1) {
      const azimuth = Math.round((360 / angles) * i);
      if (angles === 1) {
        await bridge.sendCommand("frame", { target, view: options.view ?? "iso", zoom }, FRAME_MS);
      } else {
        await bridge.sendCommand("frame_dir", { target, azimuth, elevation, zoom }, FRAME_MS);
      }
      content.push({ type: "text" as const, text: angles === 1 ? `--- ${options.view ?? "iso"} ---` : `--- az ${azimuth}° el ${elevation}° ---` });
      content.push({ type: "image" as const, data: await shot(saved?.viewport), mimeType: "image/png" });
    }
    return { content };
  } finally {
    if (options.restore !== false) {
      await teardown([
        saved ? { action: "restore_camera", args: saved } : null,
        isolateToken ? { action: "restore", args: { token: isolateToken } } : null,
        options.annotate && target ? { action: "annotate", args: { mode: "off" } } : null,
        options.contrast && target ? { action: "contrast", args: { mode: "off" } } : null,
      ]);
    }
  }
}

registerTool(
  "rbx_view",
  {
    title: "View the live place",
    description: "Compose camera framing, isolation, cutaway, annotation, contrast, and optional turntable angles into one inspected view.",
    inputSchema: {
      target: z.string().optional(),
      view: z.enum(VIEWS).optional(),
      angles: z.number().int().min(1).max(24).optional().describe("Turntable count; default 1."),
      elevation: z.number().optional(),
      zoom: z.number().optional(),
      isolate: z.boolean().optional(),
      cutaway: z.enum(["none", "roof"]).optional(),
      cutawayY: z.number().optional(),
      annotate: z.boolean().optional(),
      contrast: z.boolean().optional(),
      restore: z.boolean().optional().describe("Restore camera/visibility changes after capture. Default true."),
    },
  },
  async (a) => {
    try {
      return await captureView(a);
    } catch (e) {
      return errResult(e);
    }
  },
);

const APPLY_SELECT = z.object({
  target: z.string().optional(),
  name: z.string().optional(),
  className: z.string().optional(),
  material: z.string().optional(),
  region: SYNC_REGION.optional(),
  tag: z.string().optional(),
  selection: z.boolean().optional(),
  lod: z.enum(["parts", "bbox"]).optional(),
  maxParts: z.number().int().min(1).max(MAX_SYNC_PARTS).optional(),
}).passthrough();
const APPLY_ITEM = z.object({
  target: z.string().optional(),
  select: APPLY_SELECT.optional(),
  op: z.enum(["move", "rotate", "scale", "recolor", "material", "anchor", "rename", "delete", "clone", "replace", "scatter", "distribute", "align", "ground"]),
  delta: z.array(z.number()).length(3).optional(),
  to: z.array(z.number()).length(3).optional(),
  degrees: z.array(z.number()).length(3).optional(),
  scale: z.union([z.number(), z.array(z.number()).length(3)]).optional(),
  color: rgb255.optional(),
  material: z.string().optional(),
  name: z.string().optional(),
  offset: z.union([z.array(z.number()).length(3), z.number()]).optional().describe("clone: [dx,dy,dz]; ground: vertical offset."),
  maxDistance: z.number().positive().optional().describe("ground: downward ray distance."),
  anchored: z.boolean().optional(),
  spec: z.object({}).passthrough().optional().describe("replace: build spec for the replacement."),
  count: z.number().int().min(1).max(100).optional().describe("scatter: clone count."),
  seed: z.number().int().optional(),
  region: SYNC_REGION.optional().describe("scatter: placement region."),
  from: z.array(z.number()).length(3).optional().describe("distribute: first point."),
  via: z.array(z.number()).length(3).optional().describe("distribute: optional control point — bends the run into a quadratic Bezier instead of a straight line."),
  axis: z.enum(["x", "y", "z"]).optional().describe("align: axis to set."),
  value: z.number().optional().describe("align: axis value."),
}).passthrough().superRefine((item, ctx) => {
  if (["move", "rotate", "scale", "recolor", "material", "anchor", "rename", "delete", "clone"].includes(item.op)) {
    const check = EDIT_ARGS.safeParse({ ...item, target: item.target ?? "__selection__" });
    if (!check.success) {
      for (const issue of check.error.issues) {
        ctx.addIssue({ code: "custom", path: issue.path.filter((key) => key !== "target"), message: issue.message });
      }
    }
  }
});

function seeded(seed: number) {
  let state = (Math.floor(seed) >>> 0) || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function randomPoint(region: any, random: () => number): number[] {
  if (!region) throw new Error("scatter needs region");
  if (region.center) {
    const radius = region.radius;
    return region.center.map((n: number) => n + (random() * 2 - 1) * radius);
  }
  return region.min.map((n: number, i: number) => n + random() * (region.max[i] - n));
}

async function targetInfo(target: string) {
  const dump = await getMapDump({ target, lod: "bbox", maxParts: 1, detail: "parts" });
  return dump.parts[0] as DumpPart | undefined;
}

type ExpandedApplyOp = StagedOp | { action: "ground"; args: Record<string, unknown> };

async function expandApply(items: any[]): Promise<ExpandedApplyOp[]> {
  const expanded: ExpandedApplyOp[] = [];
  for (const item of items) {
    const selection = item.select ?? (item.target ? null : undefined);
    const map = selection ? await getMapDump(selection) : null;
    const selectedParts = Array.isArray(map?.parts) ? map.parts as DumpPart[] : [];
    if (!item.target) targetReferences(selectedParts);
    const targets = item.target
      ? [{ target: item.target, part: await targetInfo(item.target) }]
      : [...new Map(selectedParts.map((part) => {
        const target = targetReference(part);
        return [target, { target, part }];
      })).values()];
    if (targets.length === 0) throw new Error(`apply ${item.op}: selection matched no parts`);
    if (item.op === "ground") {
      if (item.offset !== undefined && typeof item.offset !== "number") throw new Error("ground offset must be a number");
      const args: Record<string, unknown> = item.target
        ? { target: item.target }
        : { targets: targets.map((target) => target.target) };
      if (item.maxDistance !== undefined) args.maxDistance = item.maxDistance;
      if (item.offset !== undefined) args.offset = item.offset;
      expanded.push({ action: "ground", args });
      continue;
    }
    if (item.op === "replace") {
      if (!item.spec) throw new Error("replace needs spec");
      for (const target of targets) {
        const spec = { ...item.spec };
        if (spec.center === undefined && target.part?.pos) spec.center = target.part.pos;
        if (spec.size === undefined && target.part?.size) spec.size = target.part.size;
        const build = parseStageOps([{ action: "build", args: spec }])[0];
        expanded.push({ action: "edit", args: { target: target.target, op: "delete" } }, build);
      }
      continue;
    }
    if (item.op === "scatter") {
      if (!item.target) throw new Error("scatter needs an explicit source target");
      const source = targets[0].part;
      if (!source?.pos) throw new Error("scatter source has no position");
      const random = seeded(item.seed ?? 1);
      for (let i = 0; i < (item.count ?? 1); i += 1) {
        const point = randomPoint(item.region, random);
        expanded.push({ action: "edit", args: { target: item.target, op: "clone", offset: point.map((n, j) => n - source.pos[j]), ...(item.name ? { name: `${item.name}${i + 1}` } : {}) } });
      }
      continue;
    }
    if (item.op === "distribute") {
      if (!item.from || !item.to || targets.length < 2) throw new Error("distribute needs from, to, and at least two targets");
      for (let i = 0; i < targets.length; i += 1) {
        const t = i / (targets.length - 1);
        expanded.push({ action: "edit", args: { target: targets[i].target, op: "move", to: item.from.map((n: number, j: number) => n + (item.to[j] - n) * t) } });
      }
      continue;
    }
    if (item.op === "align") {
      if (!item.axis || item.value === undefined) throw new Error("align needs axis and value");
      const axis = ({ x: 0, y: 1, z: 2 } as Record<string, number>)[item.axis];
      for (const target of targets) {
        if (!target.part?.pos) continue;
        const to = [...target.part.pos];
        to[axis] = item.value;
        expanded.push({ action: "edit", args: { target: target.target, op: "move", to } });
      }
      continue;
    }
    for (const target of targets) {
      // NOTE: `op` is deliberately KEPT. Every apply-level verb (replace/scatter/
      // distribute/align/ground) has already `continue`d above, so anything reaching here
      // is a plain edit verb — and handlers.edit dispatches on args.op. Deleting it made
      // all nine of move/rotate/scale/recolor/material/anchor/rename/delete/clone fail
      // with "unknown edit op: nil".
      const args: any = { ...item, target: target.target };
      delete args.select;
      delete args.spec;
      delete args.count;
      delete args.seed;
      delete args.region;
      delete args.from;
      delete args.via;
      delete args.axis;
      delete args.value;
      expanded.push({ action: "edit", args });
    }
  }
  return expanded;
}

registerTool(
  "rbx_apply",
  {
    title: "Apply bulk edits",
    description:
      "Apply explicit or filtered edits as one atomic Studio undo step. Supports move/rotate/scale/recolor/material/anchor/rename/delete/clone plus replace, scatter, distribute, align, and ground.",
    inputSchema: {
      ops: z.array(APPLY_ITEM).min(1).describe("Ordered edit operations; each uses target or select."),
      view: z.object({}).passthrough().optional().describe("Optional rbx_view options after the edit."),
    },
  },
  async (a) => {
    try {
      const ops = await expandApply(a.ops);
      const command = ops.some((op) => op.action === "ground") ? "apply" : "batch";
      const result = await bridge.sendCommand(command, { ops }, 120_000);
      if (a.view) {
        const view = await captureView(a.view);
        view.content.unshift({ type: "text", text: JSON.stringify({ applied: ops.length, result }) });
        return view;
      }
      return textResult({ applied: ops.length, result });
    } catch (e) {
      return errResult(e);
    }
  },
);

const PLACE_POINT = z.array(z.number()).length(3);
const PLACE_COUNT = z.number().int().min(1).max(500);
const PLACE_VERBS = ["place", "line", "grid", "ring", "scatter"] as const;
const PLACE_LINE = z.object({
  from: PLACE_POINT,
  to: PLACE_POINT,
  spacing: z.number().positive().optional(),
  count: PLACE_COUNT.optional(),
  via: PLACE_POINT.optional(),
});
const PLACE_INPUT = z
  .object({
    mode: z.literal("palette").optional().describe("'palette' returns the direct-child prefab manifest."),
    prefab: z.string().min(1).optional().describe("Direct child name in Workspace.Palette."),
    name: z.string().min(1).optional().describe("Placement group name; defaults to <prefab>s."),
    ground: z.boolean().optional().describe("Drop each clone onto the first surface below it."),
    groundTarget: z.string().min(1).max(512).optional().describe("Grounding target path/name; used with ground=true and limited to that BasePart/Model and descendants."),
    snap: z.number().positive().optional().describe("Quantise generated positions to this many studs."),
    abut: z.boolean().optional().describe("For line/grid, derive spacing from the prefab bbox so consecutive clones touch."),
    rotate: z.enum(["none", "random", "align"]).optional().describe("Yaw policy: none (default), random, or line/ring tangent."),
    jitter: z
      .union([
        z.number().nonnegative(),
        PLACE_POINT.refine((values) => values.every((value) => value >= 0), "jitter components must be non-negative"),
      ])
      .optional()
      .describe("Random position offset in studs; requires seed."),
    seed: z.number().int().optional().describe("Deterministic seed; required for scatter or jitter."),
    place: z
      .object({ at: PLACE_POINT, rotation: PLACE_POINT.optional() })
      .optional()
      .describe("Place one clone at [x,y,z]."),
    at: PLACE_POINT.optional().describe("Place one clone at [x,y,z] (shorthand for place.at)."),
    rotation: PLACE_POINT.optional().describe("Place shorthand rotation [rx,ry,rz] in degrees."),
    line: PLACE_LINE.optional().describe("Place along from -> to using spacing or count; via bends it with a quadratic curve."),
    grid: z
      .object({
        origin: PLACE_POINT,
        rows: PLACE_COUNT,
        cols: PLACE_COUNT,
        spacingX: z.number().positive().optional(),
        spacingZ: z.number().positive().optional(),
      })
      .optional()
      .describe("Place a rows x cols grid from origin."),
    ring: z
      .object({
        center: PLACE_POINT,
        radius: z.number().positive(),
        count: PLACE_COUNT,
        startAngle: z.number().optional(),
      })
      .optional()
      .describe("Place count clones around a ring."),
    scatter: z
      .object({ region: SYNC_REGION, count: PLACE_COUNT })
      .optional()
      .describe("Place count clones randomly in a center/radius or min/max region."),
  })
  .superRefine((args, ctx) => {
    const verbs = PLACE_VERBS.filter((verb) => args[verb] !== undefined);
    if (args.at !== undefined) verbs.push("place");
    if (args.mode === "palette") {
      if (
        verbs.length > 0 ||
        args.prefab !== undefined ||
        args.name !== undefined ||
        args.ground !== undefined ||
        args.groundTarget !== undefined ||
        args.snap !== undefined ||
        args.abut !== undefined ||
        args.rotate !== undefined ||
        args.jitter !== undefined ||
        args.seed !== undefined ||
        args.at !== undefined ||
        args.rotation !== undefined
      ) {
        ctx.addIssue({ code: "custom", path: ["mode"], message: "mode='palette' cannot include placement fields" });
      }
      return;
    }
    if (verbs.length !== 1) {
      ctx.addIssue({ code: "custom", path: ["mode"], message: "placement needs exactly one of place, line, grid, ring, or scatter" });
    }
    if (args.prefab === undefined) {
      ctx.addIssue({ code: "custom", path: ["prefab"], message: "placement needs prefab" });
    }
    if (args.groundTarget !== undefined && args.ground !== true) {
      ctx.addIssue({ code: "custom", path: ["groundTarget"], message: "groundTarget requires ground=true" });
    }
    if (args.abut && !args.line && !args.grid) {
      ctx.addIssue({ code: "custom", path: ["abut"], message: "abut only supports line or grid" });
    }
    if (args.line) {
      const sizing = Number(args.line.spacing !== undefined) + Number(args.line.count !== undefined);
      if (args.abut && sizing > 0) ctx.addIssue({ code: "custom", path: ["line"], message: "abut line cannot include spacing or count" });
      if (!args.abut && sizing !== 1) ctx.addIssue({ code: "custom", path: ["line"], message: "line needs exactly one of spacing or count" });
      if (args.abut && args.line.via) ctx.addIssue({ code: "custom", path: ["line", "via"], message: "abut line does not support via" });
    }
    if (args.grid) {
      const hasX = args.grid.spacingX !== undefined;
      const hasZ = args.grid.spacingZ !== undefined;
      if (args.abut && (hasX || hasZ)) ctx.addIssue({ code: "custom", path: ["grid"], message: "abut grid cannot include spacingX or spacingZ" });
      if (!args.abut && (!hasX || !hasZ)) ctx.addIssue({ code: "custom", path: ["grid"], message: "grid needs spacingX and spacingZ" });
    }
    if ((args.jitter !== undefined || verbs.includes("scatter")) && args.seed === undefined) {
      ctx.addIssue({ code: "custom", path: ["seed"], message: "scatter and jitter need seed" });
    }
    if (args.grid && args.grid.rows * args.grid.cols > 500) {
      ctx.addIssue({ code: "custom", path: ["grid"], message: "grid is capped at 500 instances" });
    }
  });
type PlaceInput = z.infer<typeof PLACE_INPUT>;

function cleanPlacePayload(args: PlaceInput) {
  if (args.mode === "palette") return { mode: "palette" };
  const { mode: _mode, ...payload } = args;
  return payload;
}

registerTool(
  "rbx_place",
  {
    title: "Place palette prefabs",
    description:
      "mode='palette' returns the direct-child prefab manifest. Otherwise clone the required prefab into Placements/<name> with exactly one verb object: place, line, grid, ring, or scatter. " +
      "Shared modifiers are ground, snap, rotate, jitter, seed, and abut; abut derives line/grid spacing from the prefab bbox. Placements include an O(n) adjacency-gap report and remain one undoable group (max 500 instances).",
    inputSchema: PLACE_INPUT,
  },
  async (raw) => {
    const args = raw as PlaceInput;
    try {
      const payload = cleanPlacePayload(args) as Record<string, unknown>;
      if (args.groundTarget !== undefined) {
        const validated = await validateGroundTarget(args.groundTarget);
        payload.groundTarget = validated.target;
      }
      return textResult(await bridge.sendCommand("place", payload, 120_000));
    } catch (e) {
      return errResult(e);
    }
  },
);

// --- selection bridge: read what the user clicked / show what you mean -------
registerTool(
  "rbx_selection",
  {
    title: "Get/set Studio selection",
    description:
      "mode='get' returns the instances the user has selected in Studio (name/class/path/bbox) — operate on 'this'. " +
      "mode='set' selects <target> so the user SEES what you're referring to (the blue selection box).",
    inputSchema: {
      mode: z.enum(["get", "set"]).describe("'get' read selection, 'set' select target."),
      target: z.string().optional().describe("set: instance full path preferred; an unambiguous name is also accepted."),
    },
  },
  async (a) => run("selection", { mode: a.mode, target: a.target })

);

// --- cast: raycast / volume overlap query ------------------------------------
registerTool(
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
      limit: cap(500).optional().describe("box/sphere: max parts (default 50, cap 500)."),
    },
  },
  async (a) => run("cast", a, 15_000)

);

// --- script: READ Luau source (the read side sync never had) -----------------
registerTool(
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
      limit: cap(500).optional().describe("find: max matches (default 100, cap 500)."),
    },
  },
  async (a) => run("script", a, 15_000)

);

// --- prop: get/set/list ANY property (rbx_attr is Attributes only) ------------
registerTool(
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
  async (a) => run("prop", a, 15_000)

);

// --- group: wrap parts into a Model / ungroup / weld -------------------------
registerTool(
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
  async (a) => run("group", a, 30_000)

);

// --- console: read Studio LogService output ----------------------------------
registerTool(
  "rbx_console",
  {
    title: "Read Studio console",
    description:
      "Read the Studio output log (LogService) in-channel — prints, warnings, errors — without leaving BuildKit. `errorsOnly` keeps just warnings+errors; `filter` keeps lines containing a substring; `limit` caps the tail (default 50). For PLAY-mode logs the official get_console_output is better; this is the edit-time channel (e.g. see a build script's warnings right after rbx_run/execute_luau).",
    inputSchema: {
      limit: cap(300).optional().describe("Max lines from the tail (default 50, cap 300)."),
      errorsOnly: z.boolean().optional().describe("Only warnings + errors."),
      filter: z.string().optional().describe("Only lines containing this substring."),
    },
  },
  async (a) => run("console", a, 15_000)

);

// --- checkpoint: hard savepoint clone in ServerStorage -----------------------
registerTool(
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
  async (a) => run("checkpoint", { mode: a.mode, name: a.name, target: a.target }, 60_000)

);

// --- isolate: hide everything except the target (bracket a clean capture) ----


// --- restore: sweep-undo every outstanding hide/recolor ----------------------
registerTool(
  "rbx_restore",
  {
    title: "Restore all hidden / recolored parts",
    description:
      "Escape hatch: un-hide and un-recolor EVERY part still affected by a cutaway, isolate, or contrast — no token needed. " +
      "Use when parts have gone invisible or oddly colored and you don't know which call left them that way (a capture that errored " +
      "partway, or a previous Studio session). The plugin also runs this automatically on load, so a restart clears any stragglers.",
    inputSchema: {},
  },
  async () => {
    try {
      return textResult(await bridge.sendCommand("restore_all", {}, 60_000));
    } catch (e) {
      return errResult(e);
    }
  }
);

// --- annotate: overlay bbox outline + dimension label ------------------------


// --- place routing: pin commands to one Studio when several are open ---------
registerTool(
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
registerTool(
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

registerTool(
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

async function waitForListener(port: number, expectedPid: number | undefined, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let last: number | null = null;
  while (Date.now() < deadline) {
    last = await findListenerPid(port);
    if (last !== null && (expectedPid === undefined || last === expectedPid)) return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`BuildKit listener did not come up on port ${port} (last PID: ${last ?? "none"})`);
}

registerTool(
  "rbx_dev_reload",
  {
    title: "Rebuild and reload the BuildKit server",
    description:
      "Rebuilds the repo, verifies the viewer listener still belongs to the stale server, replaces that process with the new dist build, and verifies the new listener PID. " +
      "Refuses to terminate the current MCP process or a listener whose ownership changed during the build.",
    inputSchema: {},
  },
  async () => {
    try {
      const stalePid = await findListenerPid(VIEWER_PORT);
      if (stalePid === null) return errResult(new Error(`no BuildKit viewer listener found on port ${VIEWER_PORT}`));
      if (stalePid === process.pid) return errResult(new Error("current MCP process owns the bridge; restart it from the MCP host"));
      const command = buildDetachedRestartCommand({
        cwd: path.resolve(__dirname, ".."),
        port: VIEWER_PORT,
        stalePid,
        currentPid: process.pid,
      });
      const result = await runDetachedRestart(command);
      const listenerPid = await waitForListener(VIEWER_PORT, result.newPid);
      return textResult({ ...result, listenerPid, build: "ok", verified: listenerPid === result.newPid });
    } catch (e) {
      return errResult(e);
    }
  },
);

// --- status ------------------------------------------------------------------
registerTool(
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
registerTool(
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
  async (a) => run("navcheck", a, 30_000)

);

// --- tag: CollectionService gameplay wiring ----------------------------------
registerTool(
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
  async (a) => run("tag", a)

);

// --- attr: instance attributes -----------------------------------------------
registerTool(
  "rbx_attr",
  {
    title: "Instance attributes",
    description:
      "Get/set/list instance Attributes (gameplay state) without raw execute_luau. mode: 'set' (one undo; value is a string/number/bool, or [x,y,z] → Vector3), 'get' a named attribute, or 'list' all attributes on a target. Non-JSON values (Vector3/Color3) come back stringified.",
    inputSchema: {
      mode: z.enum(["set", "get", "list"]),
      target: z.string().describe("Instance full path preferred; an unambiguous name is also accepted."),
      name: z.string().optional().describe("set/get: attribute name."),
      value: z
        .union([z.string(), z.number(), z.boolean(), z.array(z.number())])
        .optional()
        .describe("set: the value. A 3-number array becomes a Vector3."),
    },
  },
  async (a) => run("attr", a)

);

// --- diff: compare two trees / checkpoints -----------------------------------
registerTool(
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
  async (a) => run("diff", a, 60_000)

);

// --- optimize: performance / streaming audit ---------------------------------
registerTool(
  "rbx_optimize",
  {
    title: "Performance / streaming audit",
    description:
      "Audit a target (or the whole workspace) for runtime cost: total parts, Precise-CollisionFidelity MeshParts (expensive), unanchored geometry, parts far from origin, big models, and StreamingEnabled. fix=true lowers Precise→Box CollisionFidelity (one undo). Complements rbx_qa (geometry lint) with the perf side.",
    inputSchema: {
      target: z.string().optional().describe("Instance full path preferred; an unambiguous name is also accepted. Omit = whole workspace."),
      fix: z.boolean().optional().describe("Lower Precise MeshPart CollisionFidelity to Box (one undo step). Default false."),
    },
  },
  async (a) => run("optimize", a, 60_000)

);

// --- sync: push disk .luau file(s) into Studio ---
// A new .luau added mid-session often doesn't appear in Studio on its own, so
// require(WaitForChild) silently infinite-yields. This reads the file(s) off
// disk, maps each to its DataModel path from the service-named ancestor
// folder, and creates/updates the script in one undo step.
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

registerTool(
  "rbx_sync",
  {
    title: "Sync disk script(s) into Studio",
    description:
      "Push one or more on-disk .luau files into the running Studio's DataModel — the deterministic fix for 'I edited/added a file but it didn't appear in Studio' (new files that make require(WaitForChild) hang). " +
      "Each file's target is derived from its service-named ancestor folder (ServerScriptService/, ReplicatedStorage/, StarterPlayerScripts/, …) plus suffix: .server.luau→Script, .client.luau→LocalScript, .luau→ModuleScript, init.luau→the parent folder. " +
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
registerTool(
  "rbx_watch",
  {
    title: "Watch motion over time (sampled burst)",
    description:
      "THE tool for watching something MOVE: samples the viewport on a timer inside a single call and returns the frames as one labeled sequence (t=0.0s, t=0.5s, …) — NPCs walking, physics settling, a tween playing, play-mode action. " +
      "Nothing else can do this. Looping rbx_frame -> screen_capture samples at the speed of your own round trips (seconds apart at best), so fast motion is simply invisible to it; this loop runs server-side at ~1s intervals. " +
      "Grabs the OS window, so Studio must be VISIBLE in the foreground. If Studio/BuildKit isn't detected (or every grab fails), it returns a fallback directive — switch to looping rbx_frame -> the official screen_capture, or ask the user to open Studio. " +
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
    let frames = Math.floor(seconds / interval + 1e-9) + 1;
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
        if (canMove && !a.follow) await bridge.sendCommand("frame", { target: a.target, view: a.view ?? "iso", zoom: a.zoom ?? 1.1 }, FRAME_MS);
      }
      const header =
        `watching ${a.target ?? "current view"} — ${frames} frames every ~${interval}s` +
        `${a.follow ? " (following)" : ""}${capped ? " [capped at 40 frames]" : ""}. OS window-grab: Studio must be the visible foreground window.`;
      const content: any[] = [{ type: "text" as const, text: header }];
      // Label the time in 100ms steps: (i*interval).toFixed(1) mislabels e.g. 0.25s as "0.3".
      const fmtT = (i: number) => String(Math.round(i * interval * 100) / 100);
      for (let i = 0; i < frames; i++) {
        const t = fmtT(i);
        try {
          if (canMove && a.follow) await bridge.sendCommand("frame", { target: a.target, view: a.view ?? "iso", zoom: a.zoom ?? 1.1 }, FRAME_MS);
          const b64 = await shot(saved?.viewport);
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
      await teardown([saved ? { action: "restore_camera", args: saved } : null]);
    }
  }
);

// --- local-gen pipeline: prompt/image -> mesh -> Roblox asset -> insert ------
// The pipeline is an OPTIONAL local component (ComfyUI + Hunyuan3D + Blender on your own
// GPU) and is not part of the repo, so it's absent in a plain clone. rbx_gen_mesh is
// therefore registered only when the script is actually present — advertising a tool that
// can only fail costs every session manifest tokens and hands the agent a dead end.
const PIPELINE_PY = path.resolve(__dirname, "..", "pipeline", "gen_to_roblox.py");
const HAS_PIPELINE = existsSync(PIPELINE_PY);

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

if (HAS_PIPELINE)
  registerTool(
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
      // The pipeline's shape is opaque (local script, not in-repo) — guard the deref so a
      // result that omits a promised field fails with an actionable message instead of a
      // cryptic "Cannot read properties of undefined".
      if (!res || typeof res !== "object" || typeof res.name !== "string") {
        return errResult(new Error(`pipeline returned a malformed result: ${JSON.stringify(res)}`));
      }
      if (!res.split && typeof res.assetId !== "number") {
        return errResult(new Error(`pipeline result missing assetId (split=false): ${JSON.stringify(res)}`));
      }
      if (res.split && (typeof res.base?.assetId !== "number" || typeof res.lid?.assetId !== "number")) {
        return errResult(new Error(`pipeline result missing base/lid assetIds (split=true): ${JSON.stringify(res)}`));
      }
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

const ALWAYS_ENABLED_TOOLS = new Set([
  "rbx_map",
  "rbx_view",
  "rbx_apply",
  "rbx_dev_reload",
  "rbx_status",
  "rbx_qa",
  "rbx_checkpoint",
  "rbx_enable_tools",
  "rbx_list_tools",
]);

registerTool(
  "rbx_enable_tools",
  {
    title: "Enable BuildKit tools",
    description: "Enable one or more lazy-loaded BuildKit tools by exact name. Use rbx_list_tools first when you need to search the catalog.",
    inputSchema: {
      names: z.array(z.string().min(1)).min(1).max(50).describe("Exact tool names to enable."),
    },
  },
  async (a) => {
    const enabled: string[] = [];
    const unknown: string[] = [];
    for (const name of new Set(a.names)) {
      const entry = toolCatalog.get(name);
      if (!entry) {
        unknown.push(name);
        continue;
      }
      if (!entry.handle.enabled) entry.handle.enable();
      enabled.push(name);
    }
    return textResult({ enabled, unknown });
  }
);

registerTool(
  "rbx_list_tools",
  {
    title: "Search BuildKit tools",
    description: "Search all BuildKit tools, including lazy-loaded tools that are not currently in tools/list. Search by name, title, or description.",
    inputSchema: {
      query: z.string().optional().describe("Case-insensitive substring to match against tool name, title, or description. Omit to list the full catalog."),
    },
  },
  async (a) => {
    const query = a.query?.trim().toLowerCase() ?? "";
    const tools = [...toolCatalog.entries()]
      .filter(([name, entry]) => !query || `${name} ${entry.title ?? ""} ${entry.description ?? ""}`.toLowerCase().includes(query))
      .map(([name, entry]) => ({ name, title: entry.title, description: entry.description, enabled: entry.handle.enabled }));
    return textResult({ tools });
  }
);

// The SDK filters disabled handles out of tools/list and emits tools/list_changed. Do this
// before connecting the transport so the first client snapshot is already lazy-loaded.
for (const [name, entry] of toolCatalog) {
  if (!ALWAYS_ENABLED_TOOLS.has(name)) entry.handle.disable();
}

// Static viewer files and the shared SSE stream live in this process so stage ops and
// mirror sync reach open browser tabs directly.
const VIEWER_MIME: Record<string, string> = { ".html": "text/html", ".json": "application/json", ".js": "text/javascript" };
const MAX_VIEWER_BODY_BYTES = 2 * 1024 * 1024;

function viewerJson(res: import("node:http").ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}

function readViewerJson(req: import("node:http").IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    let tooLarge = false;
    req.on("data", (chunk) => {
      if (tooLarge) return;
      const next = Buffer.byteLength(body) + Buffer.byteLength(chunk);
      if (next > MAX_VIEWER_BODY_BYTES) {
        tooLarge = true;
        return;
      }
      body += chunk;
    });
    req.on("error", reject);
    req.on("end", () => {
      if (tooLarge) {
        reject(new Error(`request body exceeds ${MAX_VIEWER_BODY_BYTES} bytes`));
        return;
      }
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("bad json"));
      }
    });
  });
}

function applyStageOpPatch(current: StageOp, data: any): StageOp | null {
  const patch = data.patch;
  const patchObject = patch && typeof patch === "object" && !Array.isArray(patch) ? patch as Record<string, unknown> : null;
  const patchIsOp = !!patchObject && (patchObject.action === "build" || patchObject.action === "edit") && patchObject.args && typeof patchObject.args === "object" && !Array.isArray(patchObject.args);
  const partIndex = data.partIndex;
  if (partIndex !== undefined && (!Number.isInteger(partIndex) || partIndex < 0)) throw new Error("stage patch partIndex must be a non-negative integer");
  if (data.remove === true || (patchObject?.remove === true && !patchIsOp)) {
    if (partIndex === undefined) return null;
    if (current.action !== "build" || current.args.kind !== "prop" || !Array.isArray(current.args.parts)) throw new Error("stage patch partIndex requires a prop with parts");
    if (partIndex >= current.args.parts.length) throw new Error("stage patch partIndex is out of range");
    return parseStageOps([{ action: current.action, args: { ...current.args, parts: current.args.parts.filter((_, index) => index !== partIndex) } }])[0];
  }
  if (partIndex !== undefined) {
    if (current.action !== "build" || current.args.kind !== "prop" || !Array.isArray(current.args.parts)) throw new Error("stage patch partIndex requires a prop with parts");
    if (patchIsOp) {
      const replacement = parseStageOps([patch])[0];
      if (replacement.action !== "build" || replacement.args.kind !== "prop" || !Array.isArray(replacement.args.parts)) throw new Error("stage patch partIndex requires a prop with parts");
      if (partIndex >= replacement.args.parts.length) throw new Error("stage patch partIndex is out of range");
      return replacement;
    }
    if (!patchObject) throw new Error("stage patch must be an operation or part object");
    if (partIndex >= current.args.parts.length) throw new Error("stage patch partIndex is out of range");
    return parseStageOps([{ action: current.action, args: { ...current.args, parts: current.args.parts.map((part, index) => index === partIndex ? patchObject : part) } }])[0];
  }
  return parseStageOps([patch])[0];
}

function applyStagePatch(stage: StageRuntime, data: any, label = "Edit stage") {
  if (data && data.index !== undefined) {
    if (!Number.isInteger(data.index) || data.index < 0) throw new Error("stage patch index must be a non-negative integer");
    const snapshot = stage.state.snapshot();
    let generated = 0;
    let target: { owner: string | null; manualIndex: number; current: StageOp; next: StageOp[] } | undefined;
    for (const generation of snapshot.generations) {
      if (!generation.enabled) continue;
      const count = generation.ops.length;
      if (data.index < generated + count) {
        const promoted = parseStageOps(generation.ops);
        const manualIndex = data.index - generated;
        target = {
          owner: generation.name,
          manualIndex,
          current: promoted[manualIndex],
          next: [...promoted, ...stage.manualOps],
        };
        break;
      }
      generated += count;
    }
    if (!target) {
      const manualIndex = data.index - generated;
      if (manualIndex < 0 || manualIndex >= stage.manualOps.length) throw new Error("stage patch index is not a manual op");
      target = { owner: null, manualIndex, current: stage.manualOps[manualIndex], next: [...stage.manualOps] };
    }
    const { owner, manualIndex, current, next } = target;
    const patched = applyStageOpPatch(current, data);
    if (patched === null) next.splice(manualIndex, 1);
    else next[manualIndex] = patched;
    return mutateStage(stage, () => {
      if (owner !== null) stage.state.setGenerationEnabled(owner, false);
      setManualStage(stage, next);
    }, label);
  }
  const ops = parseStageOps(data?.ops);
  if (data?.mode === "append" || data?.append === true) return mutateStage(stage, () => setManualStage(stage, [...stage.manualOps, ...ops]), label);
  return mutateStage(stage, () => setManualStage(stage, ops), label);
}

type StagePatchRequest = { index: number; patch: Record<string, unknown>; partIndex?: number };

function parseStagePatchRequest(value: unknown, itemIndex: number): StagePatchRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`stage patches item ${itemIndex + 1} must be an object`);
  const item = value as Record<string, unknown>;
  if (!Number.isInteger(item.index) || (item.index as number) < 0) throw new Error(`stage patches item ${itemIndex + 1} index must be a non-negative integer`);
  if (!item.patch || typeof item.patch !== "object" || Array.isArray(item.patch)) throw new Error(`stage patches item ${itemIndex + 1} patch must be an object`);
  if (item.partIndex !== undefined && (!Number.isInteger(item.partIndex) || (item.partIndex as number) < 0)) {
    throw new Error(`stage patches item ${itemIndex + 1} partIndex must be a non-negative integer`);
  }
  return {
    index: item.index as number,
    patch: item.patch as Record<string, unknown>,
    ...(item.partIndex === undefined ? {} : { partIndex: item.partIndex as number }),
  };
}

function applyStagePatches(stage: StageRuntime, data: unknown, label = "Edit stage"): boolean {
  if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray((data as Record<string, unknown>).patches)) {
    throw new Error("stage patches must be an object with a non-empty patches array");
  }
  const rawPatches = (data as { patches: unknown[] }).patches;
  if (rawPatches.length === 0) throw new Error("stage patches must contain at least one patch");
  const patches = rawPatches.map(parseStagePatchRequest);
  const snapshot = stage.state.snapshot();
  const entries: { owner: string | null; working: StageOp | null }[] = [];
  const generatedEntries = new Map<string, { owner: string | null; working: StageOp | null }[]>();
  const manualEntries: { owner: string | null; working: StageOp | null }[] = [];

  for (const generation of snapshot.generations) {
    if (!generation.enabled) continue;
    const ownerEntries: { owner: string | null; working: StageOp | null }[] = [];
    for (const op of parseStageOps(generation.ops)) {
      const entry = { owner: generation.name, working: structuredClone(op) };
      entries.push(entry);
      ownerEntries.push(entry);
    }
    generatedEntries.set(generation.name, ownerEntries);
  }
  // Keep request indices aligned with the actual visible snapshot. The append route has
  // historically updated StageState before its canonical manualStageOps mirror, so using
  // the latter here could apply a valid batch to the wrong manual op.
  for (const op of snapshot.ops.slice(entries.length)) {
    const entry = { owner: null, working: structuredClone(op) };
    entries.push(entry);
    manualEntries.push(entry);
  }

  const promotedOwners = new Set<string>();
  for (const patch of patches) {
    const entry = entries[patch.index];
    if (!entry) throw new Error(`stage patches index ${patch.index} is out of range`);
    if (entry.working === null) throw new Error(`stage patches index ${patch.index} was already removed`);
    entry.working = applyStageOpPatch(entry.working, patch);
    if (entry.owner !== null) promotedOwners.add(entry.owner);
  }

  const next: StageOp[] = [];
  for (const generation of snapshot.generations) {
    if (!generation.enabled || !promotedOwners.has(generation.name)) continue;
    for (const entry of generatedEntries.get(generation.name) ?? []) {
      if (entry.working !== null) next.push(entry.working);
    }
  }
  for (const entry of manualEntries) {
    if (entry.working !== null) next.push(entry.working);
  }
  const validated = parseStageOps(next);
  return mutateStage(stage, () => {
    for (const owner of promotedOwners) stage.state.setGenerationEnabled(owner, false);
    setManualStage(stage, validated);
  }, label);
}

function applyStageReparentRoute(stage: StageRuntime, data: unknown, label = "Reparent stage"): boolean {
  const request = parseStageReparentRequest(data);
  const snapshot = stage.state.snapshot();
  const entries: { owner: string | null; op: StageOp }[] = [];
  for (const generation of snapshot.generations) {
    if (!generation.enabled) continue;
    for (const op of parseStageOps(generation.ops)) entries.push({ owner: generation.name, op });
  }
  for (const op of snapshot.ops.slice(entries.length)) entries.push({ owner: null, op: structuredClone(op) });
  const result = applyStageReparent(entries, request);
  const next: StageOp[] = [];
  for (const generation of snapshot.generations) {
    if (!generation.enabled) continue;
    if (!result.promotedOwners.has(generation.name)) {
      next.push(...generation.ops.map((op) => structuredClone(op)));
      continue;
    }
    next.push(...result.entries.filter((entry) => entry.owner === generation.name).map((entry) => entry.op));
  }
  next.push(...result.entries.filter((entry) => entry.owner === null).map((entry) => entry.op));
  const validated = parseStageOps(next);
  return mutateStage(stage, () => {
    for (const owner of result.promotedOwners) stage.state.setGenerationEnabled(owner, false);
    setManualStage(stage, validated);
  }, label);
}

function parseMirrorTransform(data: any) {
  if (!data || typeof data.target !== "string" || !data.target.startsWith("Workspace.")) {
    throw new Error("mirror transform target must be a Workspace path");
  }
  const vector = (key: string) => {
    const value = data[key];
    if (!Array.isArray(value) || value.length !== 3 || !value.every((entry) => typeof entry === "number" && Number.isFinite(entry))) {
      throw new Error(`mirror transform ${key} must be [x,y,z]`);
    }
    return value;
  };
  const position = vector("position");
  const rotation = vector("rotation");
  const size = vector("size");
  if (size.some((entry: number) => entry <= 0)) throw new Error("mirror transform size must be positive");
  return { target: data.target, position, rotation, size };
}

function parseMirrorTransforms(data: unknown) {
  if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray((data as Record<string, unknown>).transforms)) {
    throw new Error("mirror transforms must be an object with a non-empty transforms array");
  }
  const transforms = (data as { transforms: unknown[] }).transforms;
  if (transforms.length === 0) throw new Error("mirror transforms must contain at least one transform");
  return transforms.map((transform, index) => {
    try {
      return parseMirrorTransform(transform);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`mirror transforms item ${index + 1}: ${message}`);
    }
  });
}

function parseClientTransformMeta(data: any) {
  if (data?.clientRevision !== undefined && (!Number.isInteger(data.clientRevision) || data.clientRevision < 1)) {
    throw new Error("clientRevision must be a positive integer");
  }
  if (data?.requestId !== undefined && (typeof data.requestId !== "string" || data.requestId.length < 1 || data.requestId.length > 120)) {
    throw new Error("requestId must be a non-empty string of at most 120 characters");
  }
  return {
    clientRevision: data?.clientRevision as number | undefined,
    requestId: data?.requestId as string | undefined,
  };
}

function parseStageClientRevision(data: any): number | undefined {
  if (data?.clientRevision === undefined) return undefined;
  if (!Number.isInteger(data.clientRevision) || data.clientRevision < 1) {
    throw new Error("clientRevision must be a positive integer");
  }
  return data.clientRevision;
}

let mirrorTransformTail: Promise<void> = Promise.resolve();
function queueMirrorTransform<T>(work: () => Promise<T>): Promise<T> {
  const request = mirrorTransformTail.then(work, work);
  mirrorTransformTail = request.then(() => undefined, () => undefined);
  return request;
}

async function applyClientMirrorTransforms(
  transforms: MirrorTransform[],
  meta: { clientRevision?: number; requestId?: string },
) {
  await loadMirrorFromDisk();
  for (const transform of transforms) {
    mirrorClientOverrides.set(transform.target, {
      ...transform,
      // Browser/plugin edit requests use YXZ degrees; scene dumps use YXZ radians.
      rotation: transform.rotation.map((value) => value * Math.PI / 180),
    });
  }
  if (mirrorDump) await writeMirror(mirrorDump, true, false);

  const ops = transforms.map((transform) => ({ action: "edit" as const, args: { ...transform, op: "transform" } }));
  const result = ops.length === 1
    ? await bridge.sendCommand("edit", ops[0].args, 60_000)
    : await bridge.sendCommand("batch", { ops }, 120_000);
  return {
    ok: true,
    count: transforms.length,
    result,
    ...meta,
    revision: mirrorRevision,
    mirror: currentMirrorSnapshot(),
  };
}

function startViewerServer() {
  const server = createServer(async (req, res) => {
    const url = req.url || "/";
    const requestUrl = new URL(url, `http://127.0.0.1:${VIEWER_PORT}`);
    const eventPath = requestUrl.pathname;
    const requestedSession = () => stageRuntime(requestUrl.searchParams.get("session") ?? undefined);
    if (req.method === "GET" && eventPath.startsWith("/asset/")) {
      const id = parseAssetId(eventPath.slice("/asset/".length));
      if (id === null) {
        viewerJson(res, 400, { ok: false, error: "asset path must contain a positive numeric id" });
        return;
      }
      try {
        const asset = await loadAsset(id, { cacheDir: ASSET_CACHE_DIR });
        res.writeHead(200, {
          "content-type": asset.contentType,
          "cache-control": "public, max-age=31536000, immutable",
          "x-buildkit-cache": asset.fromCache ? "hit" : "miss",
        });
        res.end(asset.bytes);
      } catch (e) {
        viewerJson(res, 502, { ok: false, error: e instanceof Error ? e.message : String(e) });
      }
      return;
    }
    if (req.method === "GET" && (eventPath === "/ground-part" || eventPath === "/mirror/ground-part" || eventPath === "/mirror/ground-target")) {
      viewerJson(res, 200, { ok: true, ...groundTargetStatus() });
      return;
    }
    if (req.method === "POST" && (eventPath === "/ground-part" || eventPath === "/mirror/ground-part" || eventPath === "/mirror/ground-target")) {
      if (!String(req.headers["content-type"] || "").includes("application/json")) {
        viewerJson(res, 415, { ok: false, error: "Content-Type must be application/json" });
        return;
      }
      try {
        const data = await readViewerJson(req);
        const result = await groundTargetAction(data?.mode, data?.target);
        viewerJson(res, 200, { ok: true, ...result });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        viewerJson(res, message.includes("request body exceeds") ? 413 : 400, { ok: false, error: message });
      }
      return;
    }
    if (req.method === "POST" && eventPath === "/mirror/transforms") {
      if (!String(req.headers["content-type"] || "").includes("application/json")) {
        viewerJson(res, 415, { ok: false, error: "Content-Type must be application/json" });
        return;
      }
      try {
        const data = await readViewerJson(req);
        const transforms = parseMirrorTransforms(data);
        const meta = parseClientTransformMeta(data);
        const result = await queueMirrorTransform(() => applyClientMirrorTransforms(transforms, meta));
        viewerJson(res, 200, result);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        viewerJson(res, 400, { ok: false, error: message });
      }
      return;
    }
    if (req.method === "GET" && eventPath === "/library") {
      try {
        const stage = requestedSession();
        let presets = await libraryStore.discover();
        const origin = requestUrl.searchParams.get("origin");
        const kind = requestUrl.searchParams.get("kind");
        const category = requestUrl.searchParams.get("category");
        if (origin !== null && origin !== "user" && origin !== "ai") throw new Error("library origin filter must be user or ai");
        if (kind !== null && kind !== "saved" && kind !== "recent") throw new Error("library kind filter must be saved or recent");
        if (origin !== null) presets = presets.filter((entry) => entry.origin === origin);
        if (kind !== null) presets = presets.filter((entry) => entry.kind === kind);
        if (category !== null) presets = presets.filter((entry) => entry.category === (category || null));
        const sources = stage.state.snapshot().generations.map((generation) => ({
          source: "generator" as const,
          name: generation.name,
          enabled: generation.enabled,
          ops: generation.ops,
          ...(generation.error ? { error: generation.error } : {}),
        }));
        viewerJson(res, 200, { ok: true, folder: libraryStore.directory, directory: libraryStore.directory, presets, categories: libraryStore.listCategories(), sources });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        viewerJson(res, message.startsWith("session must") || message.startsWith("maximum of") || message.startsWith("library ") ? 400 : 500, { ok: false, error: message });
      }
      return;
    }
    if (req.method === "GET" && eventPath === "/stage/history") {
      try {
        const stage = requestedSession();
        viewerJson(res, 200, { ok: true, ...stage.history.serialize() });
      } catch (error) {
        viewerJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    if (req.method === "GET" && eventPath === "/stage/snapshot") {
      try {
        const stage = requestedSession();
        viewerJson(res, 200, {
          ok: true,
          snapshot: stageSnapshot(stage),
          ...stage.history.serialize(),
        });
      } catch (error) {
        viewerJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    if (req.method === "POST" && eventPath === "/library") {
      if (!String(req.headers["content-type"] || "").includes("application/json")) {
        viewerJson(res, 415, { ok: false, error: "Content-Type must be application/json" });
        return;
      }
      try {
        const data = await readViewerJson(req);
        if (data?.action === "category-create") {
          const category = await libraryStore.createCategory(data.name, "user");
          viewerJson(res, 200, { ok: true, category, categories: libraryStore.listCategories() });
          return;
        }
        if (data?.action === "category-delete") {
          const deleted = await libraryStore.deleteCategory(data.id);
          if (!deleted) {
            viewerJson(res, 404, { ok: false, error: "library category not found" });
            return;
          }
          viewerJson(res, 200, { ok: true, deleted: data.id, categories: libraryStore.listCategories() });
          return;
        }
        if (data?.action === "save") {
          if (typeof data.name !== "string" || data.name.trim() === "") throw new Error("library name must be non-empty");
          const entry = await libraryStore.save({ name: data.name, ops: data.ops, preview: data.preview, filename: data.filename, origin: "user", kind: "saved", category: data.category ?? null });
          viewerJson(res, 200, { ok: true, preset: entry });
          return;
        }
        if (data?.action === "import") {
          const raw = data.preset ?? data.library ?? data.artifact ?? data.data ?? (data.format ? data : undefined);
          const preset = validateLibraryPreset(raw);
          const entry = await libraryStore.save({
            name: typeof data.name === "string" && data.name.trim() ? data.name : preset.name,
            ops: preset.ops,
            preview: data.preview ?? preset.preview,
            filename: data.filename,
            created: preset.created,
            origin: "user",
            kind: "saved",
            category: data.category ?? preset.category,
          });
          viewerJson(res, 200, { ok: true, preset: entry });
          return;
        }
        if (data?.action === "delete") {
          const name = typeof data.filename === "string" ? data.filename : data.name;
          if (typeof name !== "string" || name.trim() === "") throw new Error("library delete requires filename or name");
          const deleted = await libraryStore.remove(name);
          if (!deleted) {
            viewerJson(res, 404, { ok: false, error: "library preset not found" });
            return;
          }
          viewerJson(res, 200, { ok: true, deleted: name });
          return;
        }
        throw new Error("library action must be save, import, delete, category-create, or category-delete");
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        viewerJson(res, message.includes("request body exceeds") ? 413 : 400, { ok: false, error: message });
      }
      return;
    }
    if (req.method === "POST" && eventPath === "/mirror/transform") {
      if (!String(req.headers["content-type"] || "").includes("application/json")) {
        viewerJson(res, 415, { ok: false, error: "Content-Type must be application/json" });
        return;
      }
      try {
        const data = await readViewerJson(req);
        const transform = parseMirrorTransform(data);
        const meta = parseClientTransformMeta(data);
        const result = await queueMirrorTransform(() => applyClientMirrorTransforms([transform], meta));
        viewerJson(res, 200, result);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        viewerJson(res, 400, { ok: false, error: message });
      }
      return;
    }
    if (req.method === "POST" && eventPath.startsWith("/stage/")) {
      const route = eventPath.slice("/stage/".length);
      const requiresJsonBody = route === "patch" || route === "patches" || route === "reparent" || route === "import" || route === "append" || route === "paste" || route === "detach" || route === "options" || route === "history/restore";
      if (requiresJsonBody && !String(req.headers["content-type"] || "").includes("application/json")) {
        viewerJson(res, 415, { ok: false, error: "Content-Type must be application/json" });
        return;
      }
      try {
        const stage = requestedSession();
        if (route === "history/restore") {
          const data = await readViewerJson(req);
          const index = data?.index;
          if (!Number.isInteger(index) || index < 0) throw new Error("stage history index must be a non-negative integer");
          const previous = stage.history.currentIndex();
          const state = stage.history.jump(index);
          if (!state) {
            viewerJson(res, 409, {
              ok: false,
              error: "stage history entry not found",
              ...stage.history.serialize(),
              snapshot: stageSnapshot(stage),
            });
            return;
          }
          if (previous !== index) {
            restoreStageEdit(stage, state);
            broadcastStage(stage);
          }
          viewerJson(res, 200, {
            ok: true,
            snapshot: stageSnapshot(stage),
            ...stage.history.serialize(),
          });
          return;
        }
        if (route === "patches") {
          const data = await readViewerJson(req);
          const clientRevision = parseStageClientRevision(data);
          const changed = applyStagePatches(stage, data, "Edit stage");
          if (changed) broadcastStage(stage);
          viewerJson(res, 200, { ok: true, changed, clientRevision, snapshot: stageSnapshot(stage) });
          return;
        }
        if (route === "reparent") {
          const changed = applyStageReparentRoute(stage, await readViewerJson(req), "Reparent stage");
          if (changed) broadcastStage(stage);
          viewerJson(res, 200, { ok: true, changed, snapshot: stageSnapshot(stage) });
          return;
        }
        if (route === "patch") {
          const data = await readViewerJson(req);
          const clientRevision = parseStageClientRevision(data);
          const changed = applyStagePatch(stage, data, "Edit stage");
          if (changed) broadcastStage(stage);
          viewerJson(res, 200, { ok: true, changed, clientRevision, snapshot: stageSnapshot(stage) });
          return;
        }
        if (route === "import") {
          const data = await readViewerJson(req);
          const artifact = decodeStageArtifact(data?.artifact ?? data?.stage ?? data?.data ?? data);
          const changed = mutateStage(stage, () => setManualStage(stage, artifact.ops), "Import stage");
          const recent = await saveRecentGeneration(artifact.name, artifact.ops, "user");
          if (changed) broadcastStage(stage);
          viewerJson(res, 200, { ok: true, name: artifact.name, created: artifact.created, recent, changed, snapshot: stageSnapshot(stage) });
          return;
        }
        // Append ops to the manual stage without clearing what's already there — used by
        // the mirror's "Copy to stage", so a part built in Studio can be pulled back into
        // the stage to save/export. Validated through the same parseStageOps as every
        // other path, so a copied op is committable unchanged.
        if (route === "append" || route === "paste") {
          const data = await readViewerJson(req);
          const ops = parseStageOps(Array.isArray(data?.ops) ? data.ops : []);
          if (ops.length === 0) throw new Error("append needs a non-empty ops array");
          const changed = mutateStage(stage,
            () => setManualStage(stage, [...stage.manualOps, ...ops]),
            route === "paste" ? "Paste into stage" : "Append to stage",
          );
          if (changed) broadcastStage(stage);
          viewerJson(res, 200, { ok: true, appended: ops.length, snapshot: stageSnapshot(stage) });
          return;
        }
        // Ops produced by a generator FILE are not patchable — the file is the source of
        // truth and would regenerate them on the next save. Detach copies that file's ops
        // into the manual stage and disables the file, so they become freely editable and
        // deletable. This is the escape hatch that makes the stage a real playground
        // without breaking the file-is-truth invariant.
        if (route === "detach") {
          const data = await readViewerJson(req);
          const name = String(data?.name || "");
          const snapshot = stage.state.snapshot();
          const generation = snapshot.generations.find((g) => g.name === name);
          if (!generation) throw new Error(`unknown generator: ${name || "(none)"}`);
          if (!generation.enabled) throw new Error(`${name} is already disabled`);
          const ops = parseStageOps(generation.ops);
          const changed = mutateStage(stage, () => {
            stage.state.setGenerationEnabled(name, false);
            stage.state.appendManual(ops);
            stage.manualOps = [...stage.manualOps, ...ops];
          }, `Detach ${name}`);
          if (changed) broadcastStage(stage);
          viewerJson(res, 200, { ok: true, detached: name, ops: ops.length, snapshot: stageSnapshot(stage) });
          return;
        }
        // Stage-wide CSG budget from the viewer. Deliberately unbounded-ish: the useful
        // value depends on the geometry, so it is the caller's judgement, not a rule.
        if (route === "options") {
          const data = await readViewerJson(req);
          if (data?.csgMax !== undefined) {
            const value = Number(data.csgMax);
            if (!Number.isFinite(value) || value < 1) throw new Error("csgMax must be a positive number");
            stage.csgMax = Math.floor(value);
          }
          viewerJson(res, 200, { ok: true, csgMax: stage.csgMax });
          return;
        }
        if (route === "undo" || route === "redo") {
          const direction = route === "undo" ? -1 : 1;
          const state = stage.history.move(direction);
          if (!state) {
            viewerJson(res, 409, {
              ok: false,
              error: route === "undo" ? "nothing to undo" : "nothing to redo",
              snapshot: stageSnapshot(stage),
              ...stage.history.serialize(),
            });
            return;
          }
          restoreStageEdit(stage, state);
          broadcastStage(stage);
          viewerJson(res, 200, {
            ok: true,
            action: route,
            snapshot: stageSnapshot(stage),
            ...stage.history.serialize(),
          });
          return;
        }
        if (route === "commit") {
          const result = await commitStage(stage, "user");
          viewerJson(res, 200, { ok: true, result, snapshot: stageSnapshot(stage) });
          return;
        }
        viewerJson(res, 404, { ok: false, error: "unknown stage route" });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const status = message.includes("nothing staged") ? 409 : message.includes("request body exceeds") ? 413 : 400;
        viewerJson(res, status, { ok: false, error: message });
      }
      return;
    }
    if (eventPath === "/live/events" || eventPath === "/stage/events") {
      let stage: StageRuntime;
      try {
        stage = requestedSession();
      } catch (error) {
        viewerJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
        return;
      }
      // NOTE: no explicit "connection" header — Firefox's networking stack hangs an
      // EventSource indefinitely (never fires open/error) against a manually-set
      // "Connection: keep-alive" on a chunked response; Node handles keep-alive itself.
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      // writeHead alone doesn't flush over the wire — Node buffers headers until the
      // first write()/end(). Force an immediate flush so the client's EventSource fires
      // 'open' right away, even when the stage is empty and the replay loop below writes nothing.
      res.flushHeaders();
      // Replay the complete stage so a late-joining tab sees generator and manual state.
      res.write(`event: stage-sync\ndata: ${JSON.stringify(stageSnapshot(stage))}\n\n`);
      res.write(`event: stage-history\ndata: ${JSON.stringify(stage.history.serialize())}\n\n`);
      liveClients.add(res);
      stage.clients.add(res);
      req.on("close", () => {
        liveClients.delete(res);
        stage.clients.delete(res);
      });
      return;
    }
    if (req.method === "GET" && eventPath === "/generations") {
      try {
        const stage = requestedSession();
        const generations = stage.state.snapshot().generations.map(({ name, enabled, error }) => ({ name, enabled, ...(error ? { error } : {}) }));
        const recent = libraryStore.list().filter((entry) => entry.kind === "recent")
          .sort((a, b) => b.created.localeCompare(a.created)).map((entry) => ({ ...entry, id: entry.file }));
        viewerJson(res, 200, { generations, recent });
      } catch (error) {
        viewerJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    if (req.method === "POST" && eventPath === "/generations") {
      if (!String(req.headers["content-type"] || "").includes("application/json")) {
        viewerJson(res, 415, { ok: false, error: "Content-Type must be application/json" });
        return;
      }
      try {
        const stage = requestedSession();
        const data = await readViewerJson(req);
        if (data?.action === "clear") {
          await Promise.all(libraryStore.list().filter((entry) => entry.kind === "recent").map((entry) => libraryStore.remove(entry.file)));
          viewerJson(res, 200, { ok: true, recent: [] });
          return;
        }
        if (data?.action === "save" || data?.ops !== undefined) {
          if (typeof data.name !== "string" || data.name.trim() === "") throw new Error("recent generation name must be non-empty");
          const recent = await saveRecentGeneration(data.name, parseStageOps(data.ops), "user");
          viewerJson(res, 200, { ok: true, recent });
          return;
        }
        if (!data || typeof data.name !== "string" || !data.name || typeof data.enabled !== "boolean") {
          viewerJson(res, 400, { ok: false, error: "expected {name, enabled} or {action:'save', name, ops}" });
          return;
        }
        if (!stage.state.snapshot().generations.some((generation) => generation.name === data.name)) {
          viewerJson(res, 404, { ok: false, error: "generation not found" });
          return;
        }
        const changed = mutateStage(stage,
          () => stage.state.setGenerationEnabled(data.name, data.enabled),
          `${data.enabled ? "Enable" : "Disable"} ${data.name}`,
        );
        if (changed) broadcastStage(stage);
        viewerJson(res, 200, { ok: true, name: data.name, enabled: data.enabled, changed, snapshot: stageSnapshot(stage) });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        viewerJson(res, message.includes("request body exceeds") ? 413 : 400, { ok: false, error: message });
      }
      return;
    }
    const reqPath = url === "/" ? "/index.html" : url.split("?")[0];
    const requested = decodeURIComponent(reqPath).replace(/^[/\\]+/, "");
    const filePath = path.resolve(VIEWER_DIR, requested);
    const relative = path.relative(VIEWER_DIR, filePath);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    try {
      const body = await readFile(filePath);
      res.writeHead(200, { "content-type": VIEWER_MIME[path.extname(filePath)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  // Multiple buildkit processes can legitimately coexist (an agent-managed instance
  // plus a manually-run `start.bat`, or two agents) — the bridge (44760) already
  // handles this via owner/client fallback. The viewer server has no such thing, so
  // without this handler a second instance's EADDRINUSE was an unhandled 'error' event,
  // which crashes the WHOLE process (including its stdio MCP capability) over an
  // unrelated port conflict. Degrade gracefully instead: this process's tool calls
  // (stage/scene_dump) still work, they just won't have their own viewer/SSE server —
  // whichever process already owns 8642 keeps serving it for everyone.
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[buildkit] viewer port ${VIEWER_PORT} already in use by another buildkit process — not starting a second one (that process keeps serving it)`);
    } else {
      console.error(`[buildkit] viewer server error: ${err.message}`);
    }
  });
  server.listen(VIEWER_PORT, "127.0.0.1", () => console.error(`[buildkit] viewer: http://localhost:${VIEWER_PORT}`));
}

async function main() {
  await bridge.start(PORT);
  await generatorWatcher.start();
  await mapWatcher.start();
  stageReady = true;
  for (const stage of stageRuntimes.values()) stage.dirty = false;
  await libraryStore.start();
  startViewerServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[buildkit] MCP server ready (stdio)");
  if (!HAS_PIPELINE) {
    console.error(`[buildkit] rbx_gen_mesh disabled — no local-gen pipeline at ${PIPELINE_PY}`);
  }
  // Exit when the MCP host (our stdin peer) goes away, so we don't orphan and
  // squat port 44760 — that EADDRINUSE squat breaks the next client's reconnect.
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void stageRenderer.close().finally(() => process.exit(0));
  };
  process.stdin.on("end", stop);
  process.stdin.on("close", stop);
  // Belt-and-suspenders for the same leak: stdin only gets a clean EOF when the host
  // shuts down gracefully. If it crashes or is force-killed, Windows often never
  // delivers that EOF and this process just runs forever (11 of them piled up in one
  // day). Poll the parent PID directly — process.kill(pid, 0) is a liveness check, not
  // an actual signal — and exit the moment it's gone, regardless of why.
  const parentPid = process.ppid;
  if (parentPid && parentPid > 0) {
    setInterval(() => {
      try {
        process.kill(parentPid, 0);
      } catch {
        console.error(`[buildkit] parent process ${parentPid} is gone — exiting to avoid orphaning`);
        stop();
      }
    }, 5000).unref();
  }
}

// Boot only when run directly (node dist/index.js / npm start), so tests can import
// the module to assert on registered tools without spawning a bridge/server.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error("[buildkit] fatal:", e);
    process.exit(1);
  });
}
