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

### Stage

Stage is the editable construction bench. Every `generators/*.js` file exports a
synchronous `generate(args)` function that returns validated build operations. The server
watches those files, keeps the last good result after a bad edit, and broadcasts updates
to the page.

Stage supports selection, marquee selection, smart select, grouping, reparenting,
properties, move/rotate/scale gizmos, clipboard operations, delete, undo/redo, build
replay, CSG preview, and import/export. Shortcuts are **F** for Move, **R** for Rotate,
and **G** for Scale. Its Explorer, Properties, Library, and History panels can be closed,
resized, floated, docked, and stacked as tabs; the renderer adapts to the docked area.

The Library reads shareable presets from `library/`. Generator entries also live in the
Library panel and can be enabled or disabled there. **Port to Roblox** or
`rbx_stage_commit` sends the enabled Stage snapshot to Studio.

Headless prop workers use separate Stage sessions (maximum six) through
`rbx_stage_build`, `rbx_stage_status`, `rbx_stage_render`, and `rbx_stage_clear`, then save
winners with `rbx_library_save`. Those sessions do not touch Studio until explicitly
committed.

### Mirror

Open <http://localhost:8642/stage.html?mirror=1>. Mirror is a read-only reflection of the
live Studio place and exposes only its hierarchy Explorer. It intentionally has no
Properties, Library, History, transform gizmos, or preview/edit toggle. Use Studio or
`rbx_apply` to edit live instances.

Mirror can copy a selected part, union, or Model into Stage and can mark a selected Studio
instance as the map ground target. Plugin-side live sync starts enabled at a 1500 ms
interval; the plugin Settings panel and `rbx_live_sync_start(intervalMs)` accept
100–60000 ms. Deleted Studio instances disappear on the next changed snapshot. The viewer
Options menu includes a force-sync action.

## Main tools

The MCP manifest is the source of truth for exact arguments. Most work starts with:

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
