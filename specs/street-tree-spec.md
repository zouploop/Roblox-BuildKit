# Street Tree

Mature urban street tree for a grounded contemporary North American district. The asset must read as maintained city infrastructure, not wilderness vegetation.

## Coordinate contract

- Pivot: grade center at `(0, 0, 0)`.
- Up: `+Y`; front/street-facing: `-Z`; right: `+X`.
- Overall bounds: `12 × 18 × 12` studs.
- All geometry except the grate stays within a `5 × 5` stud sidewalk footprint below `Y=7.5`.

## Dimensions

- Grate: `6 × 0.12 × 6` studs, top flush at `Y=0`; square outer frame with a `2.5`-stud circular center opening.
- Trunk: `0.95`-stud diameter at grade, tapering to `0.55` studs at `Y=8.5`.
- First branch split: `Y=7.5`; highest branch endpoint: `Y=14.5`.
- Canopy: irregular rounded crown, `12 × 10 × 11` studs, centered at `(0.3, 13, 0)`; top at `Y=18`.
- Lowest foliage: `Y=8`, preserving pedestrian headroom and clear sightlines.

## Part inventory

- 1 square grate frame with radial or starburst slots.
- 1 circular inner grate ring.
- 1 tapered trunk.
- 4 primary branches, each tapering away from the trunk.
- 6–8 secondary branches; at least 2 must remain partly visible through the crown.
- 8–12 overlapping foliage clusters in 3 sizes; no single cluster forms the entire canopy.
- Optional: 1 recessed soil disk inside the center opening.

## Silhouette landmarks

- Slight trunk lean toward `+X`, with a visible taper from every side.
- Asymmetric four-way crown: widest toward `-X`, tallest just right of center.
- One readable fork below the foliage mass and two small canopy gaps.
- Crown edge varies in height and depth; it must not read as a sphere, cube, cone, or stacked balls.
- Grate remains visibly square at ground level with a clearly circular center.

## Color and material roles

- Bark: muted medium brown, low-saturation, matte rough surface; branches may be slightly lighter.
- Foliage: restrained medium/deep greens using 2–3 close values, matte; no neon or uniformly saturated green.
- Grate: rust-brown or charcoal-black metal, matte with subtle value variation; based on the [Starburst tree grate](https://greenblue.com/na/products/starburst-tree-grate/).
- Soil: dark desaturated brown.
- Surrounding sidewalk context, when shown: patterned medium gray concrete; the grate top must remain flush.

## Anti-features

- No exposed roots, planter wall, floating grate, or geometry below grade that blocks placement.
- No perfectly radial branches, mirrored crown, topiary sphere, palm silhouette, fruit, flowers, or seasonal effects.
- No foliage below `Y=8`, branches crossing the sidewalk footprint below `Y=7.5`, or canopy wider than 12 studs.
- No glossy bark, emissive colors, excessive transparency, or paper-thin leaf cards.

## LOD and performance ceiling

- Maximum 28 renderable parts and 1 light-free model; target 20–24 parts.
- Maximum 12 foliage clusters and 12 branch/trunk parts.
- No per-leaf geometry, textures required for silhouette, scripts, particles, lights, or collisions on foliage/branches.
- Only trunk and grate may collide; the crown must remain non-collidable.

## Verification checklist

- [ ] Pivot is exactly at grade center and the grate top is flush at `Y=0`.
- [ ] Bounds do not exceed `12 × 18 × 12` studs.
- [ ] Trunk diameter tapers from `0.95` to `0.55` studs and first splits at `Y=7.5`.
- [ ] Nothing exceeds the `5 × 5` sidewalk footprint below `Y=7.5`, excluding the grate.
- [ ] Crown uses 8–12 clusters, has two visible gaps, and reads asymmetrically from front, side, and rear.
- [ ] At least two secondary branches are visible through the crown.
- [ ] Grate reads as a `6 × 6` square with a `2.5`-stud circular opening and radial/starburst slots.
- [ ] Colors remain muted and materials read matte under neutral lighting.
- [ ] Renderable part count is 28 or fewer; only trunk and grate collide.
