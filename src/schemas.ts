// Pure schema + validation code extracted from the tool registrations, so it can be
// unit-tested without importing the MCP server (which creates a Bridge at load).
// Source of truth shared by rbx_build / rbx_batch and pinned by tests.
import { z } from "zod";

// RGB [r,g,b] as 0-255 bytes — the format the plugin's Color3.fromRGB expects and the
// manifest documents. Enforced here so a caller can't silently drift past the documented
// range (the plugin clamps, but the contract should match the docs).
export const rgb255 = z.array(z.number().min(0).max(255)).length(3);
// Documented result caps (mirror of the plugin's clamps) so the manifest and the wire
// contract agree.
export const cap = (max: number) => z.number().int().min(1).max(max);

export type TargetIdentity = { path?: unknown; fullPath?: unknown; name?: unknown };

function identityText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function targetReference(value: TargetIdentity): string {
  const path = identityText(value.fullPath) ?? identityText(value.path);
  if (path) return path;
  const name = identityText(value.name);
  if (name) return name;
  throw new Error("target identity is missing both path and name");
}

export function targetReferences(values: readonly TargetIdentity[]): string[] {
  const names = new Map<string, number>();
  const fallbackNames = new Set<string>();
  for (const value of values) {
    const path = identityText(value.fullPath) ?? identityText(value.path);
    const name = identityText(value.name);
    if (name) names.set(name, (names.get(name) ?? 0) + 1);
    if (!path) {
      if (name) fallbackNames.add(name);
    }
  }
  for (const name of fallbackNames) {
    if ((names.get(name) ?? 0) > 1) {
      throw new Error(`target identity for duplicate name '${name}' is missing a full path`);
    }
  }
  return [...new Set(values.map(targetReference))];
}

// --- build: parametric primitives --------------------------------------------
// The build spec schema, shared by rbx_build (wrapped under `spec`) and rbx_batch
// (build op args are the spec fields DIRECTLY). One source of truth so the batch
// path can't drift from the single-build path. Exported for the test suite.
export const BUILD_SPEC = z
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
            color: rgb255.optional(),
            material: z.string().optional(),
            transparency: z.number().optional(),
            neon: z.boolean().optional().describe("Material=Neon (glows)."),
            canCollide: z.boolean().optional(),
            op: z.enum(["union", "subtract", "intersect"]).optional().describe("with spec.csg: CSG operation for this part; omitted/union adds, subtract hollows, intersect clips."),
            negate: z.boolean().optional().describe("with spec.csg: SUBTRACT this part from the union (hollow out mugs/cups/bowls)."),
            name: z.string().optional(),
            light: z
              .object({
                color: rgb255.optional(),
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
                    color: rgb255.optional().describe("[r,g,b] flat tint override."),
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
    cushionColor: rgb255.optional().describe("sofa/armchair: [r,g,b] cushion color."),
    cooktopColor: rgb255.optional().describe("stove: [r,g,b] cooktop color."),
    style: z.string().optional().describe("cabinet: 'shaker' for frame+panel doors (else flat)."),
    shelves: z.number().optional().describe("shelf: number of shelf boards; also fridge interior shelf count (default 3). Cabinet door sections use per-section `shelves`."),
    panelColor: rgb255.optional().describe("cabinet shaker: [r,g,b] door panel color."),
    mattressColor: rgb255.optional().describe("bed: [r,g,b] mattress color."),
    name: z.string().optional(),
    center: z.array(z.number()).length(3).describe("[x,y,z] center of the volume (prop: the origin parts offset from)."),
    size: z.array(z.number()).length(3).optional().describe("[width,height,depth]. Required for all kinds except 'prop' (which uses per-part sizes)."),
    thickness: z.number().optional().describe("Wall/slab thickness (cabinet: carcass panel thickness, default 0.4)."),
    material: z.string().optional().describe("Roblox Material enum name, e.g. Brick, Concrete, WoodPlanks."),
    color: rgb255.optional().describe("[r,g,b] 0-255."),
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
    csgMax: z
      .number()
      .int()
      .min(1)
      .max(2000)
      .optional()
      .describe(
        "with spec.csg: max source parts before CSG is skipped and the parts are left unmerged. Default 100. Raise it for detailed props, lower it if unions come out degenerate — past roughly Roblox's ~20k-tri union budget CSG starts simplifying or failing, and where that bites depends on the geometry."
      ),
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
        basinColor: rgb255.optional(),
        faucet: z.boolean().optional().describe("default true."),
        apron: z.boolean().optional().describe("farmhouse apron sink: a big exposed white basin front flush at the cabinet face (hero element)."),
      })
      .optional()
      .describe(
        "cabinet+countertop: cut a basin hole THROUGH the counter + carcass top and drop in a sink (basin walls/bottom + gooseneck faucet) so it isn't capped by counter blocks. width/depth in studs (default ~55% inner width × D-1.2). Put doors (or nothing), not drawers, in the section under the sink."
      ),
    hardwareColor: rgb255.optional().describe("cabinet: [r,g,b] for pulls/knobs (default aged brass)."),
    interiorColor: rgb255.optional().describe("cabinet: [r,g,b] for drawer trays/interior."),
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
  .passthrough();

const EDIT_OP = z.enum(["move", "rotate", "scale", "transform", "recolor", "material", "anchor", "rename", "delete", "clone"]);
const EDIT_VEC3 = z.array(z.number().finite()).length(3);

export function editArgumentIssues(value: Record<string, unknown>): { path: string[]; message: string }[] {
  const issues: { path: string[]; message: string }[] = [];
  const missing = (key: string, message: string) => {
    if (value[key] === undefined) issues.push({ path: [key], message });
  };
  switch (value.op) {
    case "move":
      if (value.delta === undefined && value.to === undefined) missing("delta", "move needs delta or to");
      break;
    case "rotate":
      missing("degrees", "rotate needs degrees");
      break;
    case "scale":
      missing("scale", "scale needs scale");
      break;
    case "transform":
      missing("position", "transform needs position");
      missing("rotation", "transform needs rotation");
      missing("size", "transform needs size");
      break;
    case "recolor":
      missing("color", "recolor needs color");
      break;
    case "material":
      missing("material", "material needs material");
      break;
    case "rename":
      missing("name", "rename needs name");
      break;
    case "clone":
      if (value.offset !== undefined && !Array.isArray(value.offset)) {
        issues.push({ path: ["offset"], message: "clone offset must be [x,y,z]" });
      }
      break;
  }
  return issues;
}

export const EDIT_ARGS = z
  .object({
    target: z.string().min(1).describe("Instance full path preferred; an unambiguous name is also accepted."),
    op: EDIT_OP,
    delta: EDIT_VEC3.optional().describe("move: [dx,dy,dz] world translation."),
    to: EDIT_VEC3.optional().describe("move: absolute [x,y,z] target for the bbox center."),
    degrees: EDIT_VEC3.optional().describe("rotate: [x,y,z] degrees about bbox center."),
    scale: z.union([z.number().finite().positive(), z.array(z.number().finite().positive()).length(3)]).optional().describe("scale: factor (model) or factor/[x,y,z] (part)."),
    position: EDIT_VEC3.optional().describe("transform: absolute BasePart [x,y,z] position."),
    rotation: EDIT_VEC3.optional().describe("transform: absolute BasePart [rx,ry,rz] orientation in degrees."),
    size: z.array(z.number().finite().positive()).length(3).optional().describe("transform: absolute BasePart [x,y,z] size."),
    color: rgb255.optional().describe("recolor: [r,g,b] 0-255."),
    material: z.string().min(1).optional().describe("material: Roblox Material enum name."),
    name: z.string().min(1).optional().describe("rename: new name; clone: name for the copy."),
    offset: EDIT_VEC3.optional().describe("clone: [dx,dy,dz] world offset for the copy."),
    anchored: z.boolean().optional().describe("anchor: true to anchor every part (default), false to unanchor."),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    for (const issue of editArgumentIssues(value)) ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
  });

export function validateBatchOps(
  ops: { action: "build" | "edit"; args: Record<string, unknown> }[],
  options: { validateEdits?: boolean } = {},
): { action: "build" | "edit"; args: unknown }[] {
  return ops.map((op, i) => {
    if (op.action === "build") {
      const spec = BUILD_SPEC.safeParse(op.args ?? {});
      if (!spec.success) {
        const first = spec.error.issues[0];
        throw new Error(
          `rbx_batch op ${i + 1} (build): ${first?.path?.join(".") || "spec"} — ${first?.message ?? "invalid"}. ` +
            `Each build op is {action:'build',args:{kind:'chair',center:[x,y,z],size:[w,h,d]}}.`
        );
      }
      return { action: "build" as const, args: spec.data };
    }
    // Stage-share artifacts predate the Studio edit-op contract and may carry
    // opaque edit records. Keep that interchange format forward-compatible;
    // direct Studio batch/edit calls use the strict default.
    if (options.validateEdits === false) return { action: "edit" as const, args: op.args ?? {} };
    const edit = EDIT_ARGS.safeParse(op.args ?? {});
    if (!edit.success) {
      const first = edit.error.issues[0];
      throw new Error(
        `rbx_batch op ${i + 1} (edit): ${first?.path?.join(".") || "args"} — ${first?.message ?? "invalid"}. ` +
          `Edit ops need target, op, and the fields required by that operation.`
      );
    }
    return { action: "edit" as const, args: edit.data };
  });
}
