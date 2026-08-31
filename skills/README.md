# Skills for roblox-buildkit

Skills for any AI agent, packaged to pair with the
**roblox-buildkit** MCP server + Studio plugin in this repo.

## What's here

| Skill | Use for |
|-------|---------|
| `roblox-building` | Build/improve structures, interiors, props, whole scenes — drives the generator-file build loop, the browser stage/mirror editor, and the BuildKit capture loop |
| `roblox-gui` | Build, animate, and debug Roblox GUI elements — HUDs, menus, world-space UI, player labels, UDim2 sizing, TweenService animations |
| `roblox-extreme-quality` | Reference-driven iterative building when quality matters more than speed — spec first, verify against the spec, iterate with checkpoints |
| `roblox-build-subagents` | Coordinate parallel subagents through isolated headless Stage sessions to build, render, review, and combine props or map regions, without letting workers touch Studio |

Each skill carries a **"Using the BuildKit MCP"** section pointing at the relevant
`rbx_*` tools (see the root [`README.md`](../README.md) for the full server/plugin design).

For parallel prop work, assign each subagent a unique Stage session (maximum six):
`rbx_stage_build` → `rbx_stage_status`/`rbx_stage_render` → `rbx_stage_clear`, then
`rbx_library_save`; use `rbx_library_list` and `rbx_library_category_create` to organize
results. These subagents must never call Studio/bridge tools or `rbx_stage_commit`; the user
explicitly ports selected winners later.

## Install

**1. Install the Studio plugin** — copy `plugin/BuildKitPlugin.rbxmx` into your local
Roblox Studio **Plugins** folder (Studio → Plugins → Plugins Folder), then enable it.
The server screenshots the Studio window, so keep Studio open while building.

**2. Install the skill** — copy this folder into your agent's skills directory, wherever
that agent reads skills from (e.g. `~/.claude/skills/` for Claude agents).

**3. Register the MCP server** — build it first (`npm install && npm run build` in the repo
root), then run `npm run setup`. The setup command resolves this checkout's absolute
`dist/index.js` path and registers it with Claude Code. If Claude Code is not on `PATH`, it
prints the exact command to run; `npm run setup -- --print` always prints without changing
configuration. No path editing is required.

The server starts when the agent session starts and stops when it ends — it is not tied to
Studio. The plugin long-polls it and auto-reconnects, so order of launch doesn't matter.

## Config / credentials

Credentials are **never** committed. The Open Cloud key (for asset upload) lives only in
your user-local `~/.buildkit/config.json` — set it via the plugin's **Settings** panel,
which pushes values to the server over the bridge. `~/.buildkit/` is gitignored.
