# CornerBuildingShell_3Story — build spec

## Style target
Roblox-readable urban corner shell: chunky brick-and-concrete structure with dark metal service equipment, sized for modular storefront insertion. Detail must read at street distance; no photoreal micro-trim.

## Bounds and orientation
- PASS only if total structural footprint is 32 studs wide (X) and approximately 24 studs deep (Z), excluding no hidden geometry.
- PASS only if total height is 31–33 studs and three storeys are legible from horizontal bands.
- PASS only if the storefront/front faces local -Z.

## Front modular openings
- PASS only if the front is split into two nominal 16-stud bays by outer supports and one central support.
- PASS only if each bay retains an unobstructed ground-floor opening at least 14 studs wide and 10 studs tall.
- PASS only if no slab, wall, glass, or decorative panel fills either ground-floor opening.

## Part inventory
- 1 ground slab and 1 roof slab.
- 3 full-height front supports: left edge, center, right edge.
- 2 front floor bands plus 1 front cornice/roof band.
- Side structure on both sides and back structure must include vertical supports and horizontal rails; no unsupported open rear or side edge.
- 4 parapet runs enclosing the roof perimeter.
- Rooftop service cluster must contain at least 3 readable parts: housing, raised fan/cap, and duct/secondary box.
- Total inventory must stay between 28 and 50 raw `kind:'prop'` parts.

## Proportions
- Ground storey height is 0.34–0.42 × total height.
- Upper-storey spacing is 0.24–0.32 × total height per storey.
- Floor/cornice bands are 0.03–0.07 × total height thick.
- Parapet height is 0.05–0.10 × total height.
- Rooftop service cluster occupies 0.15–0.30 × building width and does not dominate the roof silhouette.

## Palette and materials
- Primary masonry uses muted red brick near RGB `[142,78,64]` with `Brick` material.
- Structural bands/slabs use warm pale concrete near RGB `[184,182,172]` with `Concrete` material.
- Rooftop service detail uses charcoal near RGB `[38,42,48]` with `Metal` material.
- No more than four material/color roles appear in the shell.

## Silhouette and all-side checks
- Front view clearly shows two tall openings, three storeys, and a projecting cornice line.
- Both side views show repeated structural bays instead of one uninterrupted slab wall.
- Rear view is structurally closed by a framed grid or wall-and-frame composition.
- Elevated views clearly show the continuous parapet and an asymmetrically placed rooftop service cluster.
- All visible pieces touch or intentionally sit on another structural piece; no floating members.

## Anti-features
- FAIL if the building reads as one solid featureless box.
- FAIL if either storefront opening is blocked.
- FAIL if the front is symmetrical only because all side/back structure is absent.
- FAIL if fine mullions, handles, signage text, bolts, or other micro-detail is added.
- FAIL if rooftop equipment is a single token cube or rises above 33 studs.
