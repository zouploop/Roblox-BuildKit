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

local function uniqueChild(parent, name)
	local found = nil
	for _, child in ipairs(parent:GetChildren()) do
		if child.Name == name then
			if found then
				error("ambiguous path segment '" .. name .. "' under " .. parent:GetFullName())
			end
			found = child
		end
	end
	return found
end

local function pathRoot(name)
	if string.lower(name) == "workspace" or name == workspace.Name then
		return workspace
	end
	return uniqueChild(game, name)
end

local function findInst(target)
	if not target or target == "" then
		return workspace
	end
	if type(target) ~= "string" then return nil end
	if string.lower(target) == "workspace" then return workspace end

	local path = target
	if string.sub(path, 1, 5) == "game." then path = string.sub(path, 6) end
	if path == "game" then return game end

	local rootName, rest = string.match(path, "^([^%.]+)%.(.+)$")
	if rootName then
		if string.sub(path, 1, 1) == "." or string.sub(path, -1) == "." or string.find(path, "..", 1, true) then
			return nil
		end
		local current = pathRoot(rootName)
		if not current then return nil end
		for name in string.gmatch(rest, "[^%.]+") do
			current = uniqueChild(current, name)
			if not current then return nil end
		end
		return current
	elseif path == workspace.Name or string.lower(path) == "workspace" then
		return workspace
	end

	-- Short names remain supported only when exactly one Workspace descendant matches.
	local found = nil
	for _, candidate in ipairs(workspace:GetDescendants()) do
		if candidate.Name == target then
			if found then
				error("ambiguous target '" .. target .. "'; use its full instance path")
			end
			found = candidate
		end
	end
	return found
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
	if n < 0 then
		return math.ceil(n * 10 - 0.5) / 10
	end
	return math.floor(n * 10 + 0.5) / 10
end

-- Optional BasePart properties differ across Roblox classes and Studio versions.
-- Keep only JSON-safe primitive values; absent properties are omitted.
local function primitiveProperty(inst, propertyName)
	local ok, value = pcall(function()
		return inst[propertyName]
	end)
	if ok then
		local valueType = type(value)
		if valueType == "boolean" or valueType == "number" or valueType == "string" then
			return value
		end
	end
	return nil
end

local function visualFields(inst)
	local fields = {}
	local reflectance = primitiveProperty(inst, "Reflectance")
	if type(reflectance) == "number" then
		fields.reflectance = r1(reflectance)
	end
	local castShadow = primitiveProperty(inst, "CastShadow")
	if type(castShadow) == "boolean" then
		fields.castShadow = castShadow
	end
	local materialVariant = primitiveProperty(inst, "MaterialVariant")
	if type(materialVariant) == "string" then
		fields.materialVariant = materialVariant
	end
	-- Locked drives selection behaviour in the viewer the same way it does in Studio:
	-- a locked part cannot be clicked or picked.
	local locked = primitiveProperty(inst, "Locked")
	if type(locked) == "boolean" and locked then
		fields.locked = true
	end
	local usePartColor = primitiveProperty(inst, "UsePartColor")
	if type(usePartColor) == "boolean" then
		fields.usePartColor = usePartColor
	end
	return fields
end

local function assetId(value)
	local text
	if type(value) == "number" then
		if value > 0 and math.floor(value) == value then return value end
		return nil
	elseif type(value) == "string" then
		text = value
	else
		local ok, uri = pcall(function()
			return value.Uri
		end)
		if ok and type(uri) == "string" then
			text = uri
		end
		if not text then
			local ok, stringValue = pcall(tostring, value)
			if not ok then return nil end
			text = stringValue
		end
	end
	local raw = string.match(text, "^rbxassetid://(%d+)$")
		or string.match(text, "^rbxasset://(%d+)$")
		or string.match(text, "[?&]id=(%d+)")
	local id = raw and tonumber(raw)
	if id and id > 0 then
		return id
	end
	return nil
end

local function propertyValue(inst, propertyName)
	local ok, value = pcall(function()
		return inst[propertyName]
	end)
	return ok and value or nil
end

local function numberProperty(inst, propertyName)
	local value = propertyValue(inst, propertyName)
	return type(value) == "number" and value or nil
end

local function colorArray(value)
	if typeof(value) ~= "Color3" then return nil end
	return {
		math.floor(value.R * 255 + 0.5),
		math.floor(value.G * 255 + 0.5),
		math.floor(value.B * 255 + 0.5),
	}
end

local function vector2Array(value)
	if typeof(value) ~= "Vector2" then return nil end
	return { r1(value.X), r1(value.Y) }
end

local function enumName(value)
	local ok, name = pcall(function() return value.Name end)
	return ok and type(name) == "string" and name or nil
end

local function assetsOf(part)
	local assets = {}
	local function add(kind, source, map)
		local ok, value = pcall(function()
			return source[map or "Texture"]
		end)
		local id = ok and assetId(value)
		if id then
			local asset = { kind = kind, id = id }
			if map and kind == "SurfaceAppearance" then
				asset.map = map
			end
			if kind == "Texture" or kind == "Decal" then
				local face = enumName(propertyValue(source, "Face"))
				if face then asset.face = face end
				local color = colorArray(propertyValue(source, "Color3"))
				if color then asset.color = color end
				local transparency = numberProperty(source, "Transparency")
				if transparency then asset.transparency = r1(transparency) end
				if kind == "Texture" then
					for propertyName, key in pairs({
						StudsPerTileU = "studsPerTileU",
						StudsPerTileV = "studsPerTileV",
						OffsetStudsU = "offsetStudsU",
						OffsetStudsV = "offsetStudsV",
					}) do
						local number = numberProperty(source, propertyName)
						if number then asset[key] = r1(number) end
					end
				else
					local rotation = numberProperty(source, "Rotation")
					local zIndex = numberProperty(source, "ZIndex")
					local uvOffset = vector2Array(propertyValue(source, "UVOffset"))
					local uvScale = vector2Array(propertyValue(source, "UVScale"))
					if rotation then asset.rotation = r1(rotation) end
					if zIndex then asset.zIndex = r1(zIndex) end
					if uvOffset then asset.uvOffset = uvOffset end
					if uvScale then asset.uvScale = uvScale end
				end
			elseif kind == "SurfaceAppearance" then
				local color = colorArray(propertyValue(source, "Color"))
				local alphaMode = enumName(propertyValue(source, "AlphaMode"))
				local emissiveTint = colorArray(propertyValue(source, "EmissiveTint"))
				local emissiveStrength = numberProperty(source, "EmissiveStrength")
				local resampleMode = enumName(propertyValue(source, "ResampleMode"))
				if color then asset.color = color end
				if alphaMode then asset.alphaMode = alphaMode end
				if emissiveTint then asset.emissiveTint = emissiveTint end
				if emissiveStrength then asset.emissiveStrength = r1(emissiveStrength) end
				if resampleMode then asset.resampleMode = resampleMode end
			end
			table.insert(assets, asset)
		end
	end
	for _, child in ipairs(part:GetChildren()) do
		local ok, class = pcall(function()
			return child.ClassName
		end)
		if ok and (class == "Texture" or class == "Decal") then
			local count = #assets
			add(class, child, "ColorMap")
			if #assets == count then add(class, child, "Texture") end
		elseif ok and class == "SurfaceAppearance" then
			for _, map in ipairs({ "ColorMap", "MetalnessMap", "NormalMap", "RoughnessMap", "EmissiveMaskContent" }) do
				add(class, child, map)
			end
		end
	end
	if part:IsA("MeshPart") then
		local count = #assets
		add("MeshPartTexture", part, "TextureID")
		if #assets == count then add("MeshPartTexture", part, "TextureContent") end
	end
	return #assets > 0 and assets or nil
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
		for key, value in pairs(visualFields(inst)) do
			node[key] = value
		end
		node.assets = assetsOf(inst)
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

-- Flat full-fidelity part dump (pos+rotation+shape+color) for the three.js mirror
-- viewer. Unlike describeInst this is not depth-capped/tree-shaped; it emits every
-- BasePart up to the explicit part budget, since the viewer reconstructs this list.
local function shapeOf(inst)
	if inst:IsA("Part") then
		return inst.Shape.Name
	elseif inst:IsA("WedgePart") then
		return "Wedge"
	elseif inst:IsA("CornerWedgePart") then
		return "CornerWedge"
	elseif inst:IsA("TrussPart") then
		return "Truss"
	elseif inst:IsA("MeshPart") then
		return "Mesh"
	elseif inst:IsA("IntersectOperation") then
		return "Intersect"
	elseif inst:IsA("NegateOperation") then
		return "Negate"
	elseif inst:IsA("UnionOperation") then
		return "Union"
	elseif inst:IsA("PartOperation") then
		-- any future CSG operation class still reads as an operation, not a solid block
		return "Union"
	end
	return "Block"
end

local function fullPathOf(inst)
	local ok, path = pcall(function()
		return inst:GetFullName()
	end)
	if ok and type(path) == "string" then
		return path
	end

	-- GetFullName is available on Roblox Instances, but retain a safe fallback for
	-- unusual proxy objects used by static/test environments.
	local names = {}
	local current = inst
	while current do
		table.insert(names, 1, current.Name)
		current = current.Parent
	end
	return table.concat(names, ".")
end

local function relativePathOf(path, rootPath)
	if path == rootPath then
		return ""
	end
	local prefix = rootPath .. "."
	if string.sub(path, 1, #prefix) == prefix then
		return string.sub(path, #prefix + 1)
	end
	return path
end

local function copyTable(source)
	local copy = {}
	for key, value in pairs(source) do
		copy[key] = value
	end
	return copy
end

local function partCounts(parts, root, entryByPart)
	local totalByNode = {}
	local dumpedByNode = {}
	for _, part in ipairs(parts) do
		local current = part
		while current do
			totalByNode[current] = (totalByNode[current] or 0) + 1
			if entryByPart[part] then
				dumpedByNode[current] = (dumpedByNode[current] or 0) + 1
			end
			if current == root then
				break
			end
			current = current.Parent
		end
	end
	return totalByNode, dumpedByNode
end

local function treeNode(inst, root, rootPath, entryByPart, totalByNode, dumpedByNode, isRoot)
	local fullPath = fullPathOf(inst)
	local relativePath = relativePathOf(fullPath, rootPath)
	local entry = entryByPart[inst]
	if entry then
		local node = copyTable(entry)
		node.kind = "part"
		return node
	end

	if inst:IsA("BasePart") then
		if not isRoot then
			return nil
		end
		return {
			name = inst.Name,
			class = inst.ClassName,
			kind = "part",
			path = fullPath,
			fullPath = fullPath,
			relativePath = relativePath,
			omitted = true,
		}
	end

	local children = {}
	for _, child in ipairs(inst:GetChildren()) do
		local childNode = treeNode(child, root, rootPath, entryByPart, totalByNode, dumpedByNode, false)
		if childNode then
			table.insert(children, childNode)
		end
	end

	local total = totalByNode[inst] or 0
	local dumped = dumpedByNode[inst] or 0
	if not isRoot and #children == 0 and total == 0 then
		return nil
	end

	local node = {
		name = inst.Name,
		class = inst.ClassName,
		kind = "container",
		path = fullPath,
		fullPath = fullPath,
		relativePath = relativePath,
		children = children,
		totalParts = total,
		dumpedParts = dumped,
		truncated = total > dumped,
	}
	return node
end

local function sceneDump(inst, cap, includePart, precise)
	local parts = partsOf(inst)
	if includePart then
		local scoped = {}
		for _, part in ipairs(parts) do
			if includePart(part) then table.insert(scoped, part) end
		end
		parts = scoped
	end
	local out = {}
	local entryByPart = {}
	local rootPath = fullPathOf(inst)
	local limit = math.min(800, math.max(0, math.floor(cap or 800)))
	for i, p in ipairs(parts) do
		if i > limit then
			break
		end
		local rx, ry, rz = p.CFrame:ToOrientation()
		local path = fullPathOf(p)
		local parentPath = fullPathOf(p.Parent)
		local entry = {
			buildkitId = p:GetAttribute("BuildKitPartId"),
			name = p.Name,
			class = p.ClassName,
			shape = shapeOf(p),
			pos = { r1(p.Position.X), r1(p.Position.Y), r1(p.Position.Z) },
			rot = { r1(rx), r1(ry), r1(rz) },
			size = { r1(p.Size.X), r1(p.Size.Y), r1(p.Size.Z) },
			color = {
				math.floor(p.Color.R * 255 + 0.5),
				math.floor(p.Color.G * 255 + 0.5),
				math.floor(p.Color.B * 255 + 0.5),
			},
			material = p.Material.Name,
			anchored = p.Anchored,
			path = path,
			fullPath = path,
			relativePath = relativePathOf(path, rootPath),
			parentPath = parentPath,
			relativeParentPath = relativePathOf(parentPath, rootPath),
		}
		if precise then
			entry.cframe = { p.CFrame:GetComponents() }
			entry.exactSize = { p.Size.X, p.Size.Y, p.Size.Z }
		end
		if p.Transparency > 0 then
			entry.transparency = r1(p.Transparency)
		end
		for key, value in pairs(visualFields(p)) do
			entry[key] = value
		end
		entry.assets = assetsOf(p)
		-- CSG source parts stashed by buildProp. A union/intersect otherwise dumps only as
		-- its bounding box; with these the browser can re-evaluate the boolean and draw the
		-- real solid instead of an occluding block.
		-- Passed through as the raw JSON string: this module has no HttpService import
		-- (see the EDGES gate), and the browser has to JSON.parse anyway.
		local csgJson = p:GetAttribute("BuildKitCsgParts")
		if type(csgJson) == "string" and csgJson ~= "" then
			entry.csgPartsJson = csgJson
			local csgCenter = p:GetAttribute("BuildKitCsgCenter")
			if typeof(csgCenter) == "Vector3" then
				entry.csgCenter = { r1(csgCenter.X), r1(csgCenter.Y), r1(csgCenter.Z) }
			end
			local csgScale = p:GetAttribute("BuildKitCsgScale")
			if type(csgScale) == "number" then entry.csgScale = csgScale end
		end
		table.insert(out, entry)
		entryByPart[p] = entry
	end
	local totalByNode, dumpedByNode = partCounts(parts, inst, entryByPart)
	return {
		parts = out,
		totalParts = #parts,
		dumped = #out,
		truncated = #parts > limit,
		coverage = #parts > limit and "truncated" or "complete",
		tree = treeNode(inst, inst, rootPath, entryByPart, totalByNode, dumpedByNode, true),
	}
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
	sceneDump = sceneDump,
	makeBox = makeBox,
}
--#endregion
