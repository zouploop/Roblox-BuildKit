# Mixed-Use Facade Modules

Grounded contemporary North American mixed-use facade kit: red brick, generous ground-floor glazing, dark metal frames and awnings, recessed upper openings, and restrained detailing.

## Shared contract

- Grid: 8-stud structural bays; details snap to 0.5 stud.
- Storey: 14 studs high, from `Y=0` to `Y=14`.
- Front faces `-Z`; right is `+X`.
- Pivot: bottom-center on the exterior wall plane (`Y=0`, `Z=0`). Geometry extends mainly toward `+Z`.
- Wall depth: 1 stud. Adjacent modules must meet with no gap or overlapping trim.
- Edge rule: keep the outer 0.5 stud of each side free of projecting details so modules tile cleanly.

## UpperFloorWindowBay

- Bounds: 8 W x 14 H x 1 D studs; pivot `(0, 0, 0)`.
- Brick wall: 8 x 14 x 1.
- Recessed opening: 5 W x 8 H; sill at `Y=3`; glass plane recessed 0.5 stud from the front face.
- Dark frame: 0.25-stud perimeter with one 0.25-stud vertical mullion.
- Sill: 5.5 W x 0.5 H x 1 D, projecting 0.5 stud.
- Header: 5.5 W x 0.5 H x 1 D; no ornate arch or keystone.
- Optional recess reveal: 0.5 stud on all four sides, flush with neighboring brick.

Inventory: brick shell, two glass panes, perimeter frame, center mullion, sill, header.

Silhouette landmarks: narrow vertical bay, deep rectangular reveal, thin paired window, crisp horizontal sill.

## StorefrontBay

- Bounds: 16 W x 14 H x 1 D studs; pivot `(0, 0, 0)`.
- Structural shell: two 1-stud brick piers, 14 studs high; 1-stud brick/concrete header from `Y=12` to `Y=13`.
- Glazed opening: 14 W x 10 H; sill at `Y=1`; glass plane recessed 0.5 stud.
- Entry: 4 W x 9 H, centered or offset 4 studs from center; threshold at `Y=0`.
- Display glazing: remaining opening split into panes no wider than 5 studs by 0.25-stud mullions.
- Transom: 2 studs high, beginning at `Y=10`, aligned to door and display divisions.
- Awning: 12 W x 0.5 H x 3 D; underside at `Y=10`; projects toward `-Z`; 0.5-stud dark supports.
- Base/kick plate: 0.5 stud high beneath display glazing; doorway remains clear.

Inventory: two brick piers, header, door, display panes, transom panes, dark metal frames/mullions, kick plates, awning, two supports.

Silhouette landmarks: broad transparent ground floor, visible recessed entry, strong dark horizontal awning, solid brick piers framing the bay.

## Palette and materials

- Primary: muted red or brown-red `Brick`; vary neighboring modules subtly, not individual bricks.
- Trim: warm light gray `Concrete` for sills, headers, and thresholds.
- Metal: charcoal/near-black `Metal` for frames, mullions, supports, and awnings.
- Glass: slightly blue-gray `Glass`, low tint and enough transparency to read as glazing.
- Accent: one restrained storefront color may appear on the door or awning; never both at high saturation.

## Anti-features

- No exposed neon, oversized logos, ornate historic cornices, fantasy trim, bevel-heavy geometry, or fully black glass.
- No paper-thin walls, floating awnings, blocked doorways, inconsistent floor heights, or details crossing module edges.
- Do not model individual brick units; material and color carry the brick reading.
- Avoid perfectly flush glazing: the 0.5-stud recess is required for depth.

## Verification checklist

- [ ] Both pivots are bottom-center at `Y=0`, on the `Z=0` wall plane, with fronts facing `-Z`.
- [ ] Upper bay measures 8 x 14 studs; storefront measures 16 x 14 studs.
- [ ] Two upper bays align exactly above one storefront bay on the 8-stud grid.
- [ ] Side-by-side modules have no gaps, overlaps, or trim crossing shared edges.
- [ ] Glazing is recessed 0.5 stud and remains visibly transparent.
- [ ] Storefront doorway reaches grade and is unobstructed.
- [ ] Awning projects toward `-Z`, is supported, and does not exceed module width.
- [ ] Brick, concrete, metal, glass, and accent roles remain visually distinct.
- [ ] Front, rear, both sides, and top show no floating or hidden stray parts.

Reference: [Mosaic Homes](https://mosaichomes.com/)
