# Street Module Family Specification

## Style target

Grounded contemporary North American main street: practical two-lane geometry, accessible concrete sidewalks, restrained markings, and modular seams that disappear when repeated. Scale reference: `1 stud ~= 28 cm`.

## Shared frame and interfaces

- Axes: `+Y` up, `-Z` forward/travel direction, `+X` right.
- Every reusable asset pivot sits at grade (`Y = 0`) and at its own horizontal center unless noted.
- Longitudinal seams land at `Z = +/-16`; adjacent modules join in 32-stud increments.
- Road/curb boundary is `X = +/-11`. Sidewalk outer edge is `X = +/-19`.
- Parts touching a module seam must end exactly on that seam without overlap or a visible gap.

## Modules

### `Road_Straight_2Lane`

- Bounds: `22 X 0.5 X 32` studs; pavement top at `Y = 0`.
- Pivot: `(0, 0, 0)`.
- Travel lanes: two 11-stud lanes split at `X = 0`.
- Inventory: one asphalt slab, one dashed centerline set, optional solid edge-line pair.
- Landmark: long, flat dark ribbon with a clear center divide; no raised geometry in the travel lanes.

### `Sidewalk_Curb_Straight`

- Bounds: `8 X 0.5 X 32` studs with local edges at `X = +/-4`.
- Pivot: `(0, 0, 0)`; place at world `X = 15` for the right side or `X = -15` for the left side of a road centered at `X = 0`.
- Zones: 6-stud clear through zone at the outer side and 2-stud furniture zone next to the curb.
- Curb: 0.5 stud above road grade; sidewalk walking surface aligns to curb top.
- Inventory: concrete walk slab, continuous curb, subtle expansion joints at 8-stud intervals.
- Landmark: crisp continuous curb edge and uninterrupted 6-stud walking corridor.

### `Sidewalk_Corner_Ramp_90`

- Footprint: fits the same 8-stud sidewalk band and a 32-stud corner module.
- Pivot: corner curb intersection at grade; rotation in 90-degree steps must preserve interfaces.
- Ramp: 5-stud clear width, 6-stud run, descending 0.5 stud to road grade.
- Detectable warning: full ramp width, 2 studs deep, directly behind the road edge.
- Inventory: corner sidewalk slab, two curb returns, ramp surface, tactile warning surface.
- Landmark: readable 90-degree curb return, broad centered ramp, contrasting tactile band.

## Color and material roles

- Road: near-black warm gray asphalt, matte and slightly lighter than pure black.
- Sidewalk/curb: medium-light neutral concrete; joints are shallow tone changes, not deep grooves.
- Markings: muted traffic white; avoid emissive or pure-white glare.
- Tactile warning: subdued brick red or ochre with clear value contrast against concrete.

## Anti-features

- No lane wider than 11 studs, decorative median, parking lane, bike lane, gutters, props, or vegetation in this family.
- No bevels or trim that change the exact seam dimensions.
- No blocked clear zone, curb discontinuity outside the ramp, floating markings, z-fighting, or hidden overlap between modules.
- No exaggerated cracks, saturated colors, glossy asphalt, or oversized tactile domes.

## Verification

Manual:

- Place three road modules end-to-end; confirm a continuous 22-stud surface with no gap, overlap, or marking jump.
- Attach and mirror straight sidewalks; confirm road edges at `X = +/-11`, outer edges at `X = +/-19`, and a clear 6-stud corridor.
- Replace one straight sidewalk end with each 90-degree ramp rotation; confirm all curb and sidewalk surfaces align.
- Inspect at road level and overhead; confirm the ramp reaches road grade, the tactile band remains visible, and no part enters either travel lane.
- Toggle collision visualization; confirm only intended walking, curb, ramp, and road surfaces collide.

## References

- https://nacto.org/publication/urban-street-design-guide/street-design-elements/lane-width/
- https://nacto.org/publication/urban-street-design-guide/street-design-elements/sidewalks/sidewalk-design/
- https://www.access-board.gov/prowag/technical.html
