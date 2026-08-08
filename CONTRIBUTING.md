# Contributing

Thanks for contributing to roblox-buildkit! This is a small project with a deliberately
strict bar for the two files that ship together: the TypeScript MCP server and the Luau
plugin. The plugin and the server are a *pair* — a change to one side's command contract
must land with its counterpart.

## Getting set up

```powershell
npm install
npm run build   # tsc -> dist/, then regenerate + install the plugin .rbxmx
npm test        # vitest: path mapping, GUI themes, bridge routing + failover
```

The Luau plugin needs Studio and isn't covered by `npm test`. The only automated eye on it
is the warn-only Selene lint in CI (`selene.toml`). Changes there get a live Studio pass:
restart Studio, run the affected tool, watch Output for errors.

## Committing

- **The Luau source of truth is `plugin/src/*.luau`** (ordered, numeric-prefixed modules).
  `plugin/BuildKitPlugin.luau` and `plugin/BuildKitPlugin.rbxmx` are **generated** from it
  by `npm run build` (or `node scripts/gen-rbxmx.mjs`). Edit a module in `plugin/src/`, run
  the build, and commit the regenerated `BuildKitPlugin.luau` + `BuildKitPlugin.rbxmx`
  together. CI fails if the committed artifacts are stale, and a lone `plugin/src/` edit
  that skips regeneration will be caught.
  - The split is a pure concatenation in module order (`00-` … `140-`): the assembled
    `.luau` is byte-identical to what a single file would be, so cross-module locals are
    one shared scope — the same behaviour as before the split. (The deeper ModuleScript
    split that gives each module its own scope is the follow-up.)
  - `scripts/split-plugin.mjs` re-slices the assembled file back into `plugin/src/` if the
    boundaries ever need adjusting; it asserts the partition is byte-identical.
- Keep the version single-sourced: it lives in `package.json` only (the server reads it at
  startup).
- Match the commit style: imperative subject line, a short body describing *why*.

## Rules of thumb

- **Keep the two layers' contracts aligned.** If you change a `handlers.*` command's shape
  in the plugin, update the matching `bridge.sendCommand` call in `src/index.ts` (and vice
  versa). Cross-layer drift is the most common latent bug in this repo (e.g. a tool
  advertising a parameter the wire never sends).
- **Scene mutations must be reversible.** Cutaway/isolate/contrast/lighting changes record
  enough state to undo themselves — token registered *before* mutating, original values
  stashed as attributes, locked parts skipped. A throw partway must never strand a hide.
- **The bridge token must never be pushed over `/config`.** It authenticates the channel;
  it lives only in plugin settings + server env/config.
- **Test the pure-TS layer.** `src/sync.ts`, `src/gui.ts`, `src/bridge.ts`, and the exported
  tool-layer helpers in `src/index.ts` are covered — keep them that way.
- **The tool manifest is in every prompt.** Tool descriptions and field `describe()`s should
  earn their tokens: state the differentiator, don't restate the plugin's clamps or the
  skill's detail.
