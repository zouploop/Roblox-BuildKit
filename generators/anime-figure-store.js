const WHITE = [226, 228, 232];
const WALL = [198, 202, 210];
const FLOOR = [154, 160, 170];
const DARK = [42, 47, 56];
const GLASS = [150, 196, 218];
const LIGHT = [245, 241, 220];
const SECTION_COLORS = [
  [226, 94, 116], [238, 151, 70], [231, 202, 79], [91, 181, 124],
  [69, 162, 204], [102, 119, 214], [157, 105, 205], [217, 111, 184],
];

const box = (name, pos, size, color, material, extra = {}) => ({
  name, shape: "box", pos, size, color, material, ...extra,
});

function shell() {
  const parts = [
    box("Floor", [0, 0.5, 0], [178, 1, 124], FLOOR, "Concrete"),
    box("Roof", [0, 28.5, 0], [180, 1, 126], WALL, "Concrete"),
    box("LeftWall", [-89.5, 14, 0], [1, 28, 126], WALL, "Concrete"),
    box("RightWall", [89.5, 14, 0], [1, 28, 126], WALL, "Concrete"),
    box("RearWallLeft", [-47.5, 14, 62.5], [83, 28, 1], WALL, "Concrete"),
    box("RearWallRight", [47.5, 14, 62.5], [83, 28, 1], WALL, "Concrete"),
    box("RearExitHeader", [0, 24, 62.5], [12, 8, 1], WALL, "Concrete"),
    box("RearExitDoor", [0, 10.5, 62.0], [11, 19, 0.25], DARK, "Metal"),
    box("FrontWallLeft", [-51.5, 14, -62.5], [75, 28, 1], WALL, "Concrete"),
    box("FrontWallRight", [51.5, 14, -62.5], [75, 28, 1], WALL, "Concrete"),
    box("EntranceHeader", [0, 24, -62.5], [28, 8, 1], WALL, "Concrete"),
    box("EntryGlassLeft", [-7, 10.4, -62.0], [13, 18.8, 0.18], GLASS, "Glass", { transparency: 0.35, canCollide: false }),
    box("EntryGlassRight", [7, 10.4, -62.0], [13, 18.8, 0.18], GLASS, "Glass", { transparency: 0.35, canCollide: false }),
    box("EntryFrameLeft", [-14, 10.5, -61.7], [0.35, 19, 0.35], DARK, "Metal"),
    box("EntryFrameCenter", [0, 10.5, -61.7], [0.35, 19, 0.35], DARK, "Metal"),
    box("EntryFrameRight", [14, 10.5, -61.7], [0.35, 19, 0.35], DARK, "Metal"),
    box("EntryFrameTop", [0, 20, -61.8], [28, 0.35, 0.35], DARK, "Metal"),
    box("ExteriorSign", [0, 24.5, -63.1], [38, 4.5, 0.6], DARK, "Metal"),
    box("ExteriorSignInset", [0, 24.5, -63.5], [34, 2.5, 0.15], [111, 188, 224], "Neon", { canCollide: false }),
  ];
  for (const x of [-60, -30, 0, 30, 60]) {
    for (const z of [-48, -28, -8, 12, 32, 52]) {
      const lit = [-60, 0, 60].includes(x) && [-48, -8, 32].includes(z);
      parts.push(box(`CeilingLight_${x}_${z}`, [x, 27.9, z], [14, 0.2, 1.2], LIGHT, "Neon", {
        canCollide: false,
        ...(lit ? { light: { color: LIGHT, brightness: 1.5, range: 34 } } : {}),
      }));
    }
  }
  return parts;
}

function shelfSegment(length, color) {
  const innerLength = length - 0.65;
  const parts = [
    box("CenterSpine", [0, 5.25, 0], [0.18, 8.5, innerLength], DARK, "Metal"),
    box("BaseLeft", [-0.755, 0.75, 0], [1.33, 0.5, innerLength], DARK, "Metal"),
    box("BaseRight", [0.755, 0.75, 0], [1.33, 0.5, innerLength], DARK, "Metal"),
  ];
  for (const y of [1.2, 3.1, 5, 6.9, 8.8]) {
    parts.push(box(`ShelfLeft_${y}`, [-0.755, y, 0], [1.33, 0.22, innerLength], WHITE, "Metal"));
    parts.push(box(`ShelfRight_${y}`, [0.755, y, 0], [1.33, 0.22, innerLength], WHITE, "Metal"));
  }
  const end = length / 2 - 0.2;
  for (const x of [-1.52, 1.52]) {
    parts.push(box(`Post_${x}_Front`, [x, 5.25, -end], [0.2, 8.5, 0.25], DARK, "Metal"));
    parts.push(box(`Post_${x}_Back`, [x, 5.25, end], [0.2, 8.5, 0.25], DARK, "Metal"));
  }
  parts.push(box("SectionHeaderFront", [0, 10.25, -end], [3.6, 1.5, 0.35], color, "SmoothPlastic"));
  parts.push(box("SectionHeaderBack", [0, 10.25, end], [3.6, 1.5, 0.35], color, "SmoothPlastic"));
  return parts;
}

function rearWallShelf(width, color) {
  const parts = [
    box("Back", [0, 5.25, 0.9], [width - 0.5, 8.5, 0.2], DARK, "Metal"),
    box("Base", [0, 0.75, -0.1], [width - 0.5, 0.5, 1.8], DARK, "Metal"),
  ];
  for (const y of [1.2, 3.1, 5, 6.9, 8.8]) parts.push(box(`Shelf_${y}`, [0, y, -0.1], [width - 0.5, 0.22, 1.8], WHITE, "Metal"));
  for (const x of [-width / 2 + 0.125, width / 2 - 0.125]) parts.push(box(`Post_${x}`, [x, 5.25, -0.1], [0.25, 8.5, 1.8], DARK, "Metal"));
  parts.push(box("SectionHeader", [0, 10.25, 0.8], [width, 1.5, 0.35], color, "SmoothPlastic"));
  return parts;
}

export function generate() {
  const ops = [{ action: "build", args: { kind: "prop", name: "FigureStore_Shell", center: [0, 0, 0], parts: shell() } }];
  const xs = [-74.5, -65, -55.5, -46, -36.5, -27, -17.5, -8, 8, 17.5, 27, 36.5, 46, 55.5, 65, 74.5];
  xs.forEach((x, index) => {
    const section = String(index + 1).padStart(2, "0");
    const color = SECTION_COLORS[index % SECTION_COLORS.length];
    ops.push({ action: "build", args: { kind: "prop", name: `AnimeSection_${section}_Front`, center: [x, 0.5, -27], parts: shelfSegment(32, color) } });
    ops.push({ action: "build", args: { kind: "prop", name: `AnimeSection_${section}_Rear`, center: [x, 0.5, 23], parts: shelfSegment(56, color) } });
  });
  for (let i = 0; i < 8; i++) {
    const x = -70 + i * 20;
    ops.push({ action: "build", args: { kind: "prop", name: `AnimeWallSection_${String(i + 1).padStart(2, "0")}`, center: [x, 0.5, 60.5], parts: rearWallShelf(16, SECTION_COLORS[i]) } });
  }
  const partCount = ops.reduce((sum, op) => sum + op.args.parts.length, 0);
  if (partCount > 795) throw new Error(`store has ${partCount} parts; stage cap is 795`);
  for (const op of ops) for (const part of op.args.parts) if (part.size.some((value) => value <= 0)) throw new Error(`invalid size: ${op.args.name}/${part.name}`);
  return ops;
}
