# Skills for roblox-buildkit

Skills for any AI agent, packaged to pair with the
**roblox-buildkit** MCP server + Studio plugin in this repo.

## What's here

| Skill | Use for |
|-------|---------|
| `roblox-building` | Build/improve structures, interiors, props, whole scenes — drives the BuildKit capture loop |
| `roblox-gui` | Build, animate, and debug Roblox GUI elements — HUDs, menus, world-space UI, player labels, UDim2 sizing, TweenService animations |

Each skill carries a **"Using the BuildKit MCP"** section pointing at the relevant
`rbx_*` tools (see the root [`README.md`](../README.md) for the full server/plugin design).

## Install

**1. Install the Studio plugin** — copy `plugin/BuildKitPlugin.rbxmx` into your local
Roblox Studio **Plugins** folder (Studio → Plugins → Plugins Folder), then enable it.
The server screenshots the Studio window, so keep Studio open while building.

**2. Install the skill** — copy this folder into your agent's skills directory, wherever
that agent reads skills from (e.g. `~/.claude/skills/` for Claude agents).

**3. Register the MCP server** — build it first (`npm install && npm run build` in the repo
root; the server source ships in `src/`). It runs as its own Node process from the repo
checkout — it does **not** install into the Roblox plugins folder. Copy/paste the block
below into your agent's MCP config (e.g. `.mcp.json`), replacing the path with your repo
checkout:

```json
{
  "mcpServers": {
    "roblox-buildkit": {
      "command": "node",
      "args": ["C:/absolute/path/to/roblox-buildkit/dist/index.js"]
    }
  }
}
```

The server starts when the agent session starts and stops when it ends — it is not tied to
Studio. The plugin long-polls it and auto-reconnects, so order of launch doesn't matter.

## Config / credentials

Credentials are **never** committed. The Open Cloud key (for asset upload) lives only in
your user-local `~/.buildkit/config.json` — set it via the plugin's **Settings** panel,
which pushes values to the server over the bridge. `~/.buildkit/` is gitignored.
