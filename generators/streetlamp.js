const CHARCOAL = [43, 46, 50];
const WARM_LENS = [255, 227, 163];

const box = (name, pos, size, color = CHARCOAL, material = "Metal", extra = {}) => ({
  name,
  shape: "box",
  pos,
  size,
  color,
  material,
  ...extra,
});

export function generate() {
  const parts = [
    box("FootPlate", [0, 0.25, 0], [1.5, 0.5, 1.5]),
    box("BaseCollar", [0, 1, 0], [1, 1, 1]),
    box("Pole", [0, 6.75, 0], [0.5, 10.5, 0.5]),
    box("RearElbow", [0, 12.5, 0], [0.5, 1, 0.5]),
    box("Arm", [0, 13, -1], [0.5, 0.5, 2.5]),
    box("HeadHousing", [0, 13, -2.5], [1.5, 0.5, 1.5]),
    box("Lens", [0, 12.5, -2.5], [1, 0.5, 1], WARM_LENS, "Neon", {
      canCollide: false,
      light: { color: WARM_LENS, brightness: 1.5, range: 12 },
    }),
    box("TopCap", [0, 13.25, -2.5], [1, 0.5, 1]),
  ];

  return [{
    action: "build",
    args: { kind: "prop", name: "Streetlamp_Pedestrian", center: [0, 0, 0], parts },
  }];
}
