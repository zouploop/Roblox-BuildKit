# City intersection pack — build spec

## Shared style target

Chunky, legible Roblox city infrastructure using the existing street kit's restrained palette and material vocabulary. Geometry must read at street distance without tiny decorative noise. Every saved preset contains only one `kind: prop` build op made from raw parts.

## Shared palette and material rules

- Asphalt is `[54,53,50]` / `Asphalt`; painted road markings are `[214,211,198]` / `SmoothPlastic` and sit at `y = 0.056` with `0.1` thickness.
- Structural street metal uses charcoal `[43,46,50]` or `[38,42,48]` / `Metal`.
- Concrete uses `[184,182,172]` / `Concrete`.
- Signal lenses use distinct red, amber, and green colours with `Neon`; non-lens signal parts remain charcoal metal.
- No part has any horizontal dimension below `0.2` studs, except road-marking thickness and lens face depth.

## Road_Intersection_4Way_2Lane

### Proportions and alignment

- Module footprint is exactly `32 × 32` studs; asphalt top is `y = 0`, matching `Road_Straight_2Lane`.
- Each entering road throat is exactly `22` studs wide, leaving `5 × 5` corner zones at every corner.
- Centerline markings use the existing `0.25`-stud width and stop before the conflict area.

### Part inventory

- 1 asphalt base, 4 concrete corner pads, 8 approach centerline dashes, and 4 stop bars; total exactly 17 parts.
- Every marking is non-collidable and raised above asphalt without sharing a coplanar face.

### Silhouette and anti-features

- Top view reads as one continuous four-way crossing with four equal road throats and four equal corner pads.
- All four approaches are rotationally symmetric at 90-degree intervals.
- No center obstruction, median, diagonal road, full-width concrete strip, or markings extending through the intersection center.

## Crosswalk_2Lane_32

### Proportions and alignment

- Module footprint is exactly `22 × 32` studs with asphalt top at `y = 0`.
- Crosswalk spans `16` studs across the road, leaving `3` studs of asphalt margin at each curb edge.
- Zebra field is `8` studs long, centered on the module, with evenly spaced stripes.

### Part inventory

- 1 asphalt base, 9 equal zebra stripes, 2 stop bars, and 4 center dashes outside the zebra field; total exactly 16 parts.
- Zebra stripes are `16 × 0.65` studs, evenly distributed from `z = -4` through `z = 4`.
- Stop bars span `18` studs and sit beyond the zebra field on both approaches.
- Every marking is non-collidable and raised above asphalt without sharing a coplanar face.

### Silhouette and anti-features

- Top view immediately reads as a pedestrian crossing across a two-lane road.
- The crossing and stop bars are bilaterally symmetric on both road axes.
- No stripe reaches the road edge; no center dash passes through the crossing; no stretched, merged, or irregular stripe.

## TrafficSignal_Cantilever

### Proportions

- Overall height is `18–21` studs and cantilever reach is `11–14` studs from pole center.
- Pole thickness is `0.6–0.9` studs; base footprint is `1.8–2.5` times pole thickness.
- Vehicle signal head height is `4–6` times its width, with three equal lens bays.
- Lowest structural clearance beneath cantilever is at least `14` studs.

### Part inventory

- 1 foot plate, 1 base collar, 1 pole, 1 cantilever arm, and at least 2 arm/pole mounting parts.
- 1 vehicle backplate/housing, exactly 3 equally sized lenses ordered red over amber over green, and at least 3 short lens hoods.
- 1 pedestrian-signal housing, 1 contrasting pedestrian face, and at least 2 mounting parts connecting it to the pole.
- Total is `18–28` parts; all parts are raw boxes or cylinders and only lenses/faces may be non-collidable.

### Silhouette and anti-features

- Front and rear views show a tall pole, long cantilever, hanging three-lens head, and lower pedestrian signal.
- Both side views retain a visible pole-to-arm elbow, signal-head depth/backplate, pedestrian housing depth, and base step.
- Head hangs below the arm rather than balancing above it; pedestrian signal is pole-mounted below the arm.
- No floating parts, razor-thin structural members, oversized lenses, extra decorative bolts, duplicated lens stacks, or ambiguous lens order.
