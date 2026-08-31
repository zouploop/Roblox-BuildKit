# roblox-buildkit

Windows tooling for building Roblox scenes with an AI agent. The repository contains:

- a TypeScript MCP server;
- a Roblox Studio plugin;
- a browser Stage editor and read-only Studio Mirror;
- generator files, reusable library presets, and agent skills.

## Requirements

- Windows 10 or 11
- Node.js 22 or newer
- Roblox Studio
- Claude Code for the included `npm run setup` registration command
- the official Roblox Studio MCP separately installed when using its clean
  `screen_capture` and `execute_luau` tools

## Install

```powershell
git clone https://github.com/zouploop/Roblox-BuildKit.git
cd Roblox-BuildKit
npm install
npm run build
npm run setup
```

`npm run build` compiles `src/`, regenerates `plugin/BuildKitPlugin.rbxmx`, validates the
plugin module graph, and copies the plugin into `%LOCALAPPDATA%\Roblox\Plugins` when that
folder exists. If automatic installation is skipped, copy
`plugin/BuildKitPlugin.rbxmx` into the folder opened by Studio's **Plugins → Plugins
Folder** command.

`npm run setup` resolves this checkout's absolute `dist/index.js` path and registers the
`roblox-buildkit` stdio server with Claude Code at user scope. It replaces a stale
user-scoped BuildKit entry after the checkout moves. If Claude Code is not on `PATH`, it
prints the exact command instead. Use `npm run setup -- --print` to print without changing
configuration. This command does not install or modify the separate official Roblox
Studio MCP.

Restart Studio after the first build. The **BuildKit** toolbar button starts enabled; its
highlighted state means the plugin is polling. The plugin and MCP server may start in
either order and reconnect automatically.

## Architecture

```text
Agent --stdio--> MCP server --HTTP long-poll--> BuildKitPlugin --edits--> Studio
                         |
                         +--SSE/HTTP--> browser Stage and Mirror
```

The bridge listens on `127.0.0.1:44760`; the browser viewer listens on
`127.0.0.1:8642`. Override them with `BUILDKIT_PORT` and `BUILDKIT_VIEWER_PORT`.
`start.bat` is the self-locating standalone launcher; Claude Code normally starts the MCP
process itself.

## Browser workflow

Open <http://localhost:8642/stage.html> while the MCP server is running.

The colored dot at the upper left shows the connection state. The toolbar also shows
the last successful sync time and a prominent link for switching between **Stage** and
**Mirror**.

### Stage

Stage is the editable construction bench. Every `generators/*.js` file exports a
synchronous `generate(args)` function that returns validated build operations. The server
watches those files, keeps the last good result after a bad edit, and broadcasts updates
to the page.

#### Camera and selection

- Hold the right mouse button and drag to rotate the camera. Use the mouse wheel to zoom.
- Use **W/A/S/D** to fly relative to the direction the camera is facing, and **Q/E** to
  move down or up. Hold **Shift** to move faster.
- Left-click an object to select it. Clicking empty ground, the horizon, or the sky clears
  the selection. Left-drag across the renderer to marquee-select multiple objects.
- In Explorer, click a row to select that object or group. **Alt-click** additional rows to
  add or remove whole groups from the selection. **Ctrl+A** selects everything in Stage.
- Enable **Options → Smart select** when marquee selection should include the remaining
  members of a group after at least 90% of its selectable parts were enclosed.
- Click **Frame** to center the camera on the current selection. Explorer's search box
  filters by object name or class, and its disclosure arrows expand or collapse groups.

#### Editing objects

- Choose **Move**, **Rotate**, or **Scale** in the toolbar, or press **F**, **R**, or **G**.
  Drag the gizmo on the selected object. A multi-selection transforms around its shared
  center; multi-object scaling is uniform.
- Edit supported values in Properties. Double-click a name in Explorer to rename it.
- **Group** combines selected parts from different props. **Ungroup** makes selected parts
  standalone. You can also drag a child part in Explorer onto another prop, or onto Stage,
  to reparent it.
- **Lock** prevents accidental editing of the selection. **Delete** removes the complete
  selection. **Ctrl+C**, **Ctrl+V**, and **Ctrl+D** copy, paste, and duplicate.
- Generator-owned objects regenerate from their source file and cannot be edited directly.
  Select one and click **Detach** to turn that generator output into manual Stage objects.
- **Ctrl+Z** undoes; **Ctrl+Y** or **Ctrl+Shift+Z** redoes. The History panel shows the
  action queue, and clicking an older entry restores that Stage state.

#### Library, replay, and Roblox

The Library reads shareable presets from `library/`. Generator entries also live in the
Library panel and can be enabled or disabled there.

- **My Library** contains user presets. Select one or more Stage objects, enter a name and
  optional category, then click **Save**. **Import preset** accepts a shared
  `.bkasset.json`; **Export** downloads a preset for another user.
- **AI Library** contains agent-saved presets and generator entries. Clicking **Add** places
  the complete preset at the center of the current renderer view and selects it.
- **Recent** saves or restores complete Stage snapshots and can export a `.bkstage` file.
- **Build** replays the construction order without changing Stage. Use the slider to scrub
  through the build, or enable **auto** to replay after Stage changes.
- **Port to Roblox** sends the enabled Stage snapshot to Studio. This is the point where
  Stage work changes the live Roblox place.

#### Panels and options

Drag any panel by its title. Drop it on the highlighted left, right, top, or bottom docking
area; dropping another panel into the same area creates tabs. Drag a highlighted resize
edge to resize the panel, or leave it floating and resize it from its edges. Close panels
with **×**, then restore them from **Options → Panels**. The renderer automatically uses
the space left by docked panels, and the same layout is reused in Stage and Mirror.

**Options** also controls editable-versus-solid CSG rendering, Smart select, panel
visibility, and **Force sync**. Force sync reloads the latest accepted Stage state and
library data; it refuses to overwrite a newer transform that is still being applied.

Headless prop workers use separate Stage sessions (maximum six) through
`rbx_stage_build`, `rbx_stage_status`, `rbx_stage_render`, and `rbx_stage_clear`, then save
winners with `rbx_library_save`. Those sessions do not touch Studio until explicitly
committed.

### Mirror

Click **Open mirror**, or open <http://localhost:8642/stage.html?mirror=1>. Mirror is a
read-only reflection of the live Studio place and exposes only its hierarchy Explorer.
Camera and selection controls are the same as Stage, but Mirror intentionally has no
Properties, Library, History, transform gizmos, or preview/edit toggle. Use Studio or
`rbx_apply` to edit live instances.

Select a part, union, or Model in Explorer and click **Copy to stage** to append the entire
selection at the center of Stage. In **Options → Map ground**, **Use selected** marks the
selection as the ground target for map placement; **Clear** removes it. Plugin-side live
sync starts enabled at a 1500 ms interval; the plugin Settings panel and
`rbx_live_sync_start(intervalMs)` accept 100–60000 ms. Deleted Studio instances disappear
on the next changed snapshot. Use **Options → Force sync** to request an immediate refresh.

## Main tools

The MCP manifest is the source of truth for exact arguments. Most work starts with:

Only the core map/view/edit/reload tools, status, QA/checkpoint, and the discovery helpers are
listed at startup. Search the full catalog with `rbx_list_tools({query:"terrain"})`, then call
`rbx_enable_tools({names:["rbx_terrain"]})`; the server sends `tools/list_changed` so connected
clients can refresh their available tools.

| Tool | Purpose |
|---|---|
| `rbx_map` | Compact, filtered read of the live place. |
| `rbx_view` | Frame and compose one or more views with temporary visibility changes. |
| `rbx_apply` | Atomic bulk edits selected by target or filter. |
| `rbx_place` | Deterministic place/line/grid/ring/scatter placement from Studio prefabs. |
| `rbx_qa` | Geometry checks including gaps, overlaps, z-fights, and anchoring. |
| `rbx_dev_reload` | Rebuild and replace a stale BuildKit server process. |

Related map tools are `rbx_map_status`, `rbx_map_apply`, `rbx_map_auto_apply`, and
`rbx_ground_part`. Stage tools cover isolated builds, history, import/export, library
presets, and commits. Studio tools cover build/edit/batch operations, terrain, constraints,
sounds, GUI, tags, attributes, scripts, checkpoints, navigation, capture, and inspection.
`rbx_conformance` creates or compares measurable scene profiles, and `rbx_scene_dump`
refreshes the browser Mirror.

## Capture behavior

The preferred clean capture path is:

1. call `rbx_frame` to calculate camera coordinates;
2. pass those coordinates to the official Roblox Studio MCP `screen_capture` tool.

That path renders the viewport without Studio chrome and works while Studio is in the
background. `rbx_capture`, `rbx_orbit`, `rbx_floor_plan`, and `rbx_watch` use the Windows
screen-grab fallback because they compose temporary scene state or timed frames inside one
call. Studio must be visible for those tools. The fallback uses the plugin's
`CurrentCamera.ViewportSize` to crop to the 3D viewport when possible and returns the full
Studio client area only when the crop cannot be resolved.

## Settings and local files

The plugin Settings panel stores accepted server configuration in
`~/.buildkit/config.json`; override that directory with `BUILDKIT_CONFIG_DIR`. Open Cloud
keys are never written into a place file. Creator ID and local generation endpoints are
user settings and have no machine-specific account defaults.

Set `BRIDGE_TOKEN` or `bridgeToken` in the config file to require the same token at the
plugin boundary. The bridge remains localhost-only, but without a token any local process
can call it.

The optional `rbx_gen_mesh` tool is registered only when
`pipeline/gen_to_roblox.py` exists. That local pipeline requires ComfyUI, Hunyuan3D,
Blender, Roblox Open Cloud credentials, and its own environment configuration. Normal
clones do not include it and otherwise run unchanged.

## Development

```powershell
npm install
npm run build
npm test
```

`plugin/src/*.luau` is the plugin source of truth. `plugin/BuildKitPlugin.rbxmx` is the
generated install artifact and CI verifies that it matches. The tracked core tests cover
the TypeScript bridge, configuration, capture invocation, GUI schemas, sync mapping, and
tool registration. CI also type-checks TypeScript, audits dependencies, checks plugin
scope/contracts, and runs Selene; live Studio behavior still requires Studio verification.

See [CONTRIBUTING.md](CONTRIBUTING.md) and the installable skills under [skills/](skills/).
