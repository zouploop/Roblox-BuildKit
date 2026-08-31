const BARK = [104, 76, 54];
const BARK_LIGHT = [124, 91, 62];
const LEAVES = [[61, 104, 58], [70, 116, 64], [52, 92, 53]];
const GRATE = [91, 68, 55];
const SOIL = [65, 52, 40];

const part = (name, shape, pos, size, color, material, extra = {}) => ({
  name,
  shape,
  pos,
  size,
  color,
  material,
  ...extra,
});

const box = (name, pos, size, color, material, extra) =>
  part(name, "box", pos, size, color, material, extra);

const ball = (name, pos, size, color) =>
  part(name, "ball", pos, size, color, "LeafyGrass", { canCollide: false });

function limb(name, from, to, diameter, color = BARK_LIGHT, canCollide = false) {
  const delta = to.map((value, axis) => value - from[axis]);
  const length = Math.hypot(...delta);
  const roll = Math.asin(delta[1] / length);
  const yaw = Math.atan2(-delta[2], delta[0]);
  return part(
    name,
    "cylinder",
    from.map((value, axis) => (value + to[axis]) / 2),
    [length, diameter, diameter],
    color,
    "Wood",
    { rot: [0, yaw * 180 / Math.PI, roll * 180 / Math.PI], canCollide },
  );
}

function grate() {
  return [
    box("GrateNorth", [0, -0.06, -2.825], [6, 0.12, 0.35], GRATE, "Metal"),
    box("GrateSouth", [0, -0.06, 2.825], [6, 0.12, 0.35], GRATE, "Metal"),
    box("GrateWest", [-2.825, -0.06, 0], [0.35, 0.12, 5.3], GRATE, "Metal"),
    box("GrateEast", [2.825, -0.06, 0], [0.35, 0.12, 5.3], GRATE, "Metal"),
    box("GrateRayWest", [-1.95, -0.06, 0], [1.4, 0.12, 0.22], GRATE, "Metal"),
    box("GrateRayEast", [1.95, -0.06, 0], [1.4, 0.12, 0.22], GRATE, "Metal"),
    box("GrateRayNorth", [0, -0.06, -1.95], [0.22, 0.12, 1.4], GRATE, "Metal"),
    box("GrateRaySouth", [0, -0.06, 1.95], [0.22, 0.12, 1.4], GRATE, "Metal"),
    part("CentralSoilOpening", "cylinder", [0, -0.08, 0], [0.08, 2.5, 2.5], SOIL, "Mud", {
      rot: [0, 0, 90],
      canCollide: false,
    }),
  ];
}

function tree() {
  const fork = [0.43, 7.72, 0];
  return [
    limb("TrunkLower", [0, 0, 0], [0.2, 4.5, 0.08], 0.95, BARK, true),
    limb("TrunkUpper", [0.2, 4.45, 0.08], [0.5, 8.4, -0.08], 0.68, BARK, true),
    limb("BranchWest", fork, [-2.35, 11.2, 0.65], 0.44),
    limb("BranchEast", fork, [2.75, 11.45, 0.25], 0.42),
    limb("BranchRear", [0.46, 7.82, -0.03], [0.1, 11.05, -2.75], 0.4),
    limb("BranchFront", [0.48, 7.82, 0.03], [0.9, 10.8, 2.65], 0.38),
    limb("TwigWest", [-2.35, 11.2, 0.65], [-4.15, 13.4, 1.15], 0.26),
    limb("TwigEast", [2.75, 11.45, 0.25], [4.1, 13.65, -0.7], 0.25),
    limb("TwigRear", [0.1, 11.05, -2.75], [-0.7, 13.45, -4.0], 0.24),
    limb("TwigFront", [0.9, 10.8, 2.65], [1.75, 13.05, 4.0], 0.23),
    ball("FoliageWest", [-3.0, 12.9, 0.5], [5.4, 4.8, 4.8], LEAVES[0]),
    ball("FoliageWestHigh", [-1.9, 14.8, -2.1], [4.6, 5.4, 4.2], LEAVES[1]),
    ball("FoliageCenter", [0.2, 13.6, 0.1], [5.0, 5.6, 4.8], LEAVES[2]),
    ball("FoliageCrown", [1.45, 15.0, -0.35], [4.2, 5.4, 4.2], LEAVES[0]),
    ball("FoliageEast", [3.55, 13.25, 0.3], [4.6, 4.6, 4.6], LEAVES[1]),
    ball("FoliageFront", [-0.65, 12.1, 3.35], [4.5, 4.2, 4.7], LEAVES[0]),
    ball("FoliageRear", [0.55, 12.65, -3.35], [4.3, 4.4, 4.7], LEAVES[2]),
    ball("FoliageEastFront", [2.85, 14.55, 2.55], [4.0, 4.3, 4.0], LEAVES[1]),
    ball("FoliageLowWest", [-3.25, 10.55, -1.45], [4.5, 4.5, 3.9], LEAVES[2]),
  ];
}

export function generate() {
  return [{
    action: "build",
    args: {
      kind: "prop",
      name: "StreetTree_Starburst",
      center: [0, 0, 0],
      parts: [...grate(), ...tree()],
    },
  }];
}
