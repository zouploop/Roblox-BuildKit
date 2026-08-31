# City vehicles and transit — build spec

## Shared style target
- Roblox-readable contemporary city props: chunky primary masses, thin details only for glazing, lights, trim, and signs.
- Fits a 22-stud two-lane road: each vehicle width is 0.25–0.32 × road width and leaves at least 4 studs per side within one 11-stud lane.
- Palette uses 1 body colour, charcoal structure/tires, cool blue-grey glass, warm off-white lights, and restrained red rear lights.
- Material vocabulary is limited to SmoothPlastic body/trim, Metal frame/bumper, Glass glazing, and Neon lamps.
- Every visible component is `kind: prop`; no generator-backed or Studio-derived content.

## CompactSedan_City

### Proportions
- Overall length : width : height is between 2.0–2.4 : 1 : 0.75–0.95.
- Cabin length is 0.45–0.60 × body length and cabin width is 0.75–0.90 × body width.
- Wheelbase is 0.58–0.72 × body length; front and rear wheel centers are symmetric within 0.15 stud.
- Wheel diameter is 0.38–0.52 × body height and each wheel visibly intersects the lower body edge.

### Inventory and silhouette
- Exactly 4 wheels at two recognizable axle positions.
- Separate lower body, hood, trunk, and raised cabin masses are visible.
- Front windshield, rear windshield, and left/right side windows use Glass.
- Two front lamps, two rear lamps, and front/rear bumpers are present.
- Front, side, and rear silhouettes remain recognizable as a sedan.

### Anti-features
- No single-box or toy-block silhouette.
- No wheel hidden entirely inside the body and no axle outside the body length.
- No cabin as wide as or longer than the lower body.
- No more than 28 parts.

## DeliveryVan_City

### Proportions
- Overall length : width : height is between 1.65–2.05 : 1 : 1.05–1.30.
- Cargo box length is 0.52–0.68 × overall length and cargo height is 0.72–0.90 × overall height.
- Wheelbase is 0.58–0.72 × overall length; wheel diameter is 0.28–0.40 × overall height.
- Cab front occupies 0.22–0.34 × overall length and is visibly stepped below the cargo roof.

### Inventory and silhouette
- Exactly 4 wheels at two recognizable axle positions.
- Separate chassis/lower body, cab, hood/nose, and cargo body masses are visible.
- Front windshield plus left/right cab windows use Glass; cargo sides remain opaque.
- Two headlights, two rear lights, front/rear bumpers, and one visible side-door seam/handle are present.
- Side silhouette reads as a delivery van rather than a bus or solid cuboid.

### Anti-features
- No single-box silhouette and no uninterrupted slab from bumper to bumper.
- No passenger-window strip across the cargo body.
- No wheel hidden entirely inside the chassis.
- No more than 30 parts.

## BusShelter_Glass

### Proportions
- Shelter width is 1.4–1.9 × shelter height; depth is 0.28–0.45 × width.
- Roof overhang is 0.04–0.10 × width on each end.
- Bench seat height is 0.18–0.25 × shelter height and bench length is 0.45–0.70 × width.
- Clear curb opening is at least 0.32 × shelter width with no crossbar below 0.75 × shelter height.

### Inventory and silhouette
- At least 4 vertical Metal frame posts, 1 roof, 2 or more Glass panels, and an open curb-facing side.
- Bench has a distinct seat and backrest plus at least 2 supports.
- Route-sign element has a post or frame plus a contrasting readable sign plate.
- Roof, frame, glazing, bench, and sign read distinctly in front and side silhouettes.
- Glass transparency is 0.35–0.60 and all glass is non-collidable.

### Anti-features
- No enclosed glass box; curb access remains unobstructed.
- No floating roof, bench, glass, or route sign.
- No glass coplanar with opaque framing.
- No more than 26 parts.
