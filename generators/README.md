# BuildKit generators

Every `*.js` file in this folder contributes to the live stage preview. Keep generators pure and export a synchronous `generate(args)` function that returns the same validated ops used by `rbx_batch`:

```js
export function generate() {
  return [{
    action: "build",
    args: {
      kind: "prop",
      name: "Oak",
      center: [0, 2, 0],
      parts: [{ shape: "box", size: [4, 4, 4], color: [120, 80, 40] }],
    },
  }];
}
```

The server watches this directory and sends a complete `stage-sync` snapshot after each debounced save. Syntax/runtime/validation errors keep that file's last good ops and appear in the stage panel. Use the panel to enable or disable individual files; `rbx_stage_commit` commits the enabled preview to Studio.
