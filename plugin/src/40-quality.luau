--!nocheck
--#region imports (generated — do not hand-edit)
local makeBox = require(script.Parent.Geometry).makeBox
--#endregion

-- ===== Quality kit: real-proportion defaults, era presets, weathering, sit-Seats,
-- bevel + plinth + CSG (opt-in, guarded) ========================================
-- sane default sizes (studs) per kind so output looks right with no size given.
local DEFAULT_SIZE = {
	chair = { 2.4, 3.4, 2.4 }, sofa = { 9, 3, 3.6 }, armchair = { 4, 3, 3.6 }, table = { 7, 3, 4 },
	desk = { 7, 3, 3.2 }, nightstand = { 2.6, 2.8, 2.2 }, dresser = { 8, 4, 2.4 }, wardrobe = { 7, 10, 2.6 },
	bed = { 7, 3.5, 8 }, shelf = { 4, 8, 1.6 }, cabinet = { 16, 7, 3.2 }, fridge = { 4.5, 9, 3.5 },
	stove = { 5, 6, 3.4 }, toilet = { 2.6, 4, 3.6 }, bathtub = { 3.5, 2.5, 7 },
}
-- era/style presets: bundles of color/material/style/hardware merged in (no override of explicit fields).
local PRESETS = {
	victorian = { color = { 92, 60, 40 }, material = "Wood", style = "shaker", hardwareColor = { 150, 120, 60 }, weather = true },
	midcentury = { color = { 150, 112, 72 }, material = "WoodPlanks", hardwareColor = { 184, 186, 190 } },
	rustic = { color = { 120, 86, 56 }, material = "Wood", hardwareColor = { 96, 74, 52 }, weather = true },
	modern = { color = { 232, 234, 236 }, material = "SmoothPlastic", hardwareColor = { 120, 122, 128 } },
	artdeco = { color = { 64, 52, 44 }, material = "WoodPlanks", hardwareColor = { 198, 168, 96 } },
	-- muted, cohesive kitchen (cream cabinet, soft sage counter, warm wood) — the
	-- KitchenUnit-style restraint: matched low-contrast tones read higher quality.
	farmhouse = { color = { 234, 228, 214 }, material = "SmoothPlastic", style = "shaker", counterColor = { 150, 166, 150 }, counterMaterial = "SmoothPlastic", backsplashColor = { 224, 218, 204 }, hardwareColor = { 120, 112, 96 } },
}
local function prepSpec(spec)
	if type(spec) ~= "table" then return spec end
	local pre = spec.preset and PRESETS[tostring(spec.preset):lower()]
	if pre then
		for k, v in pairs(pre) do
			if spec[k] == nil then spec[k] = v end
		end
	end
	if not spec.size and DEFAULT_SIZE[spec.kind] then
		spec.size = DEFAULT_SIZE[spec.kind]
	end
	return spec
end

-- subtle weathering so surfaces aren't dead-flat uniform (tiny per-part colour jitter).
local function applyWeather(model)
	for _, d in ipairs(model:GetDescendants()) do
		if d:IsA("BasePart") and d.Material ~= Enum.Material.Glass and d.Material ~= Enum.Material.Neon then
			local c, j = d.Color, (math.random() - 0.5) * 0.06
			d.Color = Color3.new(math.clamp(c.R + j, 0, 1), math.clamp(c.G + j, 0, 1), math.clamp(c.B + j, 0, 1))
		end
	end
end

-- one invisible Roblox Seat over a seating piece's cushion so a player can sit.
local function addSitSeat(model, cx, cz, w, d, seatTop)
	local s = Instance.new("Seat")
	s.Name = "SitSeat"; s.Anchored = true
	s.Size = Vector3.new(math.max(1, w), 0.4, math.max(1, d))
	s.CFrame = CFrame.new(cx, seatTop + 0.25, cz)
	s.Transparency = 1; s.CanCollide = true
	s.TopSurface = Enum.SurfaceType.Smooth; s.BottomSurface = Enum.SurfaceType.Smooth
	s.Parent = model
end

-- cheap bevel: thin 45deg wedge strips along the front+back top edges of a slab (no CSG).
local function bevelTopEdges(model, cx, topY, cz, w, d, col, mat)
	for _, sz in ipairs({ -1, 1 }) do
		local wp = Instance.new("WedgePart")
		wp.Name = "Bevel"; wp.Anchored = true
		wp.Size = Vector3.new(w, 0.25, 0.25)
		wp.CFrame = CFrame.new(cx, topY - 0.12, cz + sz * (d / 2 - 0.12)) * CFrame.Angles(0, sz < 0 and math.rad(180) or 0, 0)
		wp.Color = col; wp.Material = mat
		wp.Parent = model
	end
end

-- 2-tier plinth base under a case good (procedural-gen style), opt-in. baseY = carcass bottom.
local function plinthBase(model, cx, cz, w, d, baseY, col, mat)
	makeBox(model, cx, baseY - 0.25, cz, w + 0.6, 0.5, d + 0.4, col, mat, "PlinthBottom")
	makeBox(model, cx, baseY - 0.7, cz, w + 0.3, 0.4, d + 0.2, col, mat, "PlinthTop")
end

-- CSG (opt-in spec.csg): union the model's DIRECT static carcass parts into one smooth
-- shell, leaving sub-Models (drawers/doors/sink) untouched. pcall-guarded -> on any
-- failure the original parts are kept, so a build can never break.
local GeometryService = nil
pcall(function() GeometryService = game:GetService("GeometryService") end)
local function csgShell(model)
	if not GeometryService then return end
	local parts = {}
	for _, d in ipairs(model:GetChildren()) do
		if d:IsA("BasePart") and not d:IsA("UnionOperation") and d.Name ~= "SitSeat" then
			parts[#parts + 1] = d
		end
	end
	if #parts < 2 then return end
	local _, sz0 = model:GetBoundingBox()
	local primary = parts[1]
	local rest = {}
	for i = 2, #parts do
		rest[#rest + 1] = parts[i]
	end
	-- classic part method returns the UnionOperation directly (GeometryService:UnionAsync
	-- returns a TABLE here, not the part — that was the carcass-destroying bug).
	local ok, union = pcall(function()
		return primary:UnionAsync(rest)
	end)
	-- BULLETPROOF: only replace the carcass if we got a real BasePart of sane footprint.
	-- Otherwise leave the original parts untouched (csg becomes a harmless no-op) — a bad
	-- union must NEVER destroy the geometry.
	if not ok or typeof(union) ~= "Instance" or not union:IsA("BasePart") then
		return
	end
	if union.Size.X < sz0.X * 0.6 or union.Size.Y < sz0.Y * 0.6 or union.Size.Z < sz0.Z * 0.6 then
		pcall(function() union:Destroy() end)
		return
	end
	union.Name = "Shell"; union.Anchored = true; union.Parent = model
	for _, p in ipairs(parts) do
		pcall(function() p:Destroy() end)
	end
	model.PrimaryPart = union
end

-- post-build pass: apply the opt-in quality options that operate on the finished model.
local function applyQuality(model, spec)
	if not (model and type(spec) == "table") then return end
	if spec.csg then pcall(csgShell, model) end
	if spec.weather then pcall(applyWeather, model) end
end

-- Generic primitive for the `prop` composer. One part from a spec: shape (box/
-- cylinder/ball/wedge), local pos (offset from the prop origin), size, optional
-- rotation (deg), color/material/neon/transparency, optional PointLight.
-- NOTE: a Cylinder's length is along its LOCAL X — rotate to orient it.
--#region exports (generated — do not hand-edit)
return {
	prepSpec = prepSpec,
	applyQuality = applyQuality,
	addSitSeat = addSitSeat,
	bevelTopEdges = bevelTopEdges,
	plinthBase = plinthBase,
}
--#endregion
