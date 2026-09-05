--!nocheck
--#region imports (generated — do not hand-edit)
local makeBox = require(script.Parent.Geometry).makeBox
--#endregion

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

local Detail = {}
Detail._regenTarget = nil -- during in-place regen, getOrMakeModel returns this instead of a new Model
Detail._buildParent = nil -- private Stage commit context; takes precedence over name lookup
Detail._buildCreated = nil -- models created by the current private build call
Detail._buildThread = nil -- coroutine that owns the private Stage commit context

local function privateChild(parent, name)
	local found = nil
	for _, child in ipairs(parent:GetChildren()) do
		if child.Name == name then
			if found then
				error("ambiguous private build parent '" .. name .. "' under " .. parent.Name)
			end
			found = child
		end
	end
	return found
end

local function privateParent(parentName)
	local root = Detail._buildParent
	if not root then return nil end
	if parentName == nil then return root end
	if type(parentName) ~= "string" or parentName == "" then
		error("private build parent must be a non-empty candidate name or path")
	end

	-- Prefer an exact direct name so model names containing dots remain usable.
	local direct = privateChild(root, parentName)
	if direct then
		if not direct:IsA("Model") then error("private build parent is not a Model: " .. parentName) end
		return direct
	end
	if parentName == root.Name then return root end

	local path = parentName
	local prefix = root.Name .. "."
	if string.sub(path, 1, #prefix) == prefix then
		path = string.sub(path, #prefix + 1)
	elseif not string.find(path, ".", 1, true) then
		error("private build parent not found in candidate: " .. parentName)
	end
	if path == "" or string.sub(path, 1, 1) == "." or string.sub(path, -1) == "." or string.find(path, "..", 1, true) then
		error("invalid private build parent path: " .. parentName)
	end

	local current = root
	for segment in string.gmatch(path, "[^%.]+") do
		current = privateChild(current, segment)
		if not current then error("private build parent not found in candidate: " .. parentName) end
	end
	if not current:IsA("Model") then error("private build parent is not a Model: " .. parentName) end
	return current
end

local function getOrMakeModel(parentName, name)
	if Detail._buildParent then
		if Detail._buildThread ~= coroutine.running() then
			error("private Stage commit build context belongs to another coroutine")
		end
		local parent = privateParent(parentName)
		local m = Instance.new("Model")
		m.Name = name
		m.Parent = parent
		if Detail._buildCreated then table.insert(Detail._buildCreated, m) end
		return m
	end
	if Detail._regenTarget then
		return Detail._regenTarget
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

--#region exports (generated — do not hand-edit)
Detail.makeCyl = makeCyl
Detail.makeBall = makeBall
Detail.barPull = barPull
Detail.roundKnob = roundKnob
Detail.roundLeg = roundLeg
Detail.getOrMakeModel = getOrMakeModel
return Detail
--#endregion
