---
name: roblox-gui
description: "Use when building, animating, or debugging Roblox GUI elements including HUDs, menus, world-space UI, and player labels. Triggers on: ScreenGui setup, SurfaceGui or BillboardGui placement, UDim2 sizing questions, TweenService UI animations, responsive scaling, LocalScript GUI logic, ResetOnSpawn issues, or any Frame/TextLabel/ImageButton layout work."
---

# Roblox GUI Reference

## Raw Luau GUI Container Types

| Container | Parent | Use Case |
|---|---|---|
| `ScreenGui` | `StarterGui` (authoring) / `PlayerGui` (runtime) | HUDs, menus, overlays — always faces screen |
| `SurfaceGui` | `BasePart`, or `PlayerGui` with `Adornee` | World-space UI on a part surface (signs, screens) |
| `BillboardGui` | `BasePart`/`Attachment`, or `PlayerGui` with `Adornee` | Camera-facing world UI (name tags, health bars) |

Interactive `SurfaceGui` and `BillboardGui` descendants receive player input only when the
container is under `PlayerGui` (normally cloned from `StarterGui`) with `Adornee` targeting
the world part or attachment. The adorned part must also have `CanQuery = true`.

### ScreenGui

```lua
-- LocalScript in StarterGui or StarterPlayerScripts
local player = game:GetService("Players").LocalPlayer
local playerGui = player:WaitForChild("PlayerGui")

local screenGui = Instance.new("ScreenGui")
screenGui.Name = "HUD"
screenGui.ResetOnSpawn = false   -- keep GUI across respawns
screenGui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
screenGui.Parent = playerGui
```

### SurfaceGui

```lua
local surfaceGui = Instance.new("SurfaceGui")
surfaceGui.Face = Enum.NormalId.Front
surfaceGui.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
surfaceGui.PixelsPerStud = 50
surfaceGui.Parent = workspace.ScreenPart

local label = Instance.new("TextLabel")
label.Size = UDim2.fromScale(1, 1)
label.Text = "Hello World"
label.Parent = surfaceGui
```

### BillboardGui

```lua
local billboard = Instance.new("BillboardGui")
billboard.Size = UDim2.fromOffset(200, 50)
billboard.StudsOffset = Vector3.new(0, 2.5, 0)  -- float above head
billboard.AlwaysOnTop = false
billboard.Parent = character:WaitForChild("Head")

local nameLabel = Instance.new("TextLabel")
nameLabel.Size = UDim2.fromScale(1, 1)
nameLabel.BackgroundTransparency = 1
nameLabel.Text = player.DisplayName
nameLabel.Parent = billboard
```

---

## UDim2 Sizing and Positioning

`UDim2.new(xScale, xOffset, yScale, yOffset)` — scale is proportional to the parent's size and combines additively with a pixel offset. Scale is not limited to 0–1.

```lua
frame.Size     = UDim2.new(1, 0, 0, 50)       -- full width, 50px tall
frame.Position = UDim2.new(0, 0, 0, 0)         -- top-left corner

frame.Size     = UDim2.fromScale(0.6, 0.4)     -- 60% wide, 40% tall
frame.Position = UDim2.new(0.2, 0, 0.3, 0)    -- centered (0.2 = (1-0.6)/2)

UDim2.fromScale(0.5, 0.5)    -- scale only
UDim2.fromOffset(300, 150)   -- pixels only
```

**AnchorPoint** shifts the element's pivot (0–1 on each axis):

```lua
frame.AnchorPoint = Vector2.new(0.5, 0.5)   -- pivot at center
frame.Position    = UDim2.fromScale(0.5, 0.5)  -- truly centered on screen
```

---

## Responsive Design

Use scale for major layout and offsets for fixed padding or minimum tap sizes. Combine both
with constraints; scale alone can make controls unusably small on narrow screens.

```lua
button.Size     = UDim2.fromScale(0.2, 0.07)
button.Position = UDim2.new(0.4, 0, 0.85, 0)

-- Prevent distortion with UIAspectRatioConstraint
local arc = Instance.new("UIAspectRatioConstraint")
arc.AspectRatio = 4   -- width:height = 4:1
arc.Parent = button

local textLimit = Instance.new("UITextSizeConstraint")
textLimit.MinTextSize = 12
textLimit.MaxTextSize = 24
textLimit.Parent = button
```

---

## TweenService Animations

```lua
local TweenService = game:GetService("TweenService")
local tweenInfo = TweenInfo.new(0.3, Enum.EasingStyle.Quad, Enum.EasingDirection.Out)

local menuFrame = script.Parent

local function openMenu()
    TweenService:Create(menuFrame, tweenInfo, {
        Position = UDim2.new(0.05, 0, 0.1, 0)
    }):Play()
end

local function closeMenu()
    TweenService:Create(menuFrame, tweenInfo, {
        Position = UDim2.new(-0.5, 0, 0.1, 0)
    }):Play()
end

-- Animated progress bar
local function setProgress(bar, pct)
    TweenService:Create(bar, TweenInfo.new(0.2), {
        Size = UDim2.new(pct, 0, 1, 0)
    }):Play()
end
```

---

## LocalScript Placement

| Location | Notes |
|---|---|
| `StarterGui` | Cloned into `PlayerGui` on join; use `ResetOnSpawn = false` to persist |
| `StarterPlayerScripts` | Runs once, not reset on respawn; good for persistent managers |
| `StarterCharacterScripts` | Re-runs each spawn; suited for character-dependent UI |

```lua
-- Safe pattern: wait for character
local player = game:GetService("Players").LocalPlayer
local character = player.Character or player.CharacterAdded:Wait()
local humanoid = character:WaitForChild("Humanoid")

humanoid.HealthChanged:Connect(function(health)
    -- update health bar
end)
```

---

## ResetOnSpawn

```lua
screenGui.ResetOnSpawn = false  -- persist across respawns (inventory, settings)
screenGui.ResetOnSpawn = true   -- re-create on respawn (respawn timer) — default
```

---

## Common Patterns Quick Reference

| Pattern | Key Setup |
|---|---|
| Full-screen overlay | `Size = UDim2.fromScale(1,1)`, `Position = UDim2.fromScale(0,0)` |
| Bottom-center HUD bar | `AnchorPoint = (0.5,1)`, `Position = UDim2.new(0.5,0,1,-10)` |
| Padded list | `UIPadding` + `UIListLayout` inside a Frame |
| Scrollable list | `ScrollingFrame` + `UIListLayout`; set `CanvasSize` from `UIListLayout.AbsoluteContentSize` |
| Rounded corners | `UICorner` with `CornerRadius = UDim.new(0, 8)` |
| Scaled text | `TextScaled = true` on TextLabel/TextButton so font grows with container |
| Dynamic frame height | `AutomaticSize = Enum.AutomaticSize.Y` so frame expands to fit children |
| Health bar | Nested frames: outer = background, inner tweened by `Size.X.Scale` |
| Name tag | `BillboardGui` on Head, `StudsOffset = Vector3.new(0, 2.5, 0)` |

---

## Common Mistakes

| Mistake | Fix |
|---|---|
| GUI disappears on respawn | Set `ResetOnSpawn = false` or use `StarterPlayerScripts` |
| UI looks wrong on mobile | Use `UDim2.fromScale` + `UIAspectRatioConstraint` |
| Script can't find `PlayerGui` | Use `player:WaitForChild("PlayerGui")` |
| Tween doesn't run | Ensure the property is tweenable; `Text` is not, `Position` and `Size` are |
| BillboardGui visible through walls | Verify `AlwaysOnTop = false` |
| `AbsoluteSize` is zero on first frame | Read it inside `task.defer` or after first render step |
| Clicks pass through an overlay | Set the overlay's `InputSink = Enum.InputSink.All` (or `Active = true` for older behavior); `GuiButton.Modal` only releases mouse lock |
| SurfaceGui layers conflict | Give same-face SurfaceGuis distinct `ZOffset` values; `LightInfluence` changes lighting, not layer order |
| Text tiny or huge on mobile | Use `TextScaled = true` with `UITextSizeConstraint` limits |
| UI hard to test on mobile | Use Studio's **Device Emulator** (Test tab → Device) to preview layouts |

---

## Using the BuildKit MCP

`rbx_gui` builds a styled **ScreenGui** component tree, installs the real copy in
`StarterGui`, creates an edit-time `CoreGui` preview, and returns a screenshot. Reusing the
same `name` replaces both copies. It does not build `SurfaceGui` or `BillboardGui` trees;
use ordinary Luau synced with `rbx_sync` for those.

Required fields are `name` and `root`:

```text
rbx_gui({
  name: "HUD",
  theme: "noir",
  enabled: true,
  root: { type: "panel", children: [...] }
})

rbx_gui_preview({ name: "HUD", mode: "off" })
```

`rbx_gui_preview` accepts exactly `mode: "on"` or `mode: "off"`. `theme` is `noir`, `clean`, `neon`, or a partial
token table; `enabled` controls the runtime `StarterGui` copy. Supported node types are
`panel`, `label`, `button`, `bar`, `list`, `grid`, `icon`, `input`, `divider`, and `spacer`.
Children nest through `children`; common layout fields include `size`, `anchor`, `position`,
`offset`, `fill`, `align`, `padding`, and `gap`.

Use this loop:

1. Call `rbx_gui` with a small component tree and inspect the returned screenshot.
2. Re-run the same name with corrections; do not create version-suffixed duplicate GUIs.
3. `rbx_gui` creates styled visual instances but does not attach callbacks or LocalScripts. Author interaction in a `.client.luau` file, push it with `rbx_sync({paths:[...], select:true})`, then test in Play mode and use Studio's Device Emulator for phone/tablet layouts.
4. Call `rbx_gui_preview({name, mode:"off"})` when edit-time review is complete. This
   removes only the `CoreGui` preview; the runtime `StarterGui` copy remains.

The edit preview is forced enabled even when the runtime `StarterGui` copy has
`enabled:false`. `mode:"off"` returns text only; `mode:"on"` recreates the clone and takes
a screenshot. The screenshot path uses the Studio window capture fallback, so Studio must be
visible for visual review and may fall back to the full Studio client area if viewport cropping
cannot be resolved. `rbx_gui_preview({name, mode:"on"})` recreates the preview from the
current `StarterGui` copy and returns a fresh screenshot.

### Requirements

Requires the BuildKit MCP server running, the generated BuildKit Studio plugin installed and
enabled, Studio restarted after first installation, and the BuildKit toolbar button highlighted
to indicate polling. Open or focus the Studio 3D viewport before GUI operations. The official
Roblox Studio MCP is separate and is only required for its `screen_capture` or `execute_luau`
tools.
