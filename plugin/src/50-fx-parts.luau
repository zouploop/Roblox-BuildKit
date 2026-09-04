--!nocheck
--#region imports (generated — do not hand-edit)
local colorOf = require(script.Parent.Geometry).colorOf
local matOf = require(script.Parent.Geometry).matOf
--#endregion

local PART_SHAPES = { box = Enum.PartType.Block, cylinder = Enum.PartType.Cylinder, ball = Enum.PartType.Ball }

-- Pillar 3 (effects): attach a tuned ParticleEmitter (+ additive LightEmission glow) for
-- fire/smoke/magic/energy/sparkle. Research steer: use ParticleEmitter (NOT Fire/Smoke
-- shortcuts) with lifetime Color/Size/Transparency sequences. A part opts in via
-- `fx = "fire"` or `fx = {preset="magic", color=[r,g,b], rate=40, size=1.5, speed=2, texture=...}`.
local FX_TEX = {
	fire = "rbxasset://textures/particles/fire_main.dds",
	smoke = "rbxasset://textures/particles/smoke_main.dds",
	sparkles = "rbxasset://textures/particles/sparkles_main.dds",
}
local function nseq(a, b, c) -- 3-keypoint NumberSequence (start / mid@0.5 / end)
	return NumberSequence.new({
		NumberSequenceKeypoint.new(0, a),
		NumberSequenceKeypoint.new(0.5, b),
		NumberSequenceKeypoint.new(1, c),
	})
end
local FX_PRESETS = {
	fire = function(e)
		e.Texture = FX_TEX.fire
		e.Color = ColorSequence.new(Color3.fromRGB(255, 200, 70), Color3.fromRGB(160, 40, 10))
		e.Size = nseq(0.2, 0.9, 0.1); e.Transparency = nseq(0.25, 0.4, 1)
		e.Lifetime = NumberRange.new(0.4, 0.8); e.Rate = 32; e.Speed = NumberRange.new(1.5, 3)
		e.SpreadAngle = Vector2.new(8, 8); e.Acceleration = Vector3.new(0, 6, 0)
		e.LightEmission = 0.85; e.LightInfluence = 0; e.RotSpeed = NumberRange.new(-40, 40)
	end,
	smoke = function(e)
		e.Texture = FX_TEX.smoke
		e.Color = ColorSequence.new(Color3.fromRGB(95, 95, 95), Color3.fromRGB(40, 40, 40))
		e.Size = nseq(0.4, 1.3, 2.2); e.Transparency = nseq(0.6, 0.75, 1)
		e.Lifetime = NumberRange.new(1.2, 2.2); e.Rate = 12; e.Speed = NumberRange.new(1, 2)
		e.SpreadAngle = Vector2.new(14, 14); e.Acceleration = Vector3.new(0, 3, 0)
		e.LightEmission = 0; e.RotSpeed = NumberRange.new(-15, 15)
	end,
	magic = function(e)
		e.Texture = FX_TEX.sparkles
		e.Color = ColorSequence.new(Color3.fromRGB(180, 90, 255), Color3.fromRGB(90, 200, 255))
		e.Size = nseq(0.1, 0.45, 0); e.Transparency = nseq(0.1, 0.3, 1)
		e.Lifetime = NumberRange.new(0.6, 1.3); e.Rate = 28; e.Speed = NumberRange.new(0.5, 2)
		e.SpreadAngle = Vector2.new(28, 28); e.Acceleration = Vector3.new(0, 1.5, 0)
		e.LightEmission = 1; e.LightInfluence = 0; e.RotSpeed = NumberRange.new(-90, 90)
	end,
	energy = function(e)
		e.Texture = FX_TEX.sparkles
		e.Color = ColorSequence.new(Color3.fromRGB(90, 255, 190), Color3.fromRGB(40, 170, 255))
		e.Size = nseq(0.15, 0.35, 0); e.Transparency = nseq(0.05, 0.3, 1)
		e.Lifetime = NumberRange.new(0.3, 0.7); e.Rate = 40; e.Speed = NumberRange.new(2, 5)
		e.SpreadAngle = Vector2.new(20, 20); e.LightEmission = 1; e.LightInfluence = 0
	end,
	sparkle = function(e)
		e.Texture = FX_TEX.sparkles
		e.Color = ColorSequence.new(Color3.fromRGB(255, 250, 220), Color3.fromRGB(255, 200, 90))
		e.Size = nseq(0.08, 0.25, 0); e.Transparency = nseq(0.1, 0.4, 1)
		e.Lifetime = NumberRange.new(0.5, 1); e.Rate = 16; e.Speed = NumberRange.new(0.3, 1)
		e.SpreadAngle = Vector2.new(40, 40); e.LightEmission = 1; e.LightInfluence = 0
	end,
}
local function attachFx(part, fx)
	if not fx then return end
	if type(fx) == "string" then fx = { preset = fx } end
	if type(fx) ~= "table" then return end
	local preset = FX_PRESETS[tostring(fx.preset or "fire"):lower()] or FX_PRESETS.fire
	local e = Instance.new("ParticleEmitter")
	preset(e)
	if type(fx.color) == "table" and #fx.color == 3 then
		e.Color = ColorSequence.new(Color3.fromRGB(fx.color[1], fx.color[2], fx.color[3]))
	end
	if tonumber(fx.rate) then e.Rate = tonumber(fx.rate) end
	if tonumber(fx.speed) then e.Speed = NumberRange.new(tonumber(fx.speed) * 0.5, tonumber(fx.speed)) end
	if tonumber(fx.size) then -- scale every Size keypoint
		local s = tonumber(fx.size)
		local kp = {}
		for _, k in ipairs(e.Size.Keypoints) do kp[#kp + 1] = NumberSequenceKeypoint.new(k.Time, k.Value * s) end
		e.Size = NumberSequence.new(kp)
	end
	if fx.texture then e.Texture = tostring(fx.texture) end
	e.Parent = part
	return e
end

-- Non-fatal build warnings (degenerate/oversize/ball-collapse), surfaced in the build result.
-- handlers.build clears this at the start of each build and merges it into the qa warnings.
local FxParts = {}
FxParts.buildWarnings = {}
local function makePart(parent, ps, ox, oy, oz)
	local shape = tostring(ps.shape or "box"):lower()
	local sz = ps.size or { 1, 1, 1 }
	local pos = ps.pos or { 0, 0, 0 }
	-- D: primitive guards. A non-positive axis collapses the part -> clamp + warn. A non-uniform
	-- BALL can't be an ellipsoid (Roblox renders the MIN axis as a sphere) -> make it uniform (mean)
	-- so the result matches the intended bulk, and warn rather than silently shrink to a tiny sphere.
	sz = { tonumber(sz[1]) or 1, tonumber(sz[2]) or 1, tonumber(sz[3]) or 1 }
	local nm = ps.name or shape
	for i = 1, 3 do
		if sz[i] <= 0.001 then
			FxParts.buildWarnings[#FxParts.buildWarnings + 1] = string.format("'%s' had a non-positive size axis -> clamped to 0.05", nm)
			sz[i] = 0.05
		end
	end
	if shape == "ball" and math.max(sz[1], sz[2], sz[3]) - math.min(sz[1], sz[2], sz[3]) > 0.05 then
		local mean = (sz[1] + sz[2] + sz[3]) / 3
		FxParts.buildWarnings[#FxParts.buildWarnings + 1] = string.format("ball '%s' non-uniform [%.2f,%.2f,%.2f] -> Roblox renders a min-axis sphere; made uniform %.2f (use a cylinder/CSG for an elongated round shape)", nm, sz[1], sz[2], sz[3], mean)
		sz = { mean, mean, mean }
	end
	local p
	if shape == "wedge" then
		p = Instance.new("WedgePart")
	else
		p = Instance.new("Part")
		p.Shape = PART_SHAPES[shape] or Enum.PartType.Block
	end
	p.Anchored = true
	p.Size = Vector3.new(sz[1], sz[2], sz[3])
	local cf = CFrame.new(ox + pos[1], oy + pos[2], oz + pos[3])
	if ps.rot then
		cf = cf * CFrame.Angles(math.rad(ps.rot[1]), math.rad(ps.rot[2]), math.rad(ps.rot[3]))
	end
	p.CFrame = cf
	p.Color = colorOf(ps.color, Color3.fromRGB(160, 160, 160))
	p.Material = ps.neon and Enum.Material.Neon or matOf(ps.material, Enum.Material.SmoothPlastic)
	p.Transparency = ps.transparency or 0
	if ps.canCollide ~= nil then p.CanCollide = ps.canCollide end
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	if ps.name then p.Name = ps.name end
	if type(ps.id) == "string" then p:SetAttribute("BuildKitPartId", ps.id) end
	if ps.op then p:SetAttribute("__op", tostring(ps.op)) end -- per-part operation during opt-in CSG
	if ps.negate then p:SetAttribute("__negate", true) end -- legacy alias for subtract
	p.Parent = parent
	if ps.light then
		local l = Instance.new("PointLight")
		l.Color = colorOf(ps.light.color, p.Color)
		l.Brightness = ps.light.brightness or 1
		l.Range = ps.light.range or 8
		l.Parent = p
	end
	if ps.fx then attachFx(p, ps.fx) end
	return p
end

-- Embedded in every built prop as a child Script so the prop is a SELF-CONTAINED
-- procedural model (KitchenUnit-style): at runtime it rebuilds its own geometry from
-- the stashed BuildKitParts (+ the Scale attribute), with no dependency on the plugin.
-- A bare model (just this script + attributes) builds itself; an already-built one only
-- rebuilds when Scale changes. (Scripts don't run in Edit, so edit-time regen still goes
-- through the plugin watcher — this is the runtime/standalone path.)
--#region exports (generated — do not hand-edit)
FxParts.makePart = makePart
return FxParts
--#endregion
