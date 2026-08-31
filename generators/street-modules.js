const ASPHALT = [54, 53, 50];
const CONCRETE = [174, 172, 166];
const FURNITURE_ZONE = [162, 160, 154];
const JOINT = [143, 142, 138];
const MARKING = [214, 211, 198];
const TACTILE = [158, 92, 58];

const box = (name, pos, size, color, material, extra = {}) => ({
  name,
  shape: "box",
  pos,
  size,
  color,
  material,
  ...extra,
});

function road() {
  return [
    box("Asphalt", [0, -0.25, 0], [22, 0.5, 32], ASPHALT, "Asphalt"),
    ...[-12, -4, 4, 12].map((z, index) =>
      box(`CenterDash${index + 1}`, [0, 0.056, z], [0.25, 0.1, 4], MARKING, "SmoothPlastic", { canCollide: false })
    ),
  ];
}

function sidewalk() {
  return [
    box("Curb", [-3.75, 0.25, 0], [0.5, 0.5, 32], FURNITURE_ZONE, "Concrete"),
    box("FurnitureZone", [-2.75, 0.25, 0], [1.5, 0.5, 32], FURNITURE_ZONE, "Concrete"),
    box("ClearZone", [1, 0.25, 0], [6, 0.5, 32], CONCRETE, "Concrete"),
    ...[-8, 0, 8].map((z, index) =>
      box(`ExpansionJoint${index + 1}`, [0, 0.556, z], [8, 0.1, 0.1], JOINT, "Concrete", { canCollide: false })
    ),
  ];
}

function cornerRamp() {
  return [
    box("CrossStreetCurb", [4, 0.25, 0.25], [8, 0.5, 0.5], FURNITURE_ZONE, "Concrete"),
    box("CornerLanding", [4, 0.25, 1.25], [8, 0.5, 1.5], CONCRETE, "Concrete"),
    box("RoadCurbReturn", [0.25, 0.25, 19.5], [0.5, 0.5, 25], FURNITURE_ZONE, "Concrete"),
    box("MainWalk", [4.25, 0.25, 19.5], [7.5, 0.5, 25], CONCRETE, "Concrete"),
    box("OuterLanding", [7, 0.25, 4.5], [2, 0.5, 5], CONCRETE, "Concrete"),
    {
      name: "Ramp",
      shape: "wedge",
      pos: [3, 0.25, 4.5],
      size: [5, 0.5, 6],
      rot: [0, -90, 0],
      color: CONCRETE,
      material: "Concrete",
    },
    box("TactileBand", [1, 0.125, 4.5], [2, 0.08, 5], TACTILE, "Brick", {
      rot: [0, 0, 4.764],
      canCollide: false,
    }),
  ];
}

export function generate() {
  return [
    { action: "build", args: { kind: "prop", name: "Road_Straight_2Lane", center: [0, 0, 0], parts: road() } },
    { action: "build", args: { kind: "prop", name: "Sidewalk_Curb_Straight", center: [36, 0, 0], parts: sidewalk() } },
    { action: "build", args: { kind: "prop", name: "Sidewalk_Corner_Ramp_90", center: [52, 0, -16], parts: cornerRamp() } },
  ];
}
