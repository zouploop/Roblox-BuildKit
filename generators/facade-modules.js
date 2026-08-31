// Reusable mixed-use facade modules for isolated Stage review and library export.

const BRICK = [142, 78, 64];
const CONCRETE = [184, 182, 172];
const METAL = [38, 42, 48];
const GLASS = [154, 181, 192];
const BRACE_LENGTH = Math.hypot(0.5, 2.8);
const BRACE_ROT_X = Math.atan2(-2.8, 0.5) * 180 / Math.PI;

const box = (name, pos, size, color, material, extra = {}) => ({
  name,
  shape: "box",
  pos,
  size,
  color,
  material,
  ...extra,
});

function upperFloorWindowBay() {
  return [
    box("BrickShellLeft", [-3.25, 7, 0.5], [1.5, 14, 1], BRICK, "Brick"),
    box("BrickShellRight", [3.25, 7, 0.5], [1.5, 14, 1], BRICK, "Brick"),
    box("BrickSpandrelBelow", [0, 1.5, 0.5], [5, 3, 1], BRICK, "Brick"),
    box("BrickSpandrelAbove", [0, 12.5, 0.5], [5, 3, 1], BRICK, "Brick"),

    box("GlassLeft", [-1.1875, 7, 0.525], [2.375, 8, 0.05], GLASS, "Glass", { transparency: 0.4, canCollide: false }),
    box("GlassRight", [1.1875, 7, 0.525], [2.375, 8, 0.05], GLASS, "Glass", { transparency: 0.4, canCollide: false }),
    box("FrameTop", [0, 10.875, 0.125], [5, 0.25, 0.25], METAL, "Metal"),
    box("FrameBottom", [0, 3.125, 0.125], [5, 0.25, 0.25], METAL, "Metal"),
    box("FrameLeft", [-2.375, 7, 0.125], [0.25, 7.5, 0.25], METAL, "Metal"),
    box("FrameRight", [2.375, 7, 0.125], [0.25, 7.5, 0.25], METAL, "Metal"),
    box("Mullion", [0, 7, 0.125], [0.25, 7.5, 0.25], METAL, "Metal"),
    box("ConcreteSill", [0, 2.75, 0], [5.5, 0.5, 1], CONCRETE, "Concrete"),
    box("ConcreteHeader", [0, 11.25, 0], [5.5, 0.5, 1], CONCRETE, "Concrete"),
  ];
}

function storefrontBay() {
  return [
    box("BrickPierLeft", [-7.5, 7, 0.5], [1, 14, 1], BRICK, "Brick"),
    box("BrickPierRight", [7.5, 7, 0.5], [1, 14, 1], BRICK, "Brick"),
    box("ConcreteHeader", [0, 12.5, 0.5], [14, 1, 1], CONCRETE, "Concrete"),

    box("DisplayGlassLeft", [-4.5, 5.5, 0.525], [5, 9, 0.05], GLASS, "Glass", { transparency: 0.4, canCollide: false }),
    box("DisplayGlassRight", [4.5, 5.5, 0.525], [5, 9, 0.05], GLASS, "Glass", { transparency: 0.4, canCollide: false }),
    box("EntryDoor", [0, 4.5, 0.525], [4, 9, 0.05], GLASS, "Glass", { transparency: 0.3, canCollide: false }),
    box("TransomGlassLeft", [-4.5, 11, 0.525], [5, 2, 0.05], GLASS, "Glass", { transparency: 0.4, canCollide: false }),
    box("TransomGlassDoor", [0, 11, 0.525], [4, 2, 0.05], GLASS, "Glass", { transparency: 0.4, canCollide: false }),
    box("TransomGlassRight", [4.5, 11, 0.525], [5, 2, 0.05], GLASS, "Glass", { transparency: 0.4, canCollide: false }),

    box("DoorFrameLeft", [-2, 4.5, 0.125], [0.25, 9, 0.25], METAL, "Metal"),
    box("DoorFrameRight", [2, 4.5, 0.125], [0.25, 9, 0.25], METAL, "Metal"),
    box("DoorFrameTop", [0, 9.125, 0.125], [4.25, 0.25, 0.25], METAL, "Metal"),
    box("TransomMullionLeft", [-2, 11, 0.125], [0.25, 2, 0.25], METAL, "Metal"),
    box("TransomMullionRight", [2, 11, 0.125], [0.25, 2, 0.25], METAL, "Metal"),
    box("TransomBar", [0, 10, 0.125], [14, 0.25, 0.25], METAL, "Metal"),
    box("DisplayKickLeft", [-4.5, 0.25, 0.125], [5, 0.5, 0.25], METAL, "Metal"),
    box("DisplayKickRight", [4.5, 0.25, 0.125], [5, 0.5, 0.25], METAL, "Metal"),
    box("ConcreteThreshold", [0, 0.125, 0], [4, 0.25, 1], CONCRETE, "Concrete"),

    box("Awning", [0, 10.25, -1.5], [12, 0.5, 3], METAL, "Metal"),
    // Box local Y runs from the wall anchor to the canopy's outer underside.
    box("AwningBraceLeft", [-5.5, 9.75, -1.4], [0.2, BRACE_LENGTH, 0.2], METAL, "Metal", { rot: [BRACE_ROT_X, 0, 0] }),
    box("AwningBraceRight", [5.5, 9.75, -1.4], [0.2, BRACE_LENGTH, 0.2], METAL, "Metal", { rot: [BRACE_ROT_X, 0, 0] }),
  ];
}

export function generate() {
  return [
    { action: "build", args: { kind: "prop", name: "UpperFloorWindowBay", center: [0, 0, 0], parts: upperFloorWindowBay() } },
    { action: "build", args: { kind: "prop", name: "StorefrontBay", center: [20, 0, 0], parts: storefrontBay() } },
  ];
}
