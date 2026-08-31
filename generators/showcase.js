// Fresh, asset-free showcase props for the stage preview and Roblox build output.
// Every part is a native primitive with a positive size and each prop's lowest
// geometry sits at local y=0 so placement stays grounded at its center.y.

const WOOD = [126, 88, 54];
const WOOD_LIGHT = [168, 120, 72];
const BRICK = [142, 96, 82];
const CONCRETE = [178, 176, 168];
const METAL = [92, 104, 116];
const BRASS = [174, 132, 62];
const LANTERN = [238, 174, 72];
const LEAF = [72, 128, 66];

const box = (name, pos, size, color, material, extra = {}) => ({
  name,
  shape: "box",
  pos,
  size,
  color,
  material,
  ...extra,
});

const cylinder = (name, pos, size, color, material, extra = {}) => ({
  name,
  shape: "cylinder",
  pos,
  size,
  color,
  material,
  rot: [0, 0, 90],
  ...extra,
});

const ball = (name, pos, size, color, material, extra = {}) => ({
  name,
  shape: "ball",
  pos,
  size,
  color,
  material,
  ...extra,
});

function crate() {
  return [
    box("CrateBody", [0, 1.2, 0], [3.2, 2.4, 3.2], WOOD, "WoodPlanks"),
    box("FrontBand", [0, 1.2, 1.63], [3.35, 0.28, 0.18], WOOD_LIGHT, "Wood"),
    box("BackBand", [0, 1.2, -1.63], [3.35, 0.28, 0.18], WOOD_LIGHT, "Wood"),
    box("LeftBand", [-1.63, 1.2, 0], [0.18, 0.28, 3.35], WOOD_LIGHT, "Wood"),
    box("RightBand", [1.63, 1.2, 0], [0.18, 0.28, 3.35], WOOD_LIGHT, "Wood"),
  ];
}

function lantern() {
  return [
    box("LanternFoot", [0, 0.2, 0], [2.4, 0.4, 2.4], BRICK, "Brick"),
    cylinder("LanternStem", [0, 1.35, 0], [1.9, 0.34, 0.34], BRASS, "Metal"),
    box("LanternFrame", [0, 2.2, 0], [1.45, 1.35, 1.45], METAL, "Metal"),
    ball("LanternGlow", [0, 2.2, 0], [0.72, 0.72, 0.72], LANTERN, "Neon", {
      canCollide: false,
      light: { color: LANTERN, brightness: 1.2, range: 10 },
    }),
    box("LanternCap", [0, 3.0, 0], [1.8, 0.24, 1.8], BRASS, "Metal"),
  ];
}

function planter() {
  return [
    // The bore stops above the base, leaving a solid 0.25-stud floor.
    cylinder("PlanterShell", [0, 1.25, 0], [2.5, 2.4, 2.4], CONCRETE, "Concrete"),
    cylinder("PlanterBore", [0, 1.35, 0], [2.0, 1.9, 1.9], CONCRETE, "Concrete", { op: "subtract" }),
    cylinder("PlanterSoil", [0, 2.05, 0], [0.24, 1.8, 1.8], [74, 58, 42], "Mud"),
    ball("PlantLeft", [-0.55, 2.8, 0], [1.45, 1.45, 1.45], LEAF, "LeafyGrass", { canCollide: false }),
    ball("PlantRight", [0.55, 2.95, 0.15], [1.55, 1.55, 1.55], [86, 144, 72], "LeafyGrass", { canCollide: false }),
    ball("PlantTop", [0, 3.35, -0.15], [1.2, 1.2, 1.2], [66, 116, 62], "LeafyGrass", { canCollide: false }),
  ];
}

function bench() {
  return [
    box("BenchSeat", [0, 1.8, 0], [4.8, 0.42, 1.5], WOOD_LIGHT, "WoodPlanks"),
    box("BenchBack", [0, 3.0, -0.56], [4.8, 1.9, 0.34], WOOD, "WoodPlanks"),
    box("BenchLegLeft", [-1.75, 0.9, 0], [0.42, 1.8, 1.15], METAL, "Metal"),
    box("BenchLegRight", [1.75, 0.9, 0], [0.42, 1.8, 1.15], METAL, "Metal"),
    box("BenchBrace", [0, 0.72, 0], [3.7, 0.22, 0.25], METAL, "Metal"),
  ];
}

export function generate() {
  const planterParts = planter();
  return [
    { action: "build", args: { kind: "prop", name: "ShowcaseCrate", center: [96, 0, 3], parts: crate() } },
    { action: "build", args: { kind: "prop", name: "ShowcaseLantern", center: [102, 0, 3], parts: lantern() } },
    { action: "build", args: { kind: "prop", name: "ShowcasePlanter", center: [108, 0, 3], csg: true, parts: planterParts.slice(0, 2) } },
    { action: "build", args: { kind: "prop", name: "ShowcasePlant", center: [108, 0, 3], parts: planterParts.slice(2) } },
    { action: "build", args: { kind: "prop", name: "ShowcaseBench", center: [115, 0, 3], parts: bench() } },
  ];
}
