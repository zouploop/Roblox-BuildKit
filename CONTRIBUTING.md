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

- **`plugin/BuildKitPlugin.rbxmx` is generated from `plugin/BuildKitPlugin.luau`.** Edit the
  `.luau`, run `npm run build` (or `node scripts/gen-rbxmx.mjs`), and commit **both** files
  together. CI fails if the committed artifact is stale, and a lone `.luau` edit that skips
  regeneration will be caught.
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
