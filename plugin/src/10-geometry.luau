--!nocheck
--#region imports (generated — do not hand-edit)
--#endregion

-- ---------- geometry helpers -------------------------------------------------
local function colorOf(arr, default)
	if arr and #arr == 3 then
		return Color3.fromRGB(arr[1], arr[2], arr[3])
	end
	return default
end

local function matOf(name, default)
	if name then
		local ok, m = pcall(function()
			return Enum.Material[name]
		end)
		if ok and m then
			return m
		end
	end
	return default
end

local function findInst(target)
	if not target or target == "" or target == "workspace" then
		return workspace
	end
	return workspace:FindFirstChild(target, true)
end

-- workspace.CurrentCamera can be nil (edit mode with the viewport closed, or a fresh
-- session before Studio wires the camera up). Every camera handler must route through
-- this so a nil camera fails with a clear message instead of a raw dereference error.
local function camera()
	local cam = workspace.CurrentCamera
	if not cam then
		error("no active camera — open/focus the Studio 3D viewport, then retry")
	end
	return cam
end

local function bboxOf(inst)
	if inst:IsA("Model") then
		local cf, size = inst:GetBoundingBox()
		return cf.Position, size
	elseif inst:IsA("BasePart") then
		return inst.Position, inst.Size
	else
		-- container / workspace: union over BaseParts. Expand over each part's 8 oriented-box
		-- corners (not axis-aligned Position±Size/2) so rotated loose parts aren't clipped.
		local min, max
		for _, d in ipairs(inst:GetDescendants()) do
			if d:IsA("BasePart") then
				local sx, sy, sz = d.Size.X / 2, d.Size.Y / 2, d.Size.Z / 2
				for _, sgn in ipairs({
					{ 1, 1, 1 }, { 1, 1, -1 }, { 1, -1, 1 }, { 1, -1, -1 },
					{ -1, 1, 1 }, { -1, 1, -1 }, { -1, -1, 1 }, { -1, -1, -1 },
				}) do
					local c = (d.CFrame * CFrame.new(sgn[1] * sx, sgn[2] * sy, sgn[3] * sz)).Position
					if not min then
						min, max = c, c
					else
						min = Vector3.new(math.min(min.X, c.X), math.min(min.Y, c.Y), math.min(min.Z, c.Z))
						max = Vector3.new(math.max(max.X, c.X), math.max(max.Y, c.Y), math.max(max.Z, c.Z))
					end
				end
			end
		end
		if not min then
			return Vector3.new(0, 0, 0), Vector3.new(10, 10, 10)
		end
		return (min + max) / 2, (max - min)
	end
end

local function getBBox(target)
	local inst = findInst(target)
	if not inst then
		error("target not found: " .. tostring(target))
	end
	return bboxOf(inst)
end

-- Flatten a target to its BaseParts (includes the instance itself if it is one).
local function partsOf(inst)
	local list = {}
	if inst:IsA("BasePart") then
		table.insert(list, inst)
	end
	for _, d in ipairs(inst:GetDescendants()) do
		if d:IsA("BasePart") then
			table.insert(list, d)
		end
	end
	return list
end

-- Apply a world-space transform (pre-multiplied) to a Model or BasePart.
local function pivotWorld(inst, worldCF)
	if inst:IsA("Model") then
		inst:PivotTo(worldCF * inst:GetPivot())
	elseif inst:IsA("BasePart") then
		inst.CFrame = worldCF * inst.CFrame
	end
end

-- Round to 1 decimal so JSON readbacks stay compact (cheap "eyes" for the LLM).
local function r1(n)
	return math.floor(n * 10 + 0.5) / 10
end

-- Compact recursive scene readback: name/class/bbox per node, BasePart props,
-- children to `depth`. Lets the LLM verify a build/edit in text without a capture.
local function describeInst(inst, depth)
	local c, sz = bboxOf(inst)
	local node = {
		name = inst.Name,
		class = inst.ClassName,
		center = { r1(c.X), r1(c.Y), r1(c.Z) },
		size = { r1(sz.X), r1(sz.Y), r1(sz.Z) },
	}
	if inst:IsA("BasePart") then
		node.anchored = inst.Anchored
		node.material = inst.Material.Name
		node.color = {
			math.floor(inst.Color.R * 255 + 0.5),
			math.floor(inst.Color.G * 255 + 0.5),
			math.floor(inst.Color.B * 255 + 0.5),
		}
		if inst.Transparency > 0 then
			node.transparency = r1(inst.Transparency)
		end
	end
	local kids = inst:GetChildren()
	node.childCount = #kids
	if depth > 0 and #kids > 0 then
		node.children = {}
		for _, k in ipairs(kids) do
			if #node.children >= 40 then
				node.truncated = true
				break
			end
			table.insert(node.children, describeInst(k, depth - 1))
		end
	end
	return node
end

local function makeBox(parent, cx, cy, cz, sx, sy, sz, color, mat, name)
	local p = Instance.new("Part")
	p.Anchored = true
	p.Size = Vector3.new(sx, sy, sz)
	p.CFrame = CFrame.new(cx, cy, cz)
	p.Color = color
	p.Material = mat
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	if name then
		p.Name = name
	end
	p.Parent = parent
	return p
end

--#region exports (generated — do not hand-edit)
return {
	colorOf = colorOf,
	matOf = matOf,
	findInst = findInst,
	camera = camera,
	bboxOf = bboxOf,
	getBBox = getBBox,
	partsOf = partsOf,
	pivotWorld = pivotWorld,
	r1 = r1,
	describeInst = describeInst,
	makeBox = makeBox,
}
--#endregion
