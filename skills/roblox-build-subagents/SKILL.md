---
name: roblox-build-subagents
description: Coordinate parallel subagents through isolated roblox-buildkit headless Stage sessions to build, render, review, and combine props or map regions without letting workers modify Roblox Studio. Use for large Roblox maps or asset sets that can be divided into independent visual build briefs.
---

# Roblox Build Subagents

Use one coordinator and normally two to five workers. Each worker gets a unique Stage
session and an independent map region or asset brief. Workers build and inspect in
headless Three.js; only the coordinator combines accepted results, and only the
coordinator may port to Studio.

## Non-negotiable boundaries

- Never let a worker omit `session`. The omitted value is the shared `default` Stage.
- Session IDs must be 1-64 letters, numbers, underscores, or hyphens.
- The server allows six active Stage sessions total, including `default`. Reserve one for
  integration, so use at most five workers. `rbx_stage_clear` does not release a session;
  if capacity is exhausted, close stale session tabs and let idle headless pages close
  before retrying.
- Workers may call only `rbx_stage_build`, `rbx_stage_status`, `rbx_stage_render`,
  `rbx_stage_clear`, `rbx_library_save`, and `rbx_library_list`.
- Workers must not call `rbx_stage_commit`, Studio/bridge tools, Mirror tools, or edit the
  default Stage. They save candidates to the library and report back.
- Build visible candidates as `action:"build", args.kind:"prop"` with raw parts. Other
  build kinds appear only as placeholder boxes in the headless renderer and cannot pass
  visual QA there.
- `rbx_stage_build` appends. Before replacing a candidate, call `rbx_stage_clear` and send
  the complete revised op list; otherwise old and new geometry stack together.
- Clear removes manual ops but keeps enabled generator files. Generator toggles are also
  session-specific: disabling one in `default` does not disable it for a worker. Prepare
  each worker session by opening its returned `stage.html?session=...` URL and disabling
  unrelated generators in that session's Library panel. Then require the worker's first
  `rbx_stage_status(detail:true)` to show no enabled generator ops. If it does not, stop;
  that render is contaminated and is not evidence for the worker's candidate.

## Summon a headless renderer

The first `rbx_stage_render` call lazily starts the shared headless browser and creates one
page for that session. No visible browser or Studio window is required.

After the coordinator has prepared session `map-roads`, the worker loop is:

1. `rbx_stage_clear({session:"map-roads"})`
2. `rbx_stage_build({session:"map-roads", ops:[...]})`
3. `rbx_stage_status({session:"map-roads", detail:true})`
4. `rbx_stage_render({session:"map-roads", angles:[...]})`
5. Inspect every returned image, revise the full op list, clear, and repeat.
6. Save the accepted exact ops with `rbx_library_save` and clear the session.

Use one to eight angles. A useful map-chunk pass is:

```json
[
  {"azimuth":45,"elevation":25},
  {"azimuth":135,"elevation":25},
  {"azimuth":225,"elevation":25},
  {"azimuth":315,"elevation":25},
  {"azimuth":0,"elevation":80}
]
```

The renderer frames the complete session automatically, hides editor chrome, and returns
PNG images. Require another iteration when any angle exposes gaps, floating pieces,
intersections, missing backs/sides, bad scale, or an unclear silhouette.

## Divide the map before spawning workers

Write one shared contract first. Create the shared AI library category before workers
start, so workers do not race to create it. Include:

- ground height, units, grid size, road and sidewalk widths;
- map bounds and each worker's non-overlapping region bounds;
- boundary anchors where roads, sidewalks, walls, and utilities must meet;
- naming prefix, palette, materials, collision intent, and part budget;
- which details may cross a boundary and which worker owns each shared seam.

Prefer spatial regions when workers are building the final map: each worker emits geometry
at its assigned world coordinates, so integration is concatenation rather than guessed
translation. Prefer local-origin asset briefs for reusable props such as lamps, trees,
benches, storefront bays, and vehicles.

Do not assign two workers the same seam. For example, the road worker owns the road and
curb edge; the building worker starts at the supplied sidewalk/building line. Shared
measurements are fixed inputs, not values each worker may reinterpret.

## Launch workers together

Use the environment's subagent/delegation tool to start all independent workers in one
batch, then wait for them together. Give each worker this minimum brief:

```text
You own headless Stage session SESSION_ID and map region/asset BRIEF.
Follow the supplied coordinate, boundary, palette, naming, and part-budget contract.
Never omit SESSION_ID from an rbx_stage_* call. Never touch Studio, Mirror, the default
Stage, generator files, or rbx_stage_commit.

Clear SESSION_ID, build the full candidate with kind:"prop" ops, check detailed status,
and render it from the required angles. Inspect the actual images and iterate until every
angle is structurally clean. Save the exact accepted ops with rbx_library_save under
LIBRARY_CATEGORY, clear SESSION_ID, and return: preset name/file, final ops, bounds,
anchor/facing, part count, angles checked, and any unresolved seam risk.
```

Give workers independent briefs. Do not ask one worker to wait for another; dependencies
belong in a second wave after the first results are integrated.

## Integrate the map

The coordinator owns integration:

1. Reject any result lacking final ops, bounds, or multi-angle evidence.
2. Check every result against the shared contract before combining it.
3. For region briefs, concatenate the accepted world-space ops. For reusable local-origin
   assets, place copies using the declared anchor and facing; do not eyeball offsets.
4. Clear the `default` Stage once, then stage the complete combined candidate.
5. Run `rbx_stage_status(detail:true)` and render the whole map from at least four
   diagonals plus a high overview.
6. Fix cross-region gaps, overlaps, blocked roads, inconsistent scale, and repeated visual
   patterns in the integrated map, not in isolation.
7. Save a combined library preset or repeatable generator only after the integrated render
   passes. Call `rbx_stage_commit` only when the user has authorized porting to Studio.

Headless success is not final Studio QA. After an authorized commit, the coordinator uses
the normal Roblox building workflow to inspect navigation, collisions, anchoring,
materials, lighting, and live geometry in Studio.

## Completion report

Report the worker/session assignments, accepted library presets, rejected or revised
results, integrated bounds and part count, angles inspected, remaining seam risks, and
whether anything was ported to Studio. Never describe an isolated worker render as proof
that the combined map is correct.
