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

## Endpoint helpers (`buildkit` in generators)

`viewer/build-primitives.js` exports dependency-free `beamBetween`, `railingPath`, and `bridgeBetween`; `viewer/build-primitives.d.ts` describes their arguments. They return raw prop parts, not build operations. Positions share the enclosing prop's coordinate frame; `rot` is XYZ degrees (`CFrame.Angles`), and cylinder length is local X.

The watched generator sandbox exposes a frozen `buildkit` namespace. Use it directly, without imports:

```js
export function generate() {
  const connections = [];
  const parts = buildkit.bridgeBetween({
    name: "crossing", from: [0, 2, 0], to: [20, 5, 8], width: 4, connections,
  });
  return [{ action: "build", args: {
    kind: "prop", name: "Crossing", center: [0, 0, 0],
    connections,
    parts: [
      ...parts,
      buildkit.beamBetween({ name: "brace", from: [0, 0, 0], to: [20, 1, 8], width: 0.3, shape: "cylinder" }),
    ],
  }}];
}
```

The watched sandbox supports **neither imports nor `require`**. The server reads the trusted helper source once at module initialization, strips its function exports, and evaluates it in a private IIFE inside each generator VM. The namespace and functions are created in that VM; no host helper functions are injected. Helper execution shares the generator's timeout and code-generation restrictions. Restart the server after changing the helper source. External ESM scripts can still import the three named exports from `viewer/build-primitives.js`; standalone plain copies work when private utilities are included and function export keywords are removed.

- `beamBetween({from,to,width,name?,color?,material?,shape?})` returns one box or cylinder. Endpoints are its end-face centers; zero length and nonfinite geometry throw.
- `railingPath({points,height=3,width=0.15,postSpacing=4,...style})` returns posts plus top/mid rails. Points are post-foot positions, spacing is maximum 3D distance per segment, and shared path vertices reuse posts. The caller supplies a supporting surface along the path.
- `bridgeBetween({from,to,width,stepRise=0.5,minTread=0.75,landingLength=width,thickness=0.5,guardrails=true,railHeight=3,railWidth=0.15,postSpacing=4,...style})` returns a solid deck/stair and side guardrails. Endpoints specify surface centers at the outer landing edges, in either travel direction. Actual rise is evenly divided and never exceeds `stepRise`; endpoint landings are at least `landingLength`. A level crossing uses one slab. Insufficient horizontal run throws. Each section has its own contiguous solid foundation down to `min(from.y,to.y)-thickness`, so adjacent sections share a full-width face, without holes or a blanket overlapping floor. Supply terrain/abutment support at that bottom elevation; this helper does not infer ground or structural load capacity. Rails occupy the deck edges; `width` is total deck width, not clear walking width.

All helpers emit stable `id === name` values. Give every call in the same prop a **unique `name` prefix** (including when combining multiple copies); defaults only identify a single standalone use. Geometry/style changes do not randomize IDs. Invalid dimensions/styles and excessive part counts throw.

Optionally pass an output `connections: []` array to `railingPath` or `bridgeBetween`, then assign that array to the enclosing prop build's `args.connections`. Helpers append only after successful generation and keep returning plain part arrays. Rails author endpoint-to-post `touch` joints; bridges also author adjacent deck-face `touch` joints and post-foot-to-deck `supportedBy` joints. IDs derive from the named parts. These describe geometric contacts, not structural certification or a connection to unspecified terrain. Stair risers use `touch`, not a claim that their walking surfaces are coplanar. External endpoint connections and clearance rules remain caller-authored.

Connection records use `{id,type,a:{part,point},b:{part,point},tolerance?,min?,max?}`, with `type` one of `touch`, `supportedBy`, `continuousSurface`, or `clearance`. Points are part-local XYZ transformed by the part rotation, not world positions. For beam end-face centers use `[-size[0]/2,0,0]` and `[size[0]/2,0,0]`. Helpers use a `1e-6` contact tolerance; schema and seam evaluation belong to the integrating layer.
