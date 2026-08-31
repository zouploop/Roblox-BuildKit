---
name: roblox-building
description: "Use when building or improving Roblox structures, models, environments, interiors, terrain, props, streets, or maps. Covers BuildKit see-as-you-build capture, generator scripts, geometry/material/anchoring/collision/CSG, gap and z-fight QA, navigation, composition, and building workflow. Trigger on Roblox building, modeling, map, prop, interior, terrain, or Studio geometry tasks."
---

# Roblox Building

How to build things in Roblox Studio that actually look good and actually work — by **seeing every step** and **walking the result** instead of guessing coordinates. Built around the custom `roblox-buildkit` MCP. General-purpose: applies to any structure or environment, not one game.

## What this covers — pick the build type

This is a **toolbox, not a checklist**: apply the rules that fit what you're making and skip the ones that don't (a tree needs no floor plan; a sword needs no stairs). It covers, among others:
- **Buildings & interiors** — the bulk of the rules below (shell, rooms, circulation, furniture, set-dressing).
- **Exteriors, terrain & natural environments** — landscapes, nature, water → see *Beyond buildings*.
- **Standalone props & objects** — a single mesh/model (vehicle, weapon, sign, statue) → see *Beyond buildings* + the orientation probe.
- **Whole scenes & maps** — composition, atmosphere, multiple structures → see *Beyond buildings*.

Whatever the type, the universal rules still hold: see-as-you-build, engine correctness (anchor, z-fight, collision, budget), name/group cleanly, and QA by capturing + (where walkable) walking it.

## The tooling: roblox-buildkit MCP

Custom MCP + Studio plugin. Server lives in the repo checkout; plugin output targets
`%LOCALAPPDATA%\Roblox\Plugins\BuildKitPlugin.rbxmx`. After editing `src/*.ts` or the plugin,
run `npm run build` (compiles `dist/` and regenerates the `.rbxmx`; it installs a copy when the
local Plugins folder exists) and restart Studio.

**Tool preference — default to `rbx_*`, not the official `Roblox_Studio` MCP.** BuildKit's bridge can serve **two MCP clients at once**; a second client forwards over `/submit` and self-promotes if the owner exits. The official `Roblox_Studio` MCP is **single-active-studio** — two agents driving it fight over `set_active_studio`/`execute_luau`. So for everything BuildKit covers — build / edit / batch / qa / selection / checkpoint / undo / lighting / gui / frame — use `rbx_*`. Fall back to official tools ONLY where BuildKit has no equivalent: `screen_capture` (the render backend, **always fed `rbx_frame` coords** — there is no background-safe buildkit capture), `execute_luau` for geometry richer than `rbx_build`, and play-mode (`start_stop_play`). Never drive the official MCP standalone for what `rbx_*` already does.

| Tool | Use |
|------|-----|
| `rbx_status` | Confirm plugin connected before building. Reports `connectedPlaces` + active place filter. |
| `rbx_watch(seconds,interval,target?,follow?,play?)` | **Watch motion:** samples the viewport on a timer INSIDE one call → ONE labeled sequence (`t=0.0s`,`t=0.5s`…) for NPCs walking, physics settling, a tween, play-mode action. **Nothing else can do this** — looping `rbx_frame`→`screen_capture` samples at the speed of your own round trips, so fast motion is invisible to it. `target`=frame once + hold cam; `follow`=track a mover; `play:true`=grab the running game's own cam. Capped 40 frames. OS-grab; if Studio isn't detected it returns a fallback directive. |
| `rbx_restore()` | Escape hatch: un-hide / un-recolor **everything** left over from a cutaway/isolate/contrast, no token needed. Use if parts have gone invisible or oddly colored and you don't know which call did it. |
| `rbx_frame(target,view,zoom)` | Computes `camera_position`+`look_at_position` WITHOUT moving the camera → feed to the official `screen_capture` (clean, no chrome, no foreground needed). **Preferred capture path.** |
| `rbx_cast(mode,origin/dir/length \| center/size/radius,ignore?)` | **Spatial queries.** `mode:'ray'` → first hit `{part,position,normal,distance,material}` for line-of-sight, ground height, wall checks. `mode:'box'\|'sphere'` → every part overlapping a region, for placement clearance / "is this spot free" / "what's here". `ignore` excludes instances. |
| `rbx_script(mode,target?,query?,from?,to?)` | **Read game code** (`rbx_sync` only writes it). `read` a script's Source (`from`/`to` to page; >1500 lines needs a range), `list` every script under a target with line counts, `find` greps all scripts for a literal string → `{path,line,text}`. |
| `rbx_prop(mode,target,name?,value?,names?)` | Get/set/list **ANY** property — Transparency/Anchored/Material/CanCollide/Color/custom (`rbx_attr` is Attributes only). `[x,y,z]`→Vector3, or Color3 if the name contains 'color'; Enum props take a string like `'SmoothPlastic'`. |
| `rbx_group(mode,target?,parts?,name?,primary?,kind?)` | `group` wraps parts (by name or current selection) into ONE Model with a PrimaryPart + optional `kind` tag; `ungroup`; `weld` WeldConstraints an assembly to one anchored root. NOTE the parametric builders ALREADY group each sub-unit into its own `Kind`-tagged Model — use this for hand-built/ungrouped geometry or after edits. |
| `rbx_console(limit?,errorsOnly?,filter?)` | Read Studio's edit-time output log (prints/warnings/errors) in-channel. For PLAY-mode logs the official `get_console_output` is better. |
| `rbx_live_sync_start(intervalMs?)` / `rbx_live_sync_stop` | Start or stop the plugin-side Studio-to-browser autosync. It starts enabled by default; interval is 100–60000ms (default 1500ms). The browser remains read-only; staged changes still require explicit commit. |
| `rbx_build(spec)` | Quick primitives: slab / room / stairs (door+window openings) / furniture: **cabinet / table (coffee/dining) / shelf (bookcase) / bed / chair / sofa / armchair / desk / nightstand / dresser / wardrobe / fridge / stove / toilet / bathtub**, and **`prop`** = a generic primitive composer (`parts:[{shape:box/cylinder/ball/wedge, pos,size,rot,color,material,neon,light}]` → ANY small prop like a cigarette/mug/lamp, no execute_luau; cylinder length is along its LOCAL X, rotate to orient; rbx_qa is rotation-aware now (worldAABB + GetPartsInPart); its hits are real). All face **+Z**; storage pieces (cabinet/desk/nightstand/dresser/wardrobe/fridge/stove) get real drawers/doors + the ProximityPrompt controller. All carcass/furniture use **butt joinery, z-fight-/gap-free by construction** — prefer over hand-writing geometry. `cabinet` = carcass + `front` layout of `[{type:'drawers',count},{type:'doors',count}]` (drawers are **real pull-out boxes** — joined tray + pull + ProximityPrompt, NOT bare faceplates; doors w/ tight reveal, outer-edge hinge, **swing outward**, knob) + controller Script (ProximityPrompt opens/pulls them); optional `toeKick`/`countertop`/`backsplash`, `style:'shaker'` (frame+recessed panel doors, `panelColor`), and **`sink`** = `{width,depth,offset,basinDepth,basinColor,faucet}` cuts a basin hole THROUGH the countertop + carcass top (counter becomes a 4-strip frame, top splits) and drops in a basin + gooseneck faucet so it's **not capped by counter blocks** — put doors (or nothing), not drawers, in the section under the sink. `table` = top + 4 inset legs. `shelf` = carcass + N `shelves` boards (cleared off the back). `bed` = frame + Fabric mattress + headboard + pillow (`mattressColor`). Returns part count **+ bbox**. |
| `rbx_insert(assetId,name?,parent?,position?,anchored?)` | Insert a marketplace/toolbox asset by **numeric id** (InsertService:LoadAsset), anchored + parented/positioned/renamed. Asset must be FREE or owned. BuildKit's own `insert_model` — no official MCP needed. (`generate_mesh` + play-mode start/stop are privileged Roblox APIs a third-party plugin **can't** do — those still need the official MCP.) |
| `rbx_edit(target,op,...)` | Modify existing: move/rotate/scale/recolor/material/**anchor**/rename/delete/clone. One undo step each; returns **`movedBy`/`sizeDelta`** diff. `anchor` (anchored bool) fixes `rbx_qa` unanchored warnings. |
| `rbx_batch(ops[])` | Several `build`/`edit` ops in one call = **one undo step + one round trip** (place N props, multi-edit a model). The batch is atomic when a ChangeHistory recording opens; otherwise the plugin executes the recorded callback directly. ops = `[{action,args}]`. |
| `rbx_qa(target?,fix?,fit?,region?)` | Geometric lint: unanchored parts, duplicate placements, deep overlaps, **z-fights**, **unjoined assembly pieces**, and part-budget. `fit:true` adds cross-assembly seam detection. **`region` filters parts before the 1200-part overlap cap.** `fit` remains an approximate cross-assembly check, so verify reported hits against a capture. |
| `rbx_navcheck(from,to,agentRadius/Height/CanJump,visualize?)` | **Walkability QA:** PathfindingService between two points (instance name or `[x,y,z]`) → reachable?/path length/waypoint+jump counts; `visualize:true` draws neon path dots (jumps orange) under `workspace.BuildKitNavPath`. Official `character_navigation` only DRIVES a char; this QAs whether a layout is navigable. |
| `rbx_tag(mode,target?,tag?)` | CollectionService tags (gameplay wiring): `add`/`remove` (one undo) / `list` a target's tags / `query` every instance with a tag. Cheaper + multi-agent-safe vs `execute_luau`. |
| `rbx_attr(mode,target,name?,value?)` | Instance Attributes: `set` (one undo; value = string/number/bool or `[x,y,z]`→Vector3) / `get` / `list`. Gameplay state without raw luau. |
| `rbx_diff(a,b)` | Diff two trees (each a **checkpoint name** or live instance) → added/removed/changed (moved/resized/recolored/material/anchored), relative-path keyed. "Did my edit do what I meant" with no screenshot. Pairs with `rbx_checkpoint`. |
| `rbx_optimize(target?,fix?)` | Perf/streaming audit: part count, **Precise-CollisionFidelity MeshParts** (expensive), unanchored, far-from-origin, big models, StreamingEnabled. `fix:true` lowers Precise→Box. Complements `rbx_qa` (geometry). |
| `rbx_selection(get\|set,target)` | `get`=read what the user clicked (operate on "this"); `set`=select target so the user SEES what you mean. |
| `rbx_checkpoint(save\|restore,name,target)` | Hard savepoint (clone in ServerStorage). Save before risky multi-op gen, restore if it goes wrong. One undo step; cleared on Studio restart. |
| `rbx_undo(steps,redo)` | Undo/redo BuildKit mutations (also native Ctrl+Z). |
| `rbx_gui({name,theme,root})` / `rbx_gui_preview({name,mode})` | Build a styled ScreenGui from a component tree + edit-time CoreGui preview. The GUI builder creates visuals only; use a synced `.client.luau` script for callbacks. |
| `rbx_set_lighting(day\|noir)` | `day` before capturing; restore the game's lighting after. |
| `rbx_use_place(name?)` | Multiple Studios open: pin commands to the place whose name contains `name` (omit = clear). Check `connectedPlaces` via `rbx_status`. |
| `rbx_sync(paths[],target?,select?)` | **Push disk `.luau` into Studio** — deterministic fix for "I added/edited a file but Rojo didn't create it in Studio" (new files that make `require(WaitForChild)` hang). Maps each file to its DataModel path from its **service-named ancestor folder** + Rojo suffix (`.server`→Script, `.client`→LocalScript, `.luau`→ModuleScript, `init.luau`→parent folder). Pass files OR a directory (recurses `*.luau`); `target` overrides the path for a single file. Creates missing Folders, updates Source on match, **replaces** a wrong-class leaf (keeps children), one undo step, selects the result. Agent-triggered, **no sync session needed** (vs official Script Sync — see Gotchas). |
| **play-mode testing** | **PRIMARY:** official `mcp__Roblox_Studio__execute_luau` `datamodel_type:"Server"` (or `"Client"`) after `start_stop_play(true)` — arbitrary Luau in the LIVE game, returns data, zero setup. **LAST RESORT:** `rbx_runtime(install)` + `rbx_run(code,timeout)` for a *persistent/parallel* in-game channel (resident coroutine holding state across calls) — but you must first **manually tick `ServerScriptService.LoadStringEnabled` in Properties** (not script-settable); `rbx_run` returns a clear "tick LoadStringEnabled" error until you do. Then `remove` when done. |

**Gotchas:**
- **CAPTURE PRIMARY: the official `mcp__Roblox_Studio__screen_capture`, ALWAYS first.** Get coords from `rbx_frame(target, view OR azimuth/elevation)` (or `execute_luau`: `cam = center + dir.Unit * (size.Magnitude/2 / tan(rad(fov)/2))`), feed `camera_position`+`look_at_position` to `screen_capture`. It is the clean, chrome-free path and does not require Studio to be foreground. For a turntable, loop `rbx_frame(azimuth=...)` → `screen_capture` per angle. `iso` is steep on tall builds; use a low 3/4 like `Vector3.new(0.8,0.38,1).Unit`.
- **`rbx_view`, `rbx_apply({view})`, `rbx_watch`, and GUI preview screenshots use the BuildKit OS window grab**, so Studio must be visible/foreground. They crop to the reported 3D viewport when possible and fall back to the full Studio client area otherwise. Use them for composed setup/teardown, batched angles, or timed sampling; for a plain shot, use `rbx_frame` → official `screen_capture`.
- If the official `Roblox_Studio` MCP errors "previously active Studio disconnected", call `list_roblox_studios` + `set_active_studio`.
- Plugin can't `loadstring` — for arbitrary geometry use the official `execute_luau` (rich) and capture with buildkit. Use `execute_luau` for detailed builds; `rbx_build` only for simple shapes.
- **Official Studio Script Sync exists** (Roblox, fully released): Studio ↔ local-files **bidirectional** sync with conflict resolution, works in external editors (VS Code/Cursor) and with Team Create. For ongoing development that's the native option; `rbx_sync` is the **agent-triggered, no-session, on-demand** push for the common case where a file didn't make it into Studio mid-build (new `.luau` → infinite-yield). Don't confuse the two: Script Sync is a user-configured live session; `rbx_sync` is a one-shot tool call.
- **Move the player avatar in Play (it CAN walk, not just click):** official `user_*_input` only sends raw clicks/keys. To actually WALK the avatar, drive its Humanoid with `mcp__Roblox_Studio__execute_luau` `datamodel_type:"Client"`: `local c=game.Players.LocalPlayer.Character; c.Humanoid:MoveTo(Vector3.new(x,y,z)); c.Humanoid.MoveToFinished:Wait()`. For paths around obstacles, compute waypoints with **`rbx_navcheck`** (in edit) then `MoveTo` each in order. NPCs / server-owned characters move the same way via `datamodel_type:"Server"`. `MoveTo` is the reliable mover; input-sim (hold W) is timing-fragile.

### PRIMARY PATH — try these first (current server manifest; `rbx_place` is the map-building verb)

The current server manifest registers 57 named `rbx_*` endpoints when the optional mesh pipeline
is present (56 otherwise; down from the former 64 — `rbx_capture`,
`rbx_orbit`, and `rbx_floor_plan` are composed by `rbx_view`; `rbx_describe`, `rbx_inspect`,
`rbx_find`, and `rbx_measure` are covered by `rbx_map`;
`rbx_map` bounds arithmetic — retired 2026-08-31); `rbx_gen_mesh` is conditional. These primary tools cover most work. Everything below this block is the **specialist layer** — still valid, reach for it when the primary tools don't cover the case.

| Tool | Use |
|------|-----|
| `rbx_place({prefab,...})` | **Place many instances from one instruction — the map-building verb.** `mode:'palette'` lists prefabs. Use `place`, `line`, `grid`, `ring`, or `scatter`; `abut:true` derives line/grid spacing from the prefab bbox and returns adjacent-gap diagnostics. Shared modifiers include `ground`, `snap`, `rotate`, `jitter`, and `seed`; max 500 clones. |
| `rbx_map({name/className/material/region/tag/selection/target, detail, lod, maxParts})` | **READ the live place as data.** `name` is a glob (`'Oak*'`); `region` is `{center,radius}` or `{min,max}`; `selection:true` maps what the user clicked in Studio. `detail:'summary'` (default) → counts + bounds + samples; `detail:'parts'` → every match. `lod:'bbox'` → one box per target. `maxParts` ≤800. **`region` filters before the 800-part serialization cap.** Still inspect `truncated`/coverage and narrow the target or region when the result is incomplete. Use `rbx_scene_dump` only when Mirror needs its full hierarchy payload. |
| `rbx_view({target, view, elevation, zoom, angles, isolate, cutaway, cutawayY, annotate, contrast, restore})` | **LOOK, with camera + visibility composed into ONE call.** `view`: front/back/left/right/iso/top. `angles` 1–24 = turntable contact sheet. `isolate` hides everything else; `cutaway:'roof'` or `cutawayY:<n>` cuts the top off; `annotate` overlays bbox+dims; `contrast` recolors so seams/gaps pop. `restore` defaults **true** (undoes camera+visibility after). **Replaces** capture/orbit/floor_plan/frame/isolate/annotate chains — "isolate the sink, cut the roof, 4 annotated angles" is one call. |
| `rbx_apply({ops:[…], view?})` | **EDIT existing content**, all ops in ONE undo recording when available. Each op takes `target` **or** a `select` filter (same shape as `rbx_map`) — so "move all 47 trees up 2" is **one op, not 47**. Ops: `move`(delta) `rotate`(degrees) `scale` `recolor`(color) `material` `anchor` `rename` `delete` `clone`(offset) `ground` plus **`replace`**(spec) **`scatter`**(count/region/seed) **`distribute`**(from/to) **`align`**(axis/value). Optional `view` renders after the edit — don't spend a separate capture call. |
| `rbx_dev_reload()` | **After editing `src/*.ts`.** Rebuilds, swaps the stale viewer server, verifies old→new PID. A plain `/mcp` reconnect often re-attaches to the **OLD process**, so changes silently don't take effect (this cost ~30 wasted calls in one session). Refuses to kill the current MCP process or a listener whose ownership changed mid-build. |
| `rbx_list_tools({query?})` | Search the complete tool catalog, including tools hidden from the initial `tools/list`; matches name, title, and description. |
| `rbx_enable_tools({names})` | Enable exact tool names returned by the catalog; the server emits `tools/list_changed`, after which the enabled tools are callable. |

**`rbx_view` has no `azimuth` and no `hide[]`** — use named `view` + `elevation`, or `angles` for a turntable.

The server lazy-loads specialist tools: only the four core tools (`rbx_map`, `rbx_view`,
`rbx_apply`, `rbx_dev_reload`), status, QA/checkpoint, and these two discovery tools appear in
the initial `tools/list`. Search first, then enable exact
matches, for example `rbx_list_tools({query:"terrain"})` followed by
`rbx_enable_tools({names:["rbx_terrain"]})`. The server notifies connected clients when the
tool list changes.

### World-building tools (verify live before trusting)

| Tool | Use |
|------|-----|
| `rbx_place({prefab,...})` | **Place many instances from ONE instruction — the map-building verb.** `mode:'palette'` lists prefabs. Give one verb: `place`, `line`, `grid`, `ring`, or `scatter`. For straight lines/grids, `abut:true` derives spacing from the prefab bbox (manual spacing is then rejected) and the response includes O(n) adjacent `gaps`. Other shared modifiers: `ground`, `snap`, `rotate`, `jitter`, `seed`. Clones land in one undoable `Placements/<name>` group; max 500. |
| `rbx_terrain({mode,shape,...})` | **The voxel layer — BuildKit had NO terrain surface before this.** `mode:'fill'` + `shape` block/ball/cylinder/wedge/region; `'clear'` (a region, or ALL terrain if min/max omitted); `'paint'` swaps `from`→`to` material in a region. 22 terrain materials (grass sand rock slate concrete brick sandstone mud basalt ground crackedlava asphalt cobblestone ice leafygrass salt limestone pavement snow woodplanks water air). **Regions snap outward to the 4-stud voxel grid** and FillRegion/ReplaceMaterial require resolution 4. Use terrain for ground/hills/water, parts for built form. |
| `rbx_collision({mode,...})` | Collision groups: `list` / `create` / `delete` / `assign` (target/targets/select) / `collidable` (name+other+canCollide). Lets scenery stop blocking NPCs **without** switching CanCollide off. |
| `rbx_sound({mode,...})` | `add`/`remove`/`list`. Parented to a BasePart = positional 3D audio; no target = SoundService ambience. `soundId` takes a bare number or `rbxassetid://`. |
| `rbx_constraint({mode,kind,a,b,...})` | Real physical joints — the articulation ProximityPrompt scripts can't do. kind: hinge/weld/motor/spring/prismatic/ball/rope/rod. Attachment kinds take `offsetA`/`offsetB` + `axis`; hinge also `limits`+`lower`/`upper`, or `motor`+`velocity`/`torque`. `weld` uses WeldConstraint on the parts; Motor6D uses C0/C1 (it takes no attachments). |

---

**The other `rbx_*` tools are the SPECIALIST LAYER** — watch / cast / script / prop / group / console / checkpoint / restore / diff / optimize / navcheck / selection / tag / attr / sync / gui / set_lighting / insert / gen_mesh / batch / undo / stage_* / live_sync_* / scene_dump / run / runtime / use_place / status / isolate / annotate / conformance / map_* / ground_part. Reach for them only when the primary tools above don't cover the case.

### Safety boundaries

Confirm before `rbx_stage_commit`, unscoped terrain clears, deletes, sync replacements, or broad filtered mutations. Save a checkpoint before risky multi-operation edits. Stage and batch operations use one ChangeHistory recording when Studio opens one; they are not a security boundary.

**Gotchas:**
- **CAPTURE PRIMARY: the official `mcp__Roblox_Studio__screen_capture`, ALWAYS first.** Get coords from `rbx_frame(target, view OR azimuth/elevation)` (or `execute_luau`: `cam = center + dir.Unit * (size.Magnitude/2 / tan(rad(fov)/2))`), feed `camera_position`+`look_at_position` to `screen_capture`. It is the clean, chrome-free path and does not require Studio to be foreground. For a turntable, loop `rbx_frame(azimuth=...)` → `screen_capture` per angle. `iso` is steep on tall builds; use a low 3/4 like `Vector3.new(0.8,0.38,1).Unit`.
- **`rbx_view`, `rbx_apply({view})`, `rbx_watch`, and GUI preview screenshots use the BuildKit OS window grab**, so Studio must be visible/foreground. They crop to the reported 3D viewport when possible and fall back to the full Studio client area otherwise. Use them for composed setup/teardown, batched angles, or timed sampling; for a plain shot, use `rbx_frame` → official `screen_capture`.
- If the official `Roblox_Studio` MCP errors "previously active Studio disconnected", call `list_roblox_studios` + `set_active_studio`.
- Plugin can't `loadstring` — for arbitrary geometry use the official `execute_luau` (rich) and capture with buildkit. Use `execute_luau` for detailed builds; `rbx_build` only for simple shapes.
- **Official Studio Script Sync exists** (Roblox, fully released): Studio ↔ local-files **bidirectional** sync with conflict resolution, works in external editors (VS Code/Cursor) and with Team Create. For ongoing development that's the native option; `rbx_sync` is the **agent-triggered, no-session, on-demand** push for the common case where a file didn't make it into Studio mid-build (new `.luau` → infinite-yield). Don't confuse the two: Script Sync is a user-configured live session; `rbx_sync` is a one-shot tool call.
- **Move the player avatar in Play (it CAN walk, not just click):** official `user_*_input` only sends raw clicks/keys. To actually WALK the avatar, drive its Humanoid with `mcp__Roblox_Studio__execute_luau` `datamodel_type:"Client"`: `local c=game.Players.LocalPlayer.Character; c.Humanoid:MoveTo(Vector3.new(x,y,z)); c.Humanoid.MoveToFinished:Wait()`. For paths around obstacles, compute waypoints with **`rbx_navcheck`** (in edit) then `MoveTo` each in order. NPCs / server-owned characters move the same way via `datamodel_type:"Server"`. `MoveTo` is the reliable mover; input-sim (hold W) is timing-fragile.


## THE BUILD LOOP — generator files → live browser preview → port (2026-08-30)

**This is now the main way to build.** Building is a **file edit, not a tool call.** Don't reach for `rbx_build`/`rbx_stage_build` with a big inline part list — an inline 70-part prop costs ~4–5k tokens and re-sends *everything* on every tweak; a generator file is an `Edit` of two lines.

1. **Write/edit `generators/<name>.js` in the repository** — every `*.js` there contributes to the stage. Export a **synchronous** `generate(args)` returning the same validated ops `rbx_batch` takes:
   ```js
   export function generate() {
     return [{ action: "build", args: {
       kind: "prop", name: "Oak", center: [0, 2, 0],
       parts: [{ shape: "box", size: [4, 4, 4], color: [120, 80, 40] }],
     } }];
   }
   ```
2. The server **watches `generators/`**, debounces each save, re-runs the file, and pushes a full `stage-sync` to the browser. A syntax/runtime/validation error **keeps that file's last good ops** and surfaces in the panel — a broken edit never blanks the scene.
3. **Preview: `http://localhost:<BUILDKIT_VIEWER_PORT>/stage.html`** (default port `8642`, served on loopback). Toggle generator files from their entries in the Library panel.
4. **Port to Roblox** — you click the toolbar button, or call `rbx_stage_commit`. Commits the *enabled* preview.

**Prefer recursion over hand-placement.** A `branch(pos, dir, depth)` that recurses is shorter *and* produces better organic geometry than 14 hand-computed branches.

**The editor (stage.html):** WASD + Q/E fly camera, click-to-select w/ blue highlight, **Explorer** tree (models → unions → parts), **Properties** panel (pos/size/rot/color/material/CSG op), TransformControls **Move/Rotate/Scale** gizmo (**F/R/G** shortcuts), **Undo Ctrl+Z / Redo Ctrl+Y or Ctrl+Shift+Z**, Delete, **CSG edit/preview toggle**, Recent stages w/ save + **Export `.bkstage`**.

**`.bkstage`** = the share format: pure validated ops + metadata, with no engine or machine state. It replays the same validated payload for anyone who imports it; renderer placeholders and Studio-side CSG can still differ in appearance.

**The server owns the truth.** Browser edits POST to the server, which mutates and broadcasts back. Stage `prop` ops render as geometry; other build kinds may be browser bbox placeholders, and the browser CSG preview has a 48-part client cap while Studio commit uses the configurable `csgMax` (default 100). Never work around this by holding authoritative state in the page.

### Headless prop-subagent workflow

Run independent prop briefs in parallel with one unique `session` ID per subagent. Six Stage
sessions exist in total, including the default session; reserve the default and use at most
five workers:

| Step | Tools |
|------|-------|
| Build and inspect | `rbx_stage_build`, `rbx_stage_status` |
| Self-check and iterate | `rbx_stage_render` |
| Reset the isolated bench | `rbx_stage_clear` |
| Save and gather winners | `rbx_library_save`, `rbx_library_list`, `rbx_library_category_create` |

**Hard rule:** a prop subagent never calls Studio/bridge tools or `rbx_stage_commit`.
It saves its result to the library; the user explicitly ports chosen winners later.

### STAGE vs MIRROR — two different surfaces, don't conflate them

| | **Stage** (`/stage.html`) | **Mirror** (`/stage.html?mirror=1`) |
|---|---|---|
| What it is | A **construction bench**. Props get built here. | A **reflection of the real place** in Studio. |
| Source of truth | `generators/*.js` + manual staged ops | Studio, via live-sync `scene_dump` |
| Explorer shows | **generator file → op → primitive**, with primitive count and the live `csg N/max` budget | the **Studio instance tree** (Models/Unions/paths), hierarchy-preserving |
| Editing | full: gizmo, properties, delete, undo/redo, clipboard | read-only (per-instance edits go through `rbx_apply`) |
| Flow | build → preview → **Port to Roblox** | inspect what actually landed, then adjust in Studio |

`index.html` now just redirects to `stage.html?mirror=1` — one page, two modes.

**Stage editor extras:** `▶ Build` replays the build in construction order with a scrubber and an `auto` toggle (replays on every stage-sync) — the fastest way to see *where* a generator goes wrong rather than just that it did. Explorer has a search box (filters, auto-expands, keeps ancestors for context) and collapsible groups whose state survives re-render. `Ctrl+C`/`Ctrl+V`/`Ctrl+D` copy/paste/duplicate an op — or a single primitive inside a prop, which becomes a prop of its own. CSG (`csg:true` + per-part `op`) survives the round-trip.

**Mirror is read-only in the UI.** It exposes the Studio hierarchy in Explorer, but no Properties, Library, History, or transform gizmos. Localhost viewer POST routes can still mutate Studio, so this is not an authorization boundary; use Studio or `rbx_apply` for edits.

**Mirror extras:** clicking any node — part **or** Model/group — offers **Copy "X" to stage**, which converts it back into build ops and appends them, so something built in Studio can be pulled into the stage to save or export as `.bkstage`. A union copies as its **source parts + `csg:true`**, so the copy rebuilds the real solid rather than a bounding box. **`Locked` parts cannot be clicked or marquee-picked** in the viewport (matching Studio) but stay selectable from the Explorer, marked 🔒.

**Generator rename/delete requires Detach.** Property and gizmo patches can promote generator output into manual Stage state and disable its generator; after that, the promoted ops are freely editable. Use **Detach** when you want the whole file's ops copied into manual stage state. (Delete names the owning file rather than erroring cryptically.)

### CSG booleans
Set `csg:true` on a prop spec, then per-part **`op:"union"|"subtract"|"intersect"`** (legacy `negate:true` == `subtract`). Roblox has all three natively (`UnionAsync`/`SubtractAsync`/`IntersectAsync`). The stage previews the same boolean result via `three-bvh-csg`.
**Above the cap, `csgProp` skips CSG entirely** and leaves the parts unmerged — not an error, but it reads as one if you don't expect it. The cap is **configurable: default 100**, set stage-wide in the viewer (Options -> CSG max parts) or per-op via `csgMax` in a build spec, which always wins. The viewer reports the LARGEST single prop against the cap (the budget is per-prop, not a scene total). 100 is a useful default, not a safe ceiling — Roblox unions degrade past roughly a 20k-triangle budget and where that bites depends on geometry, so lower it if a union comes out degenerate.


## Coordinate & rotation traps (cost hours on 2026-08-30 — read before touching the viewer)

- **Roblox is RIGHT-handed Y-up, exactly like three.js** (`CFrame.LookVector` is its −Z column). The viewer originally assumed left-handed and negated Z plus two Euler angles — that silently mirrored the whole scene. Because the position mirror and the angle flips didn't correspond, compound-angle geometry came apart: tree limbs drooped instead of sweeping up and detached from the trunk. **Vertical trunks and radially symmetric roots hid it**, which is why it survived so long. The correct conversion is the **identity**.
- **TWO rotation conventions exist and look identical in JSON — never convert with plain `radToDeg`:**
  - `CFrame:ToOrientation()` (what `scene_dump` emits) → **radians, YXZ order**
  - `BUILD_SPEC` part `rot` (what `CFrame.Angles` consumes) → **degrees, XYZ order**
  Converting between them requires **re-decomposing through a quaternion**, not a unit change. Decoding one as the other is what made rebuilt branches point the wrong way.
- **A union dumps only as its BOUNDING BOX** — the plugin cannot read a `PartOperation`'s real solid back out of Studio. `buildProp` therefore snapshots the source parts' **world transforms** (via `ToOrientation`, so there's one convention end to end) into a `BuildKitCsgParts` attribute *before* `csgProp` destroys them; the viewer re-evaluates the boolean with `three-bvh-csg`. **Props built before that landed have no stash and render as translucent boxes — rebuild them to fix.**
- Unions/intersects/negates render **translucent with edge lines and `depthWrite:false`** when their true solid isn't recoverable, so they can never hide what's behind them. Detection keys on the dumped **`class`** (present all along), not `shape`, so it works without a plugin restart.
- **Roblox's built-in materials are engine-internal** — no asset id, nothing for `/asset/:id` to fetch. The viewer synthesises a grayscale detail map per family (wood grain, leaf mottle, brick courses, weave, stone noise); three.js multiplies `map` by `color` the same way Roblox modulates a material by part Color, so hue is preserved. Real `SurfaceAppearance`/`Texture` assets override it.

## buildkit gotchas (2026-08-30)

- **`rbx_apply`'s `expandApply` deleted `args.op`** in its default path, so **all nine plain edit ops (move/rotate/scale/recolor/material/anchor/rename/delete/clone) failed with `unknown edit op: nil`**. Fixed; no test covered it. If a bulk edit ever fails that way again, check that translation layer first.
- **`1e9` fails the plugin build gate** — `check-plugin.mjs`'s identifier scan reads `e9` as an unknown symbol. Use plain integers in plugin Luau.
- **`check-plugin.mjs` has a hand-maintained `HANDLERS` allowlist and `EDGES` cross-module list.** A new handler or a new cross-module import must be added there or `npm run build` fails (clear `G4`/scope errors, just non-obvious the first time).
- **`10-geometry.luau` has no `HttpService` import** (see EDGES). Pass JSON through as a string and let the browser parse rather than adding the import.

- **`rbx_qa` is rotation-aware (verified 2026-08-30).** `worldAABB` projects each part's true oriented box onto world axes and gates against real geometry with `GetPartsInPart`, so rotated cylinders and clustered foliage are judged more accurately than the old axis-aligned check. It remains a heuristic: verify reported fit, z-fight, and overlap findings visually, especially for oblique geometry. The live limits are the 1200-part ceiling and approximate `fit` check.
- **Stale MCP process is the #1 time-waster — use `rbx_dev_reload()`.** After `src/*.ts` changes, `/mcp` reconnect frequently re-attaches to the **old already-running process**, so the new code never loads and you debug a phantom. Symptom: a change provably in `dist/` has no effect. `rbx_dev_reload()` rebuilds + swaps + verifies old→new PID. Manual check: `Get-NetTCPConnection -LocalPort <BUILDKIT_VIEWER_PORT> -State Listen` before/after (default `8642`) — if the PID didn't change, nothing reloaded. **Assume this first whenever a change "isn't taking effect".**
- **Prefer browser-side changes over server-side.** `viewer/*.js` + `viewer/*.html` are served from disk — a page refresh is enough. `src/*.ts` needs rebuild → process swap → PID verify. Same feature, wildly different iteration cost.

## Core workflow: see-as-you-build

1. **Study the reference first — and keep going back to it.** If a reference model exists, `rbx_map` it (bbox, parts) and `rbx_view(angles:8)` it from every angle in `day` lighting. Note: floor count, floor height, window grid, trim, roofline, materials, proportions. **If the reference stays in the workspace, revisit it freely at any point** during the build — re-capture it next to your work to compare proportions/detail whenever you're unsure.
2. **Plan each floor before building it.** Write the room program + circulation for every floor (which rooms, where doors connect, where stairs land) BEFORE laying parts. A floor that wasn't planned reads as "makes no sense". Keep the plan and check the floor against it after building.
3. **Build in stages** with a clean script (see Build-script discipline below): `shell` (walls + slabs + openings) → `detail` (windows/balconies/entrance/trim/parapet/roof) → `greeble` (downpipes, AC units, signage, cables) → `interior` (partitions + doorways + stairs + furniture) → `dressing` (the lived-in micro-details). Keep stages in named Folders under the Model.
4. **Name & group as you go** (see Studio hygiene below) — don't leave a pile of "Part".
5. **Capture + critique after EVERY stage.** Never stack a stage on an unverified one.
6. **Walk the space** (see Navigation & playtesting) before calling geometry done — captures hide clearance/climb bugs.
7. Run the MANDATORY QA (below) before calling it done.

**Stop-and-ask after ~2–3 failed fixes on the same defect.** If a part keeps landing wrong, don't keep guessing coordinates and burning turns — that's thrashing. Capture the current state, state what you've tried, and ask (or re-plan). Re-planning early beats a pile of broken attempts.

## House building process (floor-by-floor) — the standard order for a multi-floor building

Build a real building like a real building gets built: envelope first, then fit out each floor completely before starting the next. This prevents the classic mistakes (rooms walled by the raw exterior shell, windows that ignore the inner wall, furniture placed against brick).

1. **Outer Shell of the WHOLE building first.** Exterior walls (full-height per floor — see below), every floor slab, the roof + parapet/coping, exterior circulation (stairs / fire escape), and all *exterior* openings (windows, entry/balcony/side doors). Just the envelope — no interior yet. Capture all sides + iso and verify before going inside.
2. **Then ONE FLOOR AT A TIME, ground → up.** For each floor, fully finish it before moving up:
   a. **Interior Floor Plan (with inner + outer walls + windows).** Add the apartment's own **inner wall skin inset from the shell** (don't reuse the brick as a finished room wall — see *Inner-wall encapsulation*), plus interior partitions that **encapsulate each room**. Carry every window/door opening through **both** the inner and outer wall, aligned, with a reveal/casing across the cavity (see *Windows account for both walls*).
   b. **Room-volume boxes.** Drop a named invisible box per room (see *Room-volume boxes*).
   c. **Analyze each room in isolation** (hide everything but that room → clean top-down box view; see *Analyze EVERY room*).
   d. **Furnish** that floor (place against the inner walls, inside each room volume).
   e. **Verify** (per-room captures + walk), THEN start the next floor.

- **Inner-wall encapsulation — rooms get their OWN walls, not the exterior shell.** A real apartment is not bounded by the raw structural/brick exterior; it has its own interior (plaster/drywall) walls. Build an **inner wall skin inset from the shell with a small cavity** (e.g. brick 1.5, cavity ~1.0, inner plaster ~0.5 → inner room face ~1.5 inside the brick). Interior partitions are this same inner-wall material and connect to the inner skin so every room is fully wrapped by its own finished walls. The brick reads only as the building envelope (seen from outside / through windows). Inset shrinks the usable interior — re-check that tight rooms (bath) still fit after insetting, and enlarge the plan if needed.
- **Walls must reach the ceiling / next floor.** Every wall — exterior, inner skin, and partition — spans the **full floor-to-floor height** and butts the slab above (no gap to the ceiling). A partition that stops short leaves a sky/next-floor gap and light leaks. Verify with a dark-lighting interior capture (no bright slivers at wall tops) and numerically (wall top Y ≈ slab-above bottom Y).
- **Windows account for BOTH inner and outer walls.** A window is not just a hole in the brick — once an inner wall exists, the opening must pass through **both** walls, aligned, or the inner wall blocks/halves it. Build the frame+glass+sill at the shell, punch a matching opening in the inner skin, and line the cavity with a **reveal/jamb + inner casing** so the window reads as set into a deep wall. **Whenever you add or move an inner wall, re-fix the windows** (and doors) to keep their openings carried through both layers.
- **Room-volume boxes — a named invisible box per room.** When you encapsulate a room, create one invisible `Part` that fills the room's interior **footprint × floor-to-just-under-ceiling height** (cap the top below the slab above so it doesn't poke into the next floor), `Anchored`, `Transparency=1`, `CanCollide/CanQuery/CanTouch=false`, **named after the room** (`Bedroom`, `Kitchen`…). It defines the room's real envelope/limits, classifies which space is which room, and bounds furniture placement (place pieces *within* the volume). Keep these in a `RoomVolumes` folder per floor.

## Build-script discipline

The geometry is generated by an `execute_luau` script. Treat it like real code so rebuilds are consistent and cheap.

- **Parametric variables at the top.** Define `FH` (floor height), `WT` (wall thickness), `DOOR_W`/`DOOR_H`, the palette, origin, etc. as named locals at the top — single source of truth. Tuning one number then re-running beats hunting magic numbers scattered through the script.
- **Build relative to a chosen origin**, not absolute world coords — so the whole thing can move.
- **Modular kit reuse.** Build a window / wall-segment / baluster / step as a function or a template you `:Clone()` — don't hand-author each instance. Cloning is faster and *guarantees* visual consistency across bays and floors (the #1 source of "off" facades is hand-built parts drifting).
- **Idempotent rebuild — but protect placed assets.** The script destroys+rebuilds the procedural geometry each run so you can iterate. CRITICAL: that destroy will also nuke any furniture you inserted or generated. Keep procedural geometry in a rebuildable folder (e.g. `Model/Generated`) and keep hand-placed / store / AI-generated assets in a **separate persistent folder the rebuild never touches** (e.g. `Model/Placed`). Decide this split before you insert the first asset.
- **Set PrimaryPart + pivot** to a sane origin (front-door grade center) so the finished Model places/streams/moves cleanly via `PivotTo`. A Model with no PrimaryPart is a pain to position later.

## Articulated & multi-part props — build as verified sub-assemblies

A complex prop (a counter with drawers + doors, a vehicle, a machine, a desk with a lid) is several SEPARATE assemblies, not one blob. Build and verify each piece ALONE before composing — catch a broken sub-part while it's small and isolated, not after it's buried in the whole. (The kitchen-counter "drawer front floating 0.4 off its tray" bug would have been caught instantly by QA-ing that one drawer alone; it slipped through because the whole counter was built in one shot.)

1. **Decompose first.** List the sub-assemblies: the static shell/carcass; each grouped/moving part (drawer, door, lid, wheel); the hardware (handles/knobs). Each is its own named `Model`.
2. **Build + verify each sub-assembly in ISOLATION, then fix before composing** (the "never stack a stage on an unverified one" rule, applied to parts):
   - `rbx_qa <subassembly>` — the connected-components check confirms it's ONE joined blob (flags a drawer front split from its tray, a handle off its panel → "X splits into N groups, gap g"), plus anchored / no internal overlaps.
   - `rbx_map <subassembly>` (structure) + `rbx_view(isolate:true)` (see it alone, or `angles` for a turntable). Fix any split/gap NOW.
3. **Compose.** Parent each verified sub-assembly into the prop Model, position it, set the moving parts' travel/hinge. Keep the DESIGNED clearance between a moving part and the shell — that gap is between two *different* models, so `rbx_qa` won't mistake it for a defect (it only flags disconnects WITHIN a single assembly).
4. **Verify the WHOLE.** `rbx_qa <prop>` (cross-assembly overlaps + clearances), capture all sides via `rbx_view(angles:8)`, then EXERCISE every interaction — open each drawer/door in edit (`PivotTo`) or play (ProximityPrompt), and confirm it moves cleanly.

The plugin already supplies the assess step; the discipline is to run `rbx_qa` after EACH piece, not only at the end.

## Logical thinking — build what the feature IMPLIES

Before adding any feature, ask "how is this used / accessed?" and build what that requires. Decoration that implies a function it doesn't have reads as broken.

- **Balcony → needs a DOOR to it**, not just a window above a sill. A balcony you can only see through a window is useless — make the opening a floor-height balcony/French door so the player can walk out. (Common miss.)
- **Every enclosed room → a door** that actually connects to the circulation. **Every upper floor → reachable stairs.** **A roof deck people use → roof access.**
- **Don't seal what should open**, and don't open what should be solid (no holes to nowhere, no floating fixtures).
- A light/fixture/sign should sit where it would actually function. A counter needs floor space in front; a bed needs clearance to walk around.
- Trace the player's path through the whole space mentally (and via `rbx_view(view:'top',cutawayY:<ceiling>)`): can they reach every room, balcony, floor, and exit? If not, it's not finished.
- **Furniture: oriented correctly, logically placed, complete per room.** Each room gets the furniture it actually needs and arranged the way people use it:
  - Living room = couch + coffee table + **TV** (couch faces the TV, coffee table between them, side chair/lamp in a corner).
  - Bedroom = bed (**headboard flat against a wall**) + nightstand beside it + dresser against a wall.
  - Kitchen/dining = table (chairs around) + counter against a wall.
  - Bath = toilet + sink + tub/shower **all pushed against the walls, leaving the centre of the room clear and walkable** — never a fixture floating in the middle. Each fixture's usable FRONT faces INTO the room (toward the walkable centre), its back to the wall. Identify each front by its feature: the **toilet's seat/bowl** is its front; the **faucet** marks the front of BOTH the sink and the tub. Analyse each bath fixture SEPARATELY (lift + inspect, see the orientation findings) so the seat/faucet ends up facing the room, then set it flush to a wall.
  Every piece must face the right way (sofa back to a wall facing the TV, bed headboard to a wall, dresser flush to a wall) — never floating mid-room or rotated at a random angle. **Generated/inserted meshes have no consistent forward axis — use the orientation probe (below) to learn each piece's forward before placing.**

  **Furniture/prop orientation probe (skybox marker tool).** Generated/inserted meshes have no reliable forward — and one may even be lying on its side. **PREREQUISITE: before you probe/bake a direction on ANY generated piece, lift it into clear sky and visually analyse it from all four faces + top + a couple of 3/4 angles to identify its functional front (seat / faucet / drawer-handle / door / screen). Never bake Dir_Front from a guess, the spawn orientation, or a single view — assuming fronts instead of confirming them routinely costs a re-do of every directional piece in a room at once.** Use the probe to learn a piece's forward AND its up before placing. (Skip it for radially-symmetric props — a barrel/crate/sphere has no meaningful front.) A cheap heuristic often settles it first: a bed/sofa is wider than it is deep (headboard/back on a short side); a chair's seat opening is its front. Probe only when that's ambiguous.
  1. **Axis-align the piece FIRST, then isolate.** Snap the model orthogonal (min-footprint align) BEFORE anything else — if it sits at a random yaw, world-axis markers won't line up with its faces and the read is WRONG (learned the hard way). Then move it up into empty sky (y≈500) on a clean background; `Anchored` the piece + markers. Grab the bbox FIRST via `model:GetBoundingBox()` → `(cf, size)` (markers inflate it, so capture size before adding them). **Bake that clean bbox into a kept invisible `Bounds` part** (size = the true AABB computed over real geometry only, welded inside the model, `Transparency=1`, `CanCollide/CanQuery=false`, `Massless`) + a `BoundsSize` attribute. `Bounds` is the canonical footprint for placement — read IT (not `GetBoundingBox`, which later markers/anchors pollute) to size clearances and sit the piece flush on the floor (bottom = `Bounds` center − size/2).
  2. **Ring it with axis markers — labelled by world AXIS, never "front"** (don't pre-bias the answer). At each bbox face: a high-contrast neon ball + `AlwaysOnTop` `BillboardGui` naming only the axis — **+Z green, −Z red, +X yellow, −X blue, +Y white (up).** Size balls/text to the bbox so they read on tiny *and* huge props (an outward cone/arrow reads direction even better than a ball). Markers `CanCollide=false`, `CanQuery=false`, in a `ProbeMarkers` folder under the model.
  3. **Capture MULTIPLE straight-on views — a single 3/4 WILL mislead you.** Take a **top-down** PLUS **straight-on shots down the candidate axes** (front/back AND left/right; add top/bottom if "up" is unclear). A symmetric chair/sofa reads cleanest from a straight **side profile** (backrest vs seat-opening is obvious) — the 3/4 is often ambiguous between two axes, so never decide on it alone. Read the views together, e.g. "from +X the backrest is on −Z and the seat opens toward +Z → forward = +Z; white +Y on top → upright."
  4. **Record forward (and up) as persistent metadata, then place.** Save it ON the model — set a `ForwardAxis` attribute AND keep ONE tiny **invisible `Dir_Front` part welded inside** the piece pointing that way (it travels + rotates with the furniture, so any future re-placement re-reads the forward without re-probing). Put it just inside the bbox so it doesn't inflate it. If "up" is wrong (mesh on its side) rotate upright first; then yaw so forward points the right way for the room (e.g. aim the couch's `Dir_Front` at the TV). Verify with a normal room capture.
  5. **Delete the VISIBLE labeled markers when done** — destroy the `ProbeMarkers` folder / `Probe_*` parts. Analysis scaffolding must never ship, and must be gone before any bbox-based placement (it inflates the bbox). The tiny invisible `Dir_Front` anchor from step 4 STAYS (inside the piece, no meaningful bbox inflation) as reusable orientation metadata.

  Bundle steps 1–2 + 5 as reusable `probe(model)` / `clearProbe()` helpers so you're not re-authoring markers/alignment every time.

  **Hard-won orientation findings (apply to ANY generated/inserted directional object — furniture, props, vehicles, machines, signage):**
  - **Generated meshes do NOT share a consistent forward axis — determine each one's front individually; never assume a uniform convention.** Real case: in one generation batch the sofa, armchair, and TV faced **−Z** while the dresser, wardrobe, bookshelf, kitchen counter, toilet, and sink faced **+Z**. Assuming "they all face +Z" placed the couch with its back to the TV. Inspect EVERY directional piece; a batch is not uniform.
  - **Inspect by lifting the piece into empty sky and looking at it from ALL FOUR horizontal faces (+Z, −Z, +X, −X), plus top and a couple of 3/4 angles — a single angle (even an opposite pair) lies.** Don't stop at +Z vs −Z: the functional front of a small/asymmetric fixture (toilet, sink, tub, chair) can sit on a side axis (±X), and you'll mislabel it from too few views. Go around the object: straight-on each of the four sides + a top-down + at least one 3/4. The front is the face showing the **functional feature**: seat-opening (seating), screen (TV/monitor), drawers/door + handle (storage), **bowl/seat (toilet)**, **basin + faucet (sink)**, **faucet (tub)**. The tank/backsplash/back-panel/spout-against-wall side is the BACK. Cross-check the views against each other before deciding, then bake `Dir_Front` on the confirmed functional face. Don't trust the spawn orientation, one hero shot, or a single top-down.
  - **Place by FACING DIRECTION, not absolute yaw.** Because fronts vary per mesh, "yaw 0 = front +Z" is false. Use a helper that rotates the piece so its `Dir_Front` points at a target **world direction**, then seats it flush — e.g. `placeFacing(model, x, z, faceX, faceZ)` (compute `delta = atan2(want) − atan2(currentFront)`, rotate the model about its center by `delta`, then translate the AABB centre onto the floor). Then you author intent ("face the TV", "face the room"), not a raw angle that depends on the mesh's quirk.
  - **Verify facing NUMERICALLY after placing — cheaper and surer than a screenshot.** Read `Dir_Front`'s world offset from the piece centre and confirm it points toward the intended target (a sofa's front offset should be −Z toward the TV, etc.). Captures repeatedly misled here; the vector does not. Use a capture only as the final human-facing confirmation.
- **Place furniture perfectly axis-aligned** — orthogonal (purely horizontal/vertical in plan), snapped to walls; never odd diagonal angles (a diagonal bed/sofa reads as broken) unless it's a deliberate accent. NOTE: a mesh modeled at an angle *inside* its part won't straighten via min-footprint alignment — rotate it explicitly (or regenerate) until it looks square. **(This orthogonal/snap-to-grid discipline is for architecture & furniture only — natural/organic objects want the OPPOSITE; see *Beyond buildings*.)**
- **No collisions, and keep clearance.** Furniture must not intersect other furniture or walls — leave a gap. Check overlaps on the floor plan.
- **Keep furniture clear of windows where possible.** Don't place tall/blocking pieces (fridge, wardrobe, bookshelf, dresser) directly under or across a window — it blocks the light/view and reads wrong from outside (furniture jammed into the glass). Slide them to a solid stretch of wall; if a piece must sit near a window, keep low items (counter, bed, desk) there, not tall ones, and leave the glass unobstructed.
- **Every room stays walkable.** Leave a clear path (≥5–6 studs) to move through each room; don't pack it so tight a character can't pass. Set furniture **back from doorways** so people walk in freely.
- **Lay the floor plan for a body, not a blueprint — every space must be physically walkable.** A plan that looks fine in 2D can be impassable in 3D. Size every corridor, doorway, and gap-between-furniture to the R15 character (lanes ≥5–6 studs wide, openings ≥7–8 tall) and keep a CONTINUOUS clear path from the entrance to every room — no pinch point narrower than the character, no doorway a partition has narrowed to a slit, no room reachable only by clipping through furniture. After laying partitions AND again after furnishing, drop a character in and actually WALK the whole unit (see playtesting) to prove you can pass through every space. A floor plan isn't done until a player can physically move through all of it.
- **Bathrooms: one entrance, never a pass-through.** A bath is a dead-end entered and left by the same doorway — never a room people must walk THROUGH to reach another room, and never sharing the space with the stairwell. Keep private rooms off the circulation, not on it.
- **Multi-unit buildings need SHARED circulation — never route residents through another unit.** If each floor/section is a separate private home, occupants must reach their unit via a common path (shared lobby/hallway/stair core) or **exterior stairs** (fire-escape style, on the building's side) with a landing + private entrance per floor. Internal stairs that dump into a private apartment are wrong for multi-tenant buildings — someone would have to walk through a stranger's home to reach their own. Decide circulation BEFORE laying out units.
- **Interior walls (and furniture) must respect exterior openings — map every door/window FIRST.** Before laying interior partitions, list the lateral span of every exterior opening (balcony doors, side / fire-escape entry doors, windows) and keep interior walls off them. An interior partition that runs into the middle of an exterior opening *bisects* it — half opens to the room, half to a corridor, so the door/window is only half usable. This is easy to miss because it looks fine from outside and only shows up when you walk the interior; a corridor wall T-junctioning into a facade can quietly bisect the same balcony door on every floor it repeats on. Fix by ending/routing the partition so each exterior opening falls wholly inside ONE room (trimming the wall's front stub is usually cleanest). Then in the furniture pass treat balcony/side-entry doors like any doorway: keep the floor in front of them clear and the approach path open so the resident can actually reach and use them — never park a sofa/bed/table across a balcony door or block the lane to a side entrance. Re-check on `rbx_view(view:'top',cutawayY:<ceiling>)` that no interior wall or furniture crosses any exterior opening.
- **Exterior stairs zig-zag — alternate the entrance side per floor.** When a building uses outside stairs (fire-escape / side-stair style) with a private entrance per floor, alternate which side each floor's door sits on so a single switchback actually connects them: floor 1's door on the **left**, floor 2's on the **right**, floor 3's back on the **left**, and so on. Each flight then climbs from one floor's landing to the next floor's door on the *opposite* side — a continuous zig-zag up the wall. Doors stacked on the same side force an awkward straight run or a path that misses the door. Lay the door sides out FIRST, then run the stairs between them. The same alternating logic applies to interior switchback cores (each half-flight reverses direction at a landing).
- **Every stairwell/stairway stays walkable and unblocked.** A flight must be climbable end to end: full stair width clear, nothing parked in or across it (no furniture, railing post, prop, planter, or wall jutting into the run), each landing clear and at least as deep as the stair is wide, and headroom above every tread. Don't let a door swing, balcony rail, or piece of furniture intrude on a landing. Walk every flight (see playtesting) and confirm a character climbs it start-to-finish without snagging.
- **Reference real floor plans.** Lay out rooms and furniture the way real architectural floor plans are drawn: rooms off a central hall/living space, plumbing (kitchen/bath) stacked and grouped, furniture against walls with clear circulation lanes. Pull up real floor-plan / room-layout references when unsure rather than inventing an odd arrangement.
- **Never block a doorway or path.** Keep every doorway, the main circulation route, and stairs clear of furniture. Check on the floor plan that nothing sits in an opening. Example: a **bed placed in front of the bedroom doorway blocks entry** — push it to a wall away from the door.
- **Doors that open need swing clearance.** If a doorway gets a real door leaf, the arc it swings through must be unobstructed (no furniture in the swing), the door hung on the correct side/hand, and a threshold/jamb under and around it — never a door leaf floating in a bare hole.
- **Room layout is logical and fully connected.** Lay out rooms the way a real floor plan would (private rooms off a hall/living area, not nested illogically). Every room must connect — you can reach all rooms from the entrance through doorways; no orphaned/sealed room. Verify the whole connectivity graph on the floor plan.
- **Room-appropriate features only — exclude what doesn't belong.** When building a specific room, omit elements that break its purpose: a **bathroom should not have a normal window onto a public space (no privacy)** — make baths windowless (or tiny/high/frosted only); don't put a stove in a bedroom, a bed in a kitchen, etc. Think about what each room is FOR and include only that.

## Engine correctness & performance — don't ship broken parts

Geometry that looks fine in a capture can still be broken at runtime. Bake these into the build script.

- **Anchor everything structural.** Every wall/floor/roof/fixture part `Anchored = true`. An unanchored part falls or explodes the instant you hit Play. The `box()` helper sets this — but verify nothing inserted/generated slipped through unanchored.
- **Avoid z-fighting — offset coplanar faces.** Two faces on the exact same plane flicker (shimmering seams that wink in and out as the camera moves). Inset glass/trim/decals into the wall by ≥0.05 studs, sink floor-on-floor and overlapping parts slightly rather than sharing a plane. Never place two parts at the identical surface. Two traps that catch people repeatedly:
  - **Floor slabs must not be coplanar with the exterior shell's outer faces.** A slab sized to the full footprint (edges exactly at the brick's outer plane) z-fights along the whole exterior at every floor line — the concrete edge flickers through the brick. Size each slab to **fill the interior and tuck a little INTO the walls, but stop short of the outer face** (e.g. brick at x10/x70 → slab edges at x11/x69, buried within the wall thickness). The slab still covers the whole room; its edges are hidden inside the walls and share a plane with nothing.
  - **The ground floor slab must not be coplanar with the baseplate / ground.** If the building's floor top sits exactly at the baseplate's top (both y0), the entire ground floor z-fights against the baseplate as the camera moves. Offset them: drop the baseplate (or raise the building) a hair so the floor top clears the baseplate top by ~0.05 (imperceptible step, seamless walk-on) and no horizontal faces are coplanar. Same rule for any slab resting on terrain/another slab — overlap or gap slightly, never share the plane.
- **Keep the build near the world origin and within size limits.** A single part maxes at 2048 studs; parts far from origin (tens of thousands of studs out) develop visible jitter from float precision. Build near `0,0,0` and move the finished Model into place via `PivotTo`.
- **Watch the part budget.** Hundreds of tiny boxes tank performance and draw calls. Prefer one larger part over many slivers, reuse cloned modules, and lean on `MeshPart`/textures for fine detail instead of micro-geometry. If a build balloons past a few hundred parts, flag it and look for merges.
- **Set CollisionFidelity on meshes.** Inserted/generated `MeshPart`s default to a collision hull that clips players and breaks NPC pathing. Use `Box` or `Hull` for furniture/props (and `CanCollide=false` on pure decoration), then confirm collisions feel right when you walk the space.
- **Strip physics/query from pure decoration.** Anything purely cosmetic (clutter, trim, greebles, dressing) gets `CanCollide=false` **and `CanQuery=false` and `CanTouch=false`** — that keeps it out of raycasts, touch events, and pathfinding, not just collision. Cheaper, and it stops decoration from snagging NPC nav or Touched logic.
- **Detail by importance (LOD triage).** Spend part-budget where the player gets close. A hero entrance or a room they stand in earns fine geometry; far/background/filler structures get blocked-in low detail. Lavishing detail on things no one approaches just burns performance.
- **Build constructively, not by overlap.** Butt parts together edge-to-edge ("Lego" style) instead of deeply overlapping/intersecting them. Overlap wastes triangles, invites z-fighting, and makes edits fragile. Use `Terrain` for ground/hills/water and `Part`s for built form — don't sculpt buildings out of terrain.

## Structural integrity — seal the box

Gaps that don't show from outside still ruin the interior.

- **No light leaks.** Wall-to-floor, wall-to-corner, and floor-to-ceiling joints must meet with no gap — exterior light bleeding into a room is an instant tell. After the shell, capture the interior under dark/noir lighting and look for bright slivers at the seams.
- **Every interior level needs a ceiling.** The underside of the floor above must close the room, or the player sees the next floor's furniture undersides and the sky. Build floor slabs that double as the ceiling below.
- **Clean corner seams.** Walls must meet at corners by overlapping or mitering — no thin see-through gap at the join. Keep wall thickness consistent (exterior walls thicker, interior partitions thinner) and don't leave the corner open.
- **No paper-thin walls.** Give walls real thickness (≥0.5–1 stud). Razor-thin walls read as cardboard, vanish at grazing camera angles, and collide unreliably.

## Architectural composition — massing, facade, depth

The shell is where a build reads as "real architecture" or "a box". Shape it deliberately.

- **Vary the massing — break up big boxes.** A large building shouldn't be one monolithic cube. Use setbacks, wings, varied roof heights, projecting and recessed volumes so the silhouette has interest. A long blank wall is the most common "lifeless" tell.
- **Tripartite facade: base, middle, cap.** Real buildings read as a heavier **base** (ground floor / storefront / water table), a repeating **middle** (the typical floors), and a distinct **cap** (cornice / parapet / roofline). Giving the facade this top-to-bottom hierarchy is what separates a designed building from stacked identical floors.
- **Facade depth — recess and project.** Inset window/door openings into the wall thickness (reveals), project sills, lintels, cornices, and pilasters out from the face. A dead-flat facade reads as a painted plane; even 0.3–0.5 stud of in/out relief makes it read solid.
- **Emphasize the main entrance.** The primary way in should announce itself — a canopy/awning, steps or a stoop, a taller/wider door, flanking lights, signage. Players (and the eye) navigate to the obvious entrance; a main door indistinguishable from a window is a miss.
- **Support what projects.** A cantilevered balcony, bay window, or overhanging floor should look held up — add brackets/corbels/posts underneath, or tuck it over a wall below. An unsupported slab jutting from a flat wall reads as floating.
- **Use a small opening "schedule".** Pick a handful of standard door and window sizes and reuse them rather than making every opening unique. Real buildings repeat a few sizes; a facade where every window differs looks chaotic. (Pairs with modular clone reuse.)

## Navigation & playtesting — walk the space

A build isn't done when it looks right; it's done when you can move through it.

- **Validate walkability.** Floors, ramps, stairs, and doorways must be navigable. For anything with walking NPCs/AI, paths must be navmesh-friendly — **ramps path far more reliably than steep stairs**; verify reachability with `PathfindingService:ComputeAsync` (or a quick test path) rather than eyeballing.
- **Actually walk an avatar through it.** Use `start_stop_play` + `character_navigation` (or drive a character) to walk every room, climb every stair, and pass through every doorway. This catches squashed door heights, stair gaps, and tight clearances that a static capture cannot. Do this before declaring geometry finished.
- **Judge interiors at eye level, not just orbit.** ⚠️ EXPERIMENTAL — may be removed if it hurts judging. Capture from inside at ~5-stud character eye height (drop a temporary `SpawnLocation` for the walk-test) so you assess a room from where the player actually stands; a space can look fine in plan/iso yet feel cramped or bare at eye level. Caveat: eye-level shots see less at once and can mislead a holistic read — treat them as a supplement to the floor-plan + orbit captures, never a replacement. If they start causing more confusion than insight, cut this step.
- **Build for how the space is actually used** — and that purpose may have no AI at all. Geometry serves its function, not just the photo. Whatever it is (a player walking through, a hangout, a showcase, a game level), shape the space to it: first make it clean to move through and see for a player on foot. *If* there's gameplay/AI on top, add cover, sensible spawn/patrol points, reachable objectives, and room scale that fits the encounter. Ask what happens here, then build for it.

## Visual fidelity & set dressing — make it feel real and lived-in

Flat-colored boxes read as cheap and sterile. Detail is what sells a space.

- **Use textures / decals / PBR, not just flat Color3.** Apply `Texture`s for brick/wood/concrete/tile and a `SurfaceAppearance` (PBR) on hero surfaces. This adds realism with near-zero extra parts. Set texture tiling (`StudsPerTileU/V`) to real-world scale so brick/tile isn't stretched or postage-stamp tiny, and confirm every `Decal`/`Texture` is on the visible `Face` (not buried inside or facing away).
- **Trim the interiors too.** A bare wall-to-floor or wall-to-ceiling join looks unfinished. Add baseboards where wall meets floor, casing around doors/windows, and (where it fits the theme) crown at the ceiling. Cheap thin parts; big jump in "finished" feel.
- **Vary repeated elements.** When you clone curtains, blinds, books, chairs, etc., nudge them so they're not identical — blinds at different heights, a chair pushed in vs out, curtains open vs drawn. Perfect clone-stamping reads as fake; small variation reads as real.
- **Vary color/material and add weathering.** Avoid a single uniform fill — give parts subtle shade variation, grime, scuffs, and wear (especially for grounded/noir/aged themes). Perfectly clean uniform surfaces look AI-generated and dead.
- **Greeble the exterior.** A real building has downpipes, AC units, vents, chimneys, signage, wiring, fire escapes, gutters. Add a greeble pass — it transforms a bare block into a place.
- **Roofs are geometry, not an afterthought.** Build the actual roof: flat-with-parapet, or pitched/hipped with eave overhang; add roof clutter (vents, units, skylights, water tank) where it fits. A flat capped box reads as unfinished.
- **Windows must reveal a believable interior.** A glass window onto an empty/unbuilt room shows a hollow void and ruins an exterior that otherwise looks fine. Either furnish what's visible through the glass, or hide it — curtains, blinds, frosted/tinted glass, or a dark interior. Check by capturing the facade and looking *through* each window, not just at it.
- **Dress rooms with lived-in micro-details.** A furnished room still feels staged until small human traces are added. Scatter the little stuff that says someone lives/works here, oriented and placed naturally:
  - **Kitchen** — dirty dishes/glasses in the sink, plates + forks/knives + a mug on the table, a **tablecloth or placemats**, a pot on the stove, food boxes/bottles on the counter, a dish towel.
  - **Bedroom** — slightly rumpled blanket, a book/lamp/clock on the nightstand, clothes on a chair, slippers by the bed.
  - **Living room** — remote on the coffee table, mug + magazines, a throw blanket on the couch, framed pictures, a rug.
  - **Bathroom** — towels on a rail, bottles on the sink/shelf, a bath mat.
  - **Desk/office** — papers, a pen cup, mug, monitor/keyboard, a chair pushed in at an angle.
  Keep these tiny and cheap (small parts/decals), match them to the theme, and don't let them block paths or float — they sit ON surfaces. This dressing pass is what makes interiors believable; budget time for it.

## Beyond buildings: terrain, nature, curves, props & whole scenes

Most rules above assume a building with floors and rooms. Plenty of builds aren't that — a landscape, a lone prop, a forest, a whole map. Switch principles to fit the build type.

- **Organic & natural objects break the grid.** The axis-align / snap-to-grid / no-diagonal discipline is for architecture and furniture; nature is the opposite. Scatter rocks, trees, foliage, rubble, and debris with **randomized yaw (full 360°), a little random tilt, and varied scale**, placed off-grid and **clustered** (not in even rows). A forest or rock field on a tidy grid reads instantly fake. Rule of thumb: repetition *with variation* = natural; perfect alignment = manufactured.
- **Use curves and non-box forms.** Don't build everything from axis-aligned blocks. Reach for `Wedge`, `CornerWedge`, `Cylinder`, `Ball`, and rotated/segmented parts (or a MeshPart) for arches, domes, round towers, columns, pipes, ramps, and curved roads/walls. Approximate a curve with several rotated segments or a single cylinder/mesh — a world made only of cubes looks primitive.
- **Terrain for land, parts for built form.** Sculpt ground, hills, cliffs, caves, valleys, beaches, and water with `Terrain`; paint appropriate materials and smooth/erode for a natural, non-blocky surface. Blend structures INTO the terrain — sink foundations into the ground, feather the edge — no floating and no hard seam where a build meets the land. Use Terrain water for lakes/sea (or a tuned Glass/transparent part for small pools/fountains). Don't sculpt buildings out of terrain, and don't model hills out of parts.
- **Set the environment & atmosphere for whole scenes.** A building's interior lights aren't enough outdoors. Dress the scene via `Lighting`: `Sky`, `Atmosphere`, `Clouds`, fog (`FogEnd`/density), a chosen time-of-day (`ClockTime`), and subtle `ColorCorrection`/`Bloom` to set mood. Match it to the theme (a noir night, a hazy dawn, a bright midday) and keep it consistent. Interior per-room lighting rules still apply on top.
- **Compose at map scale.** A scene is more than its objects. Give it focal points / landmarks the eye lands on, paths and lines that lead the player through, density variation (calm open areas vs detailed pockets — don't detail uniformly), and a readable silhouette/skyline. Frame the hero sightline and judge the whole composition from a distance, not just object-by-object.
- **Standalone props & objects.** Many builds are a single object — a lamppost, vehicle, weapon, statue, machine. Judge it by **readable silhouette** first (recognizable as a black shape), get the **scale** right for its role (a prop can be tiny or huge — don't assume building scale), use the **orientation probe** to find its forward, and capture it on a clean background from a 3/4 hero angle. Detail, materials, weathering, and "build constructively" all still apply.

## AI mesh generation (`generate_mesh`)

- **Async + name = prompt.** The result inserts into `Workspace` (often at origin) a little later as a Model whose Name is the (truncated) prompt text. Poll / `search_game_tree` for it, then rename/anchor/organize into a labelled folder. The `size` arg is a hint — results often come out SHORTER than asked.
- **Moderation rejects some prompts** ("Moderation failed") — esp. words like **police**, weapon terms, or door/sign **lettering**. Reword neutrally and retry (e.g. "police patrol car" → "black-and-white 1940s sedan with a single red roof dome light"). Same spirit as prop prompts: keep them generic / alcohol-tobacco-IP-neutral.
- **Spinning-wheel vehicles:** generate the **body WHEELLESS** (empty/hollow open wheel wells) + a **separate wheel** mesh, then weld with **Motor6D** so wheels spin on a kinematic (anchored / BulkMoveTo) car. Verify the body is actually wheelless by rendering it from the **rear/side** (empty arches vs protruding tires) and **regenerate until clean** — the generator often adds wheels even when told not to.
- Verify any generated directional mesh's forward with the **orientation probe** (above) before placing — gen meshes have no consistent forward axis.

## MANDATORY QA — do NOT skip

- **Theme consistency — everything matches the requested theme.** Every part of the building AND furniture AND decor AND materials/colors/lighting must fit the theme the user asked for (e.g. noir, cozy, sci-fi, era). Nothing off-theme survives — a bright-red club sofa in a noir flat, a sci-fi panel on a brick tenement, neon in a period room all get rejected/restyled. Pin the theme up front and judge every element (built, inserted, generated, or dressed-in) against it. When unsure if something fits, ASK rather than assume.
- **Analyze EVERY floor.** `rbx_view(view:'top',cutawayY:<ceiling>)` at each floor's ceiling height. Verify against the plan: rooms connect via doorways, stairs reachable, NO sealed/dead boxes, furniture doesn't block paths, spacing sane.
- **Analyze EVERY room — a deep per-room pass (do this, don't rely on whole-floor shots).** Treat each room as its own QA unit. Once the floor plan is built and furniture is roughed in, ISOLATE one room at a time and analyze it closely, then refine that room's furniture before moving on. Whole-floor / whole-building captures hide what a focused room read exposes (a sofa 2 studs off the wall, a chair clipping a table, a blocked lane, an empty corner). For each room: (1) a tight top-down crop of just that room (`rbx_view(view:'top',isolate:true)` framed on it, or a high camera over its center) to check footprints, spacing, clearances, and that nothing blocks the door/path; (2) an eye-level / low-3⁄4 capture from inside, ideally from the doorway looking in, to judge how it actually reads at human height; (3) a look at each wall/corner so no side is bare or cramped. Adjust placements (nudge to walls, fix facing, open the walk lane, fill dead corners, add the room's lived-in dressing) and re-capture that same room until it's right — THEN go to the next room. Finish all rooms before declaring the floor done.
- **Verify alignment numerically, not just by eye.** Facade bays should line up vertically across floors and read symmetric where intended. Cross-check with `rbx_map` coordinates — captures hide small horizontal drift that numbers expose.
- **Highlight-to-analyze: temporarily recolor what you're checking.** When you need to isolate one category to judge it, temporarily set just those parts to a bright `Neon` oddball color (hot pink/magenta) so they leap out of the capture and any gap, misalignment, blockage, or missing piece is obvious at a glance. Great for: all doors (are they where you think?), the stairwell flights + landings (continuous? blocked?), the circulation path, every window on a face (all detailed?), collision parts, or one floor's walls. **Record each part's original Color3/Material first, capture, then restore immediately** — never leave debug colors in the finished build. This turns a vague "looks off" into a precise "that one part is missing/shifted".
- **Walk it.** Run the Navigation & playtesting walk-through — every room entered, every stair climbed, every door passed.
- **Check stairwells for gaps.** The top of each flight must meet the floor edge flush — no gap or lip between the last step and the landing/floor you'd fall through. Holes in slabs must line up with the flight; the step you arrive on must be level with solid floor. Capture a side/3-4 of the stairwell and confirm the climb is continuous.
- **Check for light leaks** (dark-lighting interior capture) and confirm everything structural is **Anchored**.
- **Enforce proper spacing** (see below).
- **ASK before pulling in assets**, then **analyze every one.** Before adding furniture OR any non-procedural asset (creator store OR AI-generated mesh), ASK the user which source to use. After adding, `rbx_map` + `rbx_view` each asset and confirm it matches the intended result — correct scale (resize to studs), style (noir/era), and quality — before keeping it. Reject/replace mismatches. Don't add assets unprompted. See **Furniture & decor sourcing** below.

## Proportions & spacing (1 stud ≈ 28 cm; R15 char ≈ 5 wide × 5 tall)

- Floor-to-floor: **13–15 studs** (interior ceiling 11–13). 8 = cramped.
- **Get heights right.** Door openings: **4–5 wide × 7–8 tall** (a player ~5 tall must pass without ducking — never a short/squashed doorway). Window sill **3–4** above floor; window 6–8 tall. Counters ~3.5, tables ~3, beds ~2, railings ~3. Sanity-check every opening/object height against a 5-stud character.
- **Drop a reference dummy in the scene while building.** A simple 5-wide × 5-tall placeholder (or an R15 rig) standing beside the work is a physical scale gauge — far more reliable than doing "5-stud character" math in your head. Remove it before final captures.
- **Ask: real doors or open doorframes?** Before finishing interiors, ASK the user whether doorways should get actual door leaves (hinged/sliding parts) or stay as open framed openings. Build accordingly; if real doors, name + group them so they can be scripted (locking to a resident identity, etc.).
- Interior walkways/halls: **≥ 5–6 wide**. Stairs **≥ 5 wide**, **≥ 7 headroom** above treads, rise ≤ ~0.9 / run ≥ ~1.0 per step (navmesh-walkable). Landings at least as deep as the stair is wide.
- Furniture: keep **≥ 3 studs clearance** around it; never block a doorway or the main path.
- Between buildings: leave **≥ 12–16 studs** (streets/alleys) for movement + camera.
- Snap to a grid (8-stud structural, 0.5-stud fine). Align windows in even vertical/horizontal bays. Avoid awkward part overlaps.
- **Ground the build in a site.** A structure floating on a bare baseplate reads as a test rig. Sit it at grade on a foundation, give it a sidewalk/ground plane/street and a little landscaping or neighboring context so it belongs somewhere. On sloped/uneven ground, meet the terrain cleanly (stepped foundation / retaining) — no gap under the walls.
- **Rail every open edge with a drop.** Any walkable edge a character could fall off — balconies, mezzanines, roof decks, stairwell voids, raised walkways — gets a guard rail or parapet ~3 studs tall. Missing edge protection both looks wrong and drops players.

## Materials & palette

Native: `Brick`, `Concrete`, `WoodPlanks`, `Plaster`, `SmoothPlastic` (frames/rails), `Glass`, `Fabric`. Set `TopSurface`/`BottomSurface` = Smooth. Layer `Texture`/`SurfaceAppearance` on top for real-surface detail rather than relying on flat color alone.
Warm-daylight study palette: brick `(142,96,82)`, concrete trim `(202,197,188)`, wood `(150,120,86)`, frame cream `(236,232,223)`, glass `(150,170,180)` transp 0.5, rail `(238,236,230)`.
Noir (game) palette: darker brick, Ambient `(83,70,57)`, PointLights Brightness 0.7 Color `(255,202,156)`.

- **Avoid pure black, pure white, and max saturation.** `(0,0,0)` and `(255,255,255)` crush and blow out under Roblox lighting; fully saturated colors look like plastic toys. Use slightly-lifted off-black, warm off-white, and gently desaturated hues for real-material feel.
- **Use `Neon` for anything that emits.** Signs, screens, light fixtures, glowing edges read as lit even without a Light object — set the part `Neon`. Great for noir signage and any self-lit surface.

### Lighting
- **Light from where light comes from.** Put `PointLight`/`SpotLight` at actual fixtures and let window openings read as the daylight source; lights floating in dead space look wrong.
- **Keep a light budget.** Too many dynamic lights tank performance and over-brighten — a handful of placed, tuned lights beats one on every part. Tune `Brightness`/`Range` rather than stacking lights.
- **Consistent color temperature.** Match light color to the theme (warm tungsten vs cool daylight) and keep it consistent within a space — mixed random light colors read as a bug.

## Proven parametric helpers (execute_luau)

- `box(folder,px,py,pz,sx,sy,sz,{Color3,Material},transp)` — anchored, smooth-surfaced part.
- **wall with openings** — split a wall band into segments around door/window gaps:
  `wall(folder, axis "X"|"Z", fixed, spanCenter, spanLen, baseY, height, thick, style, openings)`
  where `openings = {{center=lateralOffset, width, sill, top}, ...}` (sill/top measured from band base). Build per-floor bands (FH tall) so stacked windows don't overlap in the span axis.
- **framed window** — glass pane inset + 4 frame bars + mullions (1 vert + 2 horiz = 6 panes) + projecting concrete sill + header cap. Apply to EVERY face's openings.
- **balcony** — projecting deck slab + 3-sided railing (top rail + end posts + balusters). Make them generous (≥ 12 wide × 4 deep) — cramped balconies are a common complaint.
- **parapet** — wall ring above roof (3–4 tall) + concrete coping cap slightly wider; optional stepped Dutch-gable center on the facade.
- **pitched/hipped roof** — sloped slabs meeting at a ridge with an eave overhang past the wall line; cheaper than it looks and kills the "capped box" look. Add roof clutter (vents/units/skylight) where appropriate.
- **string courses / pilasters** — thin horizontal concrete belts at each floor line + a base water table; slightly-proud brick pilasters at facade corners. These sell a multi-floor facade.
- **stairs + floor holes** — build floor slabs in pieces leaving a rectangular hole over the stair shaft; switchback (two half-flights + a landing) is cleaner than one straight run through a full-strip hole. Add a guard rail around the top-floor stairwell well. **Mind the gaps:** the last tread of a flight must sit flush with (or slightly overlap) the landing/floor it arrives at — no gap, no lip you'd fall through; overlap step depth by ~0.2 and align the slab hole exactly to the flight footprint. Verify with a stairwell capture.

## Furniture & decor sourcing (ASK the user which; then ANALYZE each result)

Three options for furniture/props/decor — confirm with the user before using, then `rbx_map`+`rbx_view` every result and match scale/style/quality before keeping. Place results in the **persistent `Placed` folder** so an idempotent rebuild of the procedural geometry doesn't delete them.

1. **Creator store** — `search_creator_store` then `insert_from_creator_store`. Fastest for realistic furnished pieces (sofa/bed/kitchen, lanterns, plants). Watch licensing; resize to studs; set CollisionFidelity; verify style fits noir/era.
2. **Official AI generation** — `generate_mesh` (describe a single prop → MeshPart), `generate_procedural_model` (a small composed object/set), `generate_material` (a custom surface). Good when no store asset fits or you want a bespoke/consistent look. Generation is slow and variable — generate, then `rbx_view` + `rbx_map` it; regenerate or fix scale if off. Treat output like any inserted asset (name it, group it, anchor it, set collision, QA it). **GOTCHAS:** (a) results arrive as a Model named after the prompt — poll the workspace for it (the returned tag isn't usable with `wait_job_finished`, which is for `generate_procedural_model` only). (b) Mesh-gen sometimes emits a **degenerate proxy part dumped at a huge coordinate (e.g. `0,-1000000,0`)** that wrecks the model's bounding box (and any bbox-based scale/placement) — right after generating, scan descendants for parts with |coord|>500 and delete them BEFORE scaling/placing. Sometimes that bad part IS the only geometry → the gen failed; regenerate or fall back to procedural. (c) **A generated mesh can spawn looking pre-rotated, but the part's engine CFrame does NOT match what you see** — the geometry is baked at an angle *inside* the part, so the visual yaw ≠ the part's `Orientation`/CFrame. Min-footprint align does NOT fix this (the part is already "square" to the engine; the *mesh* is what's crooked). Capture it, read the actual visual angle, then explicitly rotate the PART until the mesh looks square to world axes — and only THEN probe/place. If it's badly off, regenerate. Never trust the spawn rotation; always verify visually right after generating.
3. **Procedural box parts** — hand-built from `box()` primitives. Lightest part count, full control, lowest fidelity. Fine for blocky/background filler and for the small lived-in dressing details.

Whatever the source: name the result, group it into the room's Folder/Model, anchor it, keep clearance per the spacing rules, and re-run the floor analysis after furnishing.

**Rest objects flush ON the floor — never floating or sunk.** After resizing, compute the item's bbox bottom (or raycast down to the floor) and set its Y so it sits on the surface. A bed hovering 1 stud up or a sofa sunk into the floor is an instant tell; verify with a side capture. (This is about seating geometry to the floor, not Roblox `Seat` parts.)

## Studio hygiene: naming & grouping

Leave the Explorer clean — never a flat pile of "Part".
- **Name parts meaningfully** as you create them: `Wall`, `Floor`, `Window_Frame`, `Balcony_Rail`, `Step`, `Door`, `Sofa`. Rename anything generic.
- **Group related parts into Models/Folders** that make sense together: one `Model` per building; inside it `Generated` (rebuildable procedural geometry) vs `Placed` (persistent inserted/generated assets), and within those Folders like `Shell`, `Detail`, `Interior`; sub-group per floor (`Floor1`, `Floor2`…) and per room (`Kitchen`, `Bath`) so a floor or room can be selected/edited/streamed as a unit.
- Each unit/apartment that an NPC owns should be its own named Model (e.g. `Unit_2A`) for later wiring (identity-locked doors, streaming).
- Set the Model's **PrimaryPart** so it can be positioned/streamed as a whole.
- Re-group/rename when structure changes — don't let it rot. Clean hierarchy = easier edits, selection, and Atomic streaming.

## Common mistakes to avoid

- Front door half-underground → put the ground floor surface AT grade (y0), door sill 0.
- "Interior makes no sense / can't navigate" → partition into real rooms with doorways that actually connect; verify with `rbx_view(view:'top',cutawayY:<ceiling>)` per floor AND walk it.
- Balconies/railings too small → make them generous.
- Base floor inside the first floor → floor slabs at clean floor lines (0, FH, 2·FH…).
- Bare window holes on non-front faces → detail ALL sides.
- Floors too short / flat boxy facade → tall floors + trim + depth (pilasters, courses, projecting sills).
- Rebuild deleted the furniture → keep placed assets in the persistent `Placed` folder, procedural geometry in `Generated`.
- Furnished but lifeless → run the set-dressing pass (dishes, books, towels, tablecloth) so rooms feel lived-in.

## buildkit gotchas

- `rbx_build` prop CSG accepts per-part `op:'union'|'subtract'|'intersect'`; the legacy `negate:true` field remains an alias for `op:'subtract'`.
- **`rbx_build` prop ships a `BuildKitRegen` script** that, on a `Scale`-attr change (or an undo / plugin re-run), DESTROYS every direct-child BasePart and rebuilds from the `BuildKitParts`/`BuildKitSpec` attributes. Hand-editing a prop's parts then silently reverts to the canonical prop. To detach a prop for hand-rigging: delete the `BuildKitRegen` script AND the `BuildKitParts`/`BuildKitSpec`/`BuildKitKind`/`Scale` attributes first. (A nested child *Model* survives — only direct-child BaseParts get wiped.)
- **The official `screen_capture` sometimes ignores a typed `camera_position`** and grabs a stale/previous view. Pass the FULL-PRECISION coords straight from `rbx_frame` (don't round them); when a capture looks wrong, re-issue with the exact `rbx_frame` output.
- **Tilted hinge parts** (a faceted/curved lid built from parts tilted about X) still hinge about world X, but compute the local pivot via `part.CFrame:PointToObjectSpace(worldHingePoint)` — `worldPoint - center` only works for axis-aligned parts.

## See also

- The roblox-buildkit README — server/plugin design, install, and the full `rbx_*` tool list.
- `roblox-gui` skill — HUDs, menus, world-space UI, UDim2 sizing, TweenService animation.
