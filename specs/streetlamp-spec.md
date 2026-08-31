# Streetlamp Spec

## Target

Pedestrian-scale contemporary North American streetlamp: restrained, durable, and readable from every side. Pivot is centered at grade `(0, 0, 0)`; `+Y` is up, `+X` is right, and the lamp head faces `-Z`. Overall envelope: `3.0 W x 13.5 H x 4.0 D` studs. All dimensions and placement increments use the `0.5`-stud detail grid.

## Exact Geometry

| Part | Size `(X,Y,Z)` | Center `(X,Y,Z)` | Notes |
|---|---:|---:|---|
| Foot plate | `(1.5, 0.5, 1.5)` | `(0, 0.25, 0)` | Square, slightly beveled if supported |
| Base collar | `(1.0, 1.0, 1.0)` | `(0, 1.0, 0)` | Short transition into pole |
| Pole | `(0.5, 10.5, 0.5)` | `(0, 6.75, 0)` | Straight vertical shaft |
| Rear elbow | `(0.5, 1.0, 0.5)` | `(0, 12.5, 0)` | Visible upright rise above shaft |
| Arm | `(0.5, 0.5, 2.5)` | `(0, 13.0, -1.0)` | Simple restrained cantilever toward `-Z` |
| Head housing | `(1.5, 0.5, 1.5)` | `(0, 13.0, -2.5)` | Broad side profile; slight taper optional |
| Lens | `(1.0, 0.5, 1.0)` | `(0, 12.5, -2.5)` | Downward-facing warm-white emitter |
| Top cap | `(1.0, 0.5, 1.0)` | `(0, 13.25, -2.5)` | Thin weather cap; top at `Y=13.5` |

## Silhouette Landmarks

- Tall narrow shaft with a clearly wider foot plate and head.
- One unmistakable forward arm and downward lens establish the `-Z` facing direction.
- Head remains legible in front, rear, side, and three-quarter views; no view collapses into an unbroken pole.
- Base, collar, arm, and cap create three scale breaks without ornamental clutter.

## Color and Materials

- Structure: dark charcoal metal, near `#2B2E32`, matte or low-gloss.
- Lens: warm white, near `#FFE3A3`, emissive/neon appearance without bloom obscuring its shape.
- Optional fasteners: one slightly lighter charcoal; do not introduce another accent color.
- Reference direction: [Ragni Nations](https://ragni-group.com/luminaire/nations/).

## Anti-features

- No Victorian ornament, exposed bulbs, banners, signs, planters, cables, or decorative scrollwork.
- No oversized highway cobra head, extreme curve, razor-thin members, or physically unsupported floating pieces.
- No mirrored second head; orientation must remain obvious.
- No glossy chrome, saturated colors, or cool-blue light.

## Performance Ceiling

Maximum `8` BaseParts and `1` light source per lamp. Prefer the emissive lens alone for distant or repeated lamps; enable a real light only for nearby hero placements. No unions, textures, decals, or unique meshes are required.

## Verification Checklist

- [ ] Pivot is at grade center and the lowest geometry touches `Y=0`.
- [ ] Total height is `13.5` studs and all sizes/offsets follow the `0.5`-stud grid.
- [ ] Arm and lens face `-Z`; `+X` remains the model's right side.
- [ ] Foot plate, collar, pole, arm, housing, lens, and cap match the inventory and dimensions above.
- [ ] Silhouette reads as a pedestrian streetlamp from front, rear, both sides, and three-quarter views.
- [ ] Charcoal structure and warm-white lens remain distinct under neutral lighting.
- [ ] No gaps, intersections, floating parts, or visible underside holes appear at normal viewing distance.
- [ ] BasePart and light counts stay within the performance ceiling.
