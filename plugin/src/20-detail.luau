-- ---------- rounded-detail helpers (fidelity: legs / pulls / knobs / spouts) ----
-- a Cylinder oriented along an axis: "x" (length = local X, default), "y" (vertical),
-- "z" (along depth). len = length on that axis; dia = diameter. NOTE rbx_qa reads
-- world-AABBs so rotated cylinders look like fat boxes — expect harmless overlap/
-- z-fight flags on cylinder detail; trust the capture.
local function makeCyl(parent, cx, cy, cz, len, dia, axis, color, mat, name)
	local p = Instance.new("Part")
	p.Shape = Enum.PartType.Cylinder
	p.Anchored = true
	p.Size = Vector3.new(len, dia, dia)
	local cf = CFrame.new(cx, cy, cz)
	if axis == "y" then
		cf = cf * CFrame.Angles(0, 0, math.rad(90))
	elseif axis == "z" then
		cf = cf * CFrame.Angles(0, math.rad(90), 0)
	end
	p.CFrame = cf
	p.Color = color
	p.Material = mat or Enum.Material.SmoothPlastic
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	if name then p.Name = name end
	p.Parent = parent
	return p
end

local function makeBall(parent, cx, cy, cz, dia, color, mat, name)
	local p = Instance.new("Part")
	p.Shape = Enum.PartType.Ball
	p.Anchored = true
	p.Size = Vector3.new(dia, dia, dia)
	p.CFrame = CFrame.new(cx, cy, cz)
	p.Color = color
	p.Material = mat or Enum.Material.SmoothPlastic
	if name then p.Name = name end
	p.Parent = parent
	return p
end

-- modern bar pull: a horizontal round bar standing off the front on 2 short posts.
local function barPull(parent, cx, cy, frontZ, w, color)
	local bw = math.clamp(w * 0.6, 1.2, 3.0)
	makeCyl(parent, cx, cy, frontZ + 0.34, bw, 0.16, "x", color, Enum.Material.Metal, "Pull")
	for _, s in ipairs({ -1, 1 }) do
		-- post spans from INTO the drawer front (frontZ-0.07) out to the bar — touches both
		makeBox(parent, cx + s * bw * 0.42, cy, frontZ + 0.15, 0.13, 0.13, 0.44, color, Enum.Material.Metal, "PullPost")
	end
end

-- round knob: a short stem + a ball cap standing off the front.
local function roundKnob(parent, x, y, frontZ, color)
	makeCyl(parent, x, y, frontZ + 0.11, 0.42, 0.14, "z", color, Enum.Material.Metal, "KnobStem") -- stem reaches INTO the door (frontZ-0.1) so it's joined
	makeBall(parent, x, y, frontZ + 0.34, 0.42, color, Enum.Material.Metal, "Knob")
end

-- a turned round leg (single vertical cylinder from y0 to y1).
local function roundLeg(parent, x, y0, y1, z, dia, color, mat, name)
	return makeCyl(parent, x, (y0 + y1) / 2, z, y1 - y0, dia, "y", color, mat, name or "Leg")
end

local _regenTarget = nil -- during in-place regen, getOrMakeModel returns this instead of a new Model
local function getOrMakeModel(parentName, name)
	if _regenTarget then
		return _regenTarget
	end
	local parent = workspace
	if parentName then
		local found = workspace:FindFirstChild(parentName, true)
		if found and found:IsA("Model") then
			parent = found
		end
	end
	local m = Instance.new("Model")
	m.Name = name
	m.Parent = parent
	return m
end

