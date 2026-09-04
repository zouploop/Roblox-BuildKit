--!nocheck
-- ---------- command handlers -------------------------------------------------
--#region imports (generated — do not hand-edit)
local plugin = require(script.Parent.Ctx).plugin
local buildSeating = require(script.Parent.Builders).buildSeating
local buildRoom = require(script.Parent.Builders).buildRoom
local buildStairs = require(script.Parent.Builders).buildStairs
local buildSlab = require(script.Parent.Builders).buildSlab
local buildCabinet = require(script.Parent.Builders).buildCabinet
local buildTable = require(script.Parent.Builders).buildTable
local buildShelf = require(script.Parent.Builders).buildShelf
local buildBed = require(script.Parent.Builders).buildBed
local buildChair = require(script.Parent.Builders).buildChair
local buildDesk = require(script.Parent.Builders).buildDesk
local buildNightstand = require(script.Parent.Builders).buildNightstand
local buildDresser = require(script.Parent.Builders).buildDresser
local buildWardrobe = require(script.Parent.Builders).buildWardrobe
local buildFridge = require(script.Parent.Builders).buildFridge
local buildStove = require(script.Parent.Builders).buildStove
local buildToilet = require(script.Parent.Builders).buildToilet
local buildBathtub = require(script.Parent.Builders).buildBathtub
local buildProp = require(script.Parent.Builders).buildProp
local colorOf = require(script.Parent.Geometry).colorOf
local matOf = require(script.Parent.Geometry).matOf
local r1 = require(script.Parent.Geometry).r1
local findInst = require(script.Parent.Geometry).findInst
local bboxOf = require(script.Parent.Geometry).bboxOf
local camera = require(script.Parent.Geometry).camera
local getBBox = require(script.Parent.Geometry).getBBox
local partsOf = require(script.Parent.Geometry).partsOf
local pivotWorld = require(script.Parent.Geometry).pivotWorld
local describeInst = require(script.Parent.Geometry).describeInst
local sceneDump = require(script.Parent.Geometry).sceneDump
local gmerge = require(script.Parent.Gui).gmerge
local GUI_DEFAULT_THEME = require(script.Parent.Gui).GUI_DEFAULT_THEME
local buildNode = require(script.Parent.Gui).buildNode
local watchBuildKit = require(script.Parent.Parametric).watchBuildKit
local tagBuildKit = require(script.Parent.Parametric).tagBuildKit
local prepSpec = require(script.Parent.Quality).prepSpec
local applyQuality = require(script.Parent.Quality).applyQuality
local recorded = require(script.Parent.Core).recorded
local BRIDGE_TOKEN = require(script.Parent.Core).BRIDGE_TOKEN
local Lighting = require(script.Parent.Core).Lighting
local ChangeHistoryService = require(script.Parent.Core).ChangeHistoryService
local RUNTIME_SOURCE = require(script.Parent.Core).RUNTIME_SOURCE
local FxParts = require(script.Parent.FxParts)
--#endregion

local VIEW_DIRS = {
	front = Vector3.new(0, 0.15, 1),
	back = Vector3.new(0, 0.15, -1),
	left = Vector3.new(-1, 0.15, 0),
	right = Vector3.new(1, 0.15, 0),
	iso = Vector3.new(1, 0.8, 1),
	top = Vector3.new(0, 1, 0),
}

local cutStore = {}
local cutSeq = 0

-- Durable undo metadata for the temporary display mutations (cutaway / isolate hide a
-- part; contrast recolors it). cutStore alone is in-memory, so a stranded token used to
-- be unrecoverable — these attributes let handlers.restore_all rebuild the undo from the
-- DataModel, even in a later Studio session. Always written BEFORE the property changes.
-- (One table rather than three locals: this chunk is near Luau's 200-local scope limit.)
local ATTR = {
	hidden = "BuildKitHidden",
	contrastColor = "BuildKitContrastColor",
	contrastMat = "BuildKitContrastMaterial",
}

-- Hide a part, remembering its original Transparency on the part itself. Never
-- overwrite an existing stash: re-hiding an already-hidden part would record 1 and
-- make the restore a no-op (nested cutaway + isolate is a real case). Skips locked
-- parts — a part that can't be changed must never be marked "hidden" (the attribute
-- stash would stay behind forever, since restore can't write its Transparency either).
-- Returns true if the part was actually hidden.
local function hidePart(p)
	if p.Locked then
		return false
	end
	if p:GetAttribute(ATTR.hidden) == nil then
		p:SetAttribute(ATTR.hidden, p.Transparency)
	end
	p.Transparency = 1
	return true
end

-- Recolor a part for contrast mode, remembering its original Color/Material.
-- Skips locked parts for the same reason as hidePart. Returns true if recolored.
local function contrastPart(p, color)
	if p.Locked then
		return false
	end
	if p:GetAttribute(ATTR.contrastColor) == nil then
		p:SetAttribute(ATTR.contrastColor, p.Color)
		p:SetAttribute(ATTR.contrastMat, p.Material.Name)
	end
	p.Color = color
	p.Material = Enum.Material.SmoothPlastic
	return true
end

local handlers = {}

function handlers.ping()
	return { pong = true, place = game.Name }
end

-- Snapshot the user's camera so captures can leave it exactly as they found it.
-- Setting cam.CFrame from a plugin forces CameraType=Scriptable; without this the
-- camera stays frozen after a capture. Returns the viewport pixel size too, which
-- the Node side uses to crop Studio chrome (Explorer/Output) out of the screenshot.
function handlers.save_camera()
	local cam = camera()
	local c = cam.CFrame
	local f = cam.Focus
	local vp = cam.ViewportSize
	return {
		cframe = { c:GetComponents() },
		focus = { f:GetComponents() },
		cameraType = cam.CameraType.Name,
		viewport = { vp.X, vp.Y },
	}
end

function handlers.restore_camera(args)
	local cam = camera()
	if args.cframe and #args.cframe == 12 then
		cam.CFrame = CFrame.new(table.unpack(args.cframe))
	end
	if args.focus and #args.focus == 12 then
		cam.Focus = CFrame.new(table.unpack(args.focus))
	end
	if args.cameraType then
		local ok, ct = pcall(function()
			return Enum.CameraType[args.cameraType]
		end)
		if ok and ct then
			cam.CameraType = ct
		end
	end
	return { ok = true }
end

local function fitDistance(size, dir, fov, viewport, up)
	local aspect = (viewport.Y > 0 and viewport.X > 0) and (viewport.X / viewport.Y) or 1
	local half = size / 2
	local basis = CFrame.lookAt(Vector3.zero, -dir, up or Vector3.new(0, 1, 0))
	local right, cameraUp, forward = basis.RightVector, basis.UpVector, basis.LookVector
	local halfWidth = math.abs(right.X) * half.X + math.abs(right.Y) * half.Y + math.abs(right.Z) * half.Z
	local halfHeight = math.abs(cameraUp.X) * half.X + math.abs(cameraUp.Y) * half.Y + math.abs(cameraUp.Z) * half.Z
	local halfDepth = math.abs(forward.X) * half.X + math.abs(forward.Y) * half.Y + math.abs(forward.Z) * half.Z
	local verticalHalfFov = math.rad(fov) / 2
	local horizontalHalfFov = math.atan(math.tan(verticalHalfFov) * aspect)
	return math.max(
		halfHeight / math.max(math.tan(verticalHalfFov), 1e-4),
		halfWidth / math.max(math.tan(horizontalHalfFov), 1e-4)
	) + halfDepth
end

-- Fit math shared by frame (moves the camera) and frame_coords (returns only).
local function computeFrame(target, view, zoom)
	local center, size = getBBox(target)
	local cam = camera()
	view = view or "iso"
	local dir = (VIEW_DIRS[view] or VIEW_DIRS.iso).Unit
	local fov = cam.FieldOfView
	local up = (view == "top") and Vector3.new(0, 0, -1) or Vector3.new(0, 1, 0)
	local dist = fitDistance(size, dir, fov, cam.ViewportSize, up) * (zoom or 1.1)
	local camPos = center + dir * dist
	return center, size, camPos, fov, view
end

function handlers.frame(args)
	local center, size, camPos, _, view = computeFrame(args.target, args.view, args.zoom)
	local cam = camera()
	if view == "top" then
		cam.CFrame = CFrame.lookAt(camPos, center, Vector3.new(0, 0, -1))
	else
		cam.CFrame = CFrame.lookAt(camPos, center)
	end
	cam.Focus = CFrame.new(center)
	return {
		pos = { camPos.X, camPos.Y, camPos.Z },
		look = { center.X, center.Y, center.Z },
		size = { size.X, size.Y, size.Z },
	}
end

-- Same fit math but DOESN'T move the camera — returns coords to feed the official
-- screen_capture tool (clean, no Studio chrome, no foreground requirement).
function handlers.frame_coords(args)
	local center, size, camPos, fov, view = computeFrame(args.target, args.view, args.zoom)
	return {
		camera_position = { camPos.X, camPos.Y, camPos.Z },
		look_at_position = { center.X, center.Y, center.Z },
		field_of_view = fov,
		size = { size.X, size.Y, size.Z },
		view = view,
	}
end

-- Frame from an arbitrary azimuth/elevation (degrees) for orbit/turntable shots.
-- az=0 looks down +Z (front), az=90 looks down +X (right); el lifts above horizon.
function handlers.frame_dir(args)
	local center, size = getBBox(args.target)
	local cam = camera()
	local az = math.rad(args.azimuth or 0)
	local el = math.rad(args.elevation or 20)
	local dir = Vector3.new(math.cos(el) * math.sin(az), math.sin(el), math.cos(el) * math.cos(az))
	if dir.Magnitude < 1e-4 then
		dir = Vector3.new(0, 1, 0)
	end
	dir = dir.Unit
	local fov = cam.FieldOfView
	local fitUp = (math.abs(dir.Y) > 0.98) and Vector3.new(0, 0, -1) or Vector3.new(0, 1, 0)
	local dist = fitDistance(size, dir, fov, cam.ViewportSize, fitUp) * (args.zoom or 1.15)
	local camPos = center + dir * dist
	-- near-vertical views need a non-Y up vector or lookAt gimbal-flips
	if math.abs(dir.Y) > 0.98 then
		cam.CFrame = CFrame.lookAt(camPos, center, Vector3.new(0, 0, -1))
	else
		cam.CFrame = CFrame.lookAt(camPos, center)
	end
	cam.Focus = CFrame.new(center)
	return {
		pos = { camPos.X, camPos.Y, camPos.Z },
		look = { center.X, center.Y, center.Z },
		size = { size.X, size.Y, size.Z },
	}
end

-- Same arbitrary az/el fit math but DOESN'T move the camera — returns coords to feed
-- the official screen_capture (clean, works even when Studio is backgrounded). Lets the
-- agent do a turntable through the official tool: loop azimuths, capture each.
function handlers.frame_dir_coords(args)
	local center, size = getBBox(args.target)
	local cam = camera()
	local az = math.rad(args.azimuth or 0)
	local el = math.rad(args.elevation or 20)
	local dir = Vector3.new(math.cos(el) * math.sin(az), math.sin(el), math.cos(el) * math.cos(az))
	if dir.Magnitude < 1e-4 then
		dir = Vector3.new(0, 1, 0)
	end
	dir = dir.Unit
	local fov = cam.FieldOfView
	local fitUp = (math.abs(dir.Y) > 0.98) and Vector3.new(0, 0, -1) or Vector3.new(0, 1, 0)
	local dist = fitDistance(size, dir, fov, cam.ViewportSize, fitUp) * (args.zoom or 1.15)
	local camPos = center + dir * dist
	return {
		camera_position = { camPos.X, camPos.Y, camPos.Z },
		look_at_position = { center.X, center.Y, center.Z },
		field_of_view = fov,
		size = { size.X, size.Y, size.Z },
		azimuth = args.azimuth or 0,
		elevation = args.elevation or 20,
	}
end

-- Edit an existing target in place (so build -> see -> fix needs no raw Luau).
function handlers.edit(args)
	args = args or {}
	local inst = findInst(args.target)
	if not inst then
		error("target not found: " .. tostring(args.target))
	end
	local op = args.op
	local position, rotation, size
	if op == "transform" then
		if not inst:IsA("BasePart") then error("transform target must be a BasePart") end
		local function numericArray(value, label)
			if type(value) ~= "table" or #value ~= 3 then error(label .. " must be [x,y,z]") end
			for i = 1, 3 do
				local number = value[i]
				if type(number) ~= "number" or number ~= number or number == math.huge or number == -math.huge then
					error(label .. "[" .. i .. "] must be a finite number")
				end
			end
			return value
		end
		position = numericArray(args.position, "transform position")
		rotation = numericArray(args.rotation, "transform rotation")
		size = numericArray(args.size, "transform size")
		if size[1] <= 0 or size[2] <= 0 or size[3] <= 0 then
			error("transform size values must be positive")
		end
	end
	local bC, bS
	if inst:IsA("Model") or inst:IsA("BasePart") then
		bC, bS = bboxOf(inst)
	end
	return recorded("BuildKit edit " .. tostring(op), function()
		local skipped = 0 -- locked parts a per-part op couldn't touch (recolor/material/anchor)
		if op == "delete" then
			local n = inst.Name
			inst.Parent = nil -- ponytail: Parent=nil not Destroy() so undo can restore it
			return { op = op, deleted = n }
		elseif op == "rename" then
			if not args.name then error("rename needs name") end
			inst.Name = args.name
			return { op = op, name = inst.Name }
		elseif op == "clone" then
			local c = inst:Clone()
			c.Parent = inst.Parent
			if args.name then c.Name = args.name end
			if args.offset and #args.offset == 3 then
				pivotWorld(c, CFrame.new(args.offset[1], args.offset[2], args.offset[3]))
			end
			local center, size = bboxOf(c)
			return { op = op, name = c.Name, center = { center.X, center.Y, center.Z }, size = { size.X, size.Y, size.Z } }
		elseif op == "move" then
			local center = bboxOf(inst)
			local delta
			if args.to and #args.to == 3 then
				delta = Vector3.new(args.to[1], args.to[2], args.to[3]) - center
			elseif args.delta and #args.delta == 3 then
				delta = Vector3.new(args.delta[1], args.delta[2], args.delta[3])
			else
				error("move needs delta or to ([x,y,z])")
			end
			pivotWorld(inst, CFrame.new(delta))
		elseif op == "rotate" then
			if not (args.degrees and #args.degrees == 3) then error("rotate needs degrees [x,y,z]") end
			local center = bboxOf(inst)
			local r = CFrame.Angles(math.rad(args.degrees[1]), math.rad(args.degrees[2]), math.rad(args.degrees[3]))
			pivotWorld(inst, CFrame.new(center) * r * CFrame.new(-center))
		elseif op == "scale" then
			local s = args.scale
			if inst:IsA("Model") then
				if type(s) ~= "number" then error("model scale needs a single number factor") end
				inst:ScaleTo(inst:GetScale() * s)
			elseif inst:IsA("BasePart") then
				if type(s) == "number" then
					inst.Size = inst.Size * s
				elseif type(s) == "table" and #s == 3 then
					inst.Size = Vector3.new(inst.Size.X * s[1], inst.Size.Y * s[2], inst.Size.Z * s[3])
				else
					error("scale needs a number or [x,y,z]")
				end
			else
				error("scale target must be a Model or BasePart")
			end
		elseif op == "transform" then
			inst.CFrame = CFrame.new(position[1], position[2], position[3])
				* CFrame.fromOrientation(math.rad(rotation[1]), math.rad(rotation[2]), math.rad(rotation[3]))
			inst.Size = Vector3.new(size[1], size[2], size[3])
		elseif op == "recolor" then
			local c = colorOf(args.color, nil)
			if not c then error("recolor needs color [r,g,b]") end
			local parts = partsOf(inst)
			for _, p in ipairs(parts) do
				-- pcall each part so a locked part can't abort the rest of the loop.
				local okP = pcall(function() p.Color = c end)
				if not okP then skipped = skipped + 1 end
			end
		elseif op == "material" then
			local m = matOf(args.material, nil)
			if not m then error("material not found: " .. tostring(args.material)) end
			local parts = partsOf(inst)
			for _, p in ipairs(parts) do
				local okP = pcall(function() p.Material = m end)
				if not okP then skipped = skipped + 1 end
			end
		elseif op == "anchor" then
			local v = args.anchored
			if v == nil then v = true end
			local parts = partsOf(inst)
			for _, p in ipairs(parts) do
				local okP = pcall(function() p.Anchored = v end)
				if not okP then skipped = skipped + 1 end
			end
		else
			error("unknown edit op: " .. tostring(op))
		end
		local center, size = bboxOf(inst)
		local res = {
				op = op,
				name = inst.Name,
				center = { r1(center.X), r1(center.Y), r1(center.Z) },
				size = { r1(size.X), r1(size.Y), r1(size.Z) },
			}
			if op == "transform" then
				res.target = inst:GetFullName()
				res.position = { r1(inst.Position.X), r1(inst.Position.Y), r1(inst.Position.Z) }
				res.rotation = { rotation[1], rotation[2], rotation[3] }
			end
			if skipped > 0 then res.skippedLocked = skipped end
			if bC then
				local d = center - bC
				res.movedBy = { r1(d.X), r1(d.Y), r1(d.Z) }
				res.sizeDelta = { r1(size.X - bS.X), r1(size.Y - bS.Y), r1(size.Z - bS.Z) }
			end
			return res
	end)
end

-- ROTATION-AWARE geometry helpers (the old QA used raw Size+Position = axis-aligned, so any
-- rotated primitive — every rot-90 cylinder — was mis-judged: phantom overlaps/z-fights AND
-- missed real floats). worldAABB projects the part's true oriented box onto world axes; for the
-- dominant case (90° rotations) it is EXACT, for oblique angles a tight over-approx that we then
-- gate against real geometry via GetPartsInPart.
local function worldAABB(p)
	local cf, s = p.CFrame, p.Size
	local hx, hy, hz = s.X / 2, s.Y / 2, s.Z / 2
	local rv, uv, lv = cf.RightVector, cf.UpVector, cf.LookVector
	local ex = math.abs(rv.X) * hx + math.abs(uv.X) * hy + math.abs(lv.X) * hz
	local ey = math.abs(rv.Y) * hx + math.abs(uv.Y) * hy + math.abs(lv.Y) * hz
	local ez = math.abs(rv.Z) * hx + math.abs(uv.Z) * hy + math.abs(lv.Z) * hz
	return p.Position, Vector3.new(ex, ey, ez) -- center, HALF-extents (world-aligned)
end

-- Studio collision-query overlap set; collision fidelity/query filters apply.
-- A hit confirms collision-volume overlap, not exact rendered mesh intersection.
local function realOverlaps(parts)
	local set, idx = {}, {}
	local failures = 0
	for i, p in ipairs(parts) do idx[p] = i; set[p] = {} end
	local op = OverlapParams.new()
	op.FilterType = Enum.RaycastFilterType.Include
	op.FilterDescendantsInstances = parts
	op.MaxParts = 0
	op.RespectCanCollide = false
	for _, a in ipairs(parts) do
		local ok, hits = pcall(function() return workspace:GetPartsInPart(a, op) end)
		if ok and hits then
			for _, b in ipairs(hits) do
				if b ~= a and idx[b] then set[a][b] = true; set[b][a] = true end
			end
		else
			failures += 1
		end
	end
	return set, failures
end

-- Conservative local face test: only rectangular Parts with matching oriented axes.
-- No mesh/cylinder/wedge surface claims; a world AABB is only a broad-phase bound.
local function qaFaceGap(a, b, minGap, maxGap, minFace)
	if not (a:IsA("Part") and b:IsA("Part") and a.Shape == Enum.PartType.Block and b.Shape == Enum.PartType.Block) then return nil end
	if (a.Position - b.Position).Magnitude > (a.Size.Magnitude + b.Size.Magnitude) / 2 + maxGap then return nil end
	local axes = { a.CFrame.RightVector, a.CFrame.UpVector, a.CFrame.LookVector }
	local other = { b.CFrame.RightVector, b.CFrame.UpVector, b.CFrame.LookVector }
	local ah = { a.Size.X / 2, a.Size.Y / 2, a.Size.Z / 2 }
	local bh = { b.Size.X / 2, b.Size.Y / 2, b.Size.Z / 2 }
	local delta = b.Position - a.Position
	local distances, radii, overlaps = {}, {}, {}
	for i, axis in ipairs(axes) do
		local aligned = false
		local radius = 0
		for j, direction in ipairs(other) do
			local dot = math.abs(axis:Dot(direction))
			if dot > 1 - 1e-7 then aligned = true end
			radius += dot * bh[j]
		end
		if not aligned then return nil end
		local d = delta:Dot(axis)
		distances[i], radii[i] = d, radius
		overlaps[i] = math.min(ah[i], d + radius) - math.max(-ah[i], d - radius)
	end
	for i, axis in ipairs(axes) do
		local gap = math.abs(distances[i]) - ah[i] - radii[i]
		local j, k = i % 3 + 1, (i + 1) % 3 + 1
		if gap > minGap and gap <= maxGap and overlaps[j] > minFace and overlaps[k] > minFace then
			local normal = axis * (distances[i] >= 0 and 1 or -1)
			local point = a.Position + normal * ah[i]
			for _, t in ipairs({ j, k }) do
				local lo = math.max(-ah[t], distances[t] - radii[t])
				local hi = math.min(ah[t], distances[t] + radii[t])
				point += axes[t] * ((lo + hi) / 2)
			end
			return { gap = gap, normal = normal, pointA = point, pointB = point + normal * gap }
		end
	end
	return nil
end

-- Geometric lint you can't eyeball: unanchored parts, double-placed duplicates,
-- deep interpenetrations (z-fight/clipping risk), part-budget warnings.
-- Within each LEAF Model (holds BaseParts but no sub-Models — a single built assembly
-- like a drawer or door), verify all its parts form ONE connected blob (REAL geometry
-- overlap, rotation-correct). A split means a piece isn't joined to the rest — a drawer
-- front off its tray, a handle floating off its panel. Scoped per-leaf-model so a drawer's
-- sliding clearance to the CARCASS (a different model) is never mistaken for a defect.
-- ov = realOverlaps set over the whole instance; seats (optional) collects {part,move} to auto-seat.
local function assemblyGaps(root, out, ov, seats, allowed, coverage, report)
	local function isLeaf(m)
		if not m:IsA("Model") then return false end
		local hasPart = false
		for _, d in ipairs(m:GetDescendants()) do
			if d:IsA("Model") then return false
			elseif d:IsA("BasePart") then hasPart = true end
		end
		return hasPart
	end
	local leaves = {}
	if isLeaf(root) then table.insert(leaves, root) end
	for _, d in ipairs(root:GetDescendants()) do
		if isLeaf(d) then table.insert(leaves, d) end
	end
	for _, m in ipairs(leaves) do
		local ps = {}
		for _, d in ipairs(m:GetDescendants()) do
			if d:IsA("BasePart") and (not allowed or allowed[d]) then table.insert(ps, d) end
		end
		local k = #ps
		if k >= 2 and (k > 400 or coverage.pairScan == "skipped") then
			coverage.leavesSkipped += 1
			if #coverage.skippedLeafSample < 25 then table.insert(coverage.skippedLeafSample, m:GetFullName()) end
		end
		if k >= 2 and k <= 400 and coverage.pairScan ~= "skipped" then
			coverage.leavesChecked += 1
			local par = {}
			for i = 1, k do par[i] = i end
			local function find(x)
				while par[x] ~= x do
					par[x] = par[par[x]]
					x = par[x]
				end
				return x
			end
			local AB = {} -- rotation-aware world AABB per part (computed once)
			for i = 1, k do
				local c, h = worldAABB(ps[i])
				AB[i] = { c = c, h = h }
			end
			-- Collision-query overlap or a supported local block-face near joint.
			for i = 1, k do
				for j = i + 1, k do
					if (ov[ps[i]] and ov[ps[i]][ps[j]]) or qaFaceGap(ps[i], ps[j], -0.1, 0.1, 0.001) then
						par[find(i)] = find(j)
					end
				end
			end
			local comp = {}
			for i = 1, k do
				local r = find(i)
				comp[r] = comp[r] or {}
				table.insert(comp[r], i)
			end
			local ncomp, mainRoot, mainSize = 0, nil, nil
			for r, members in pairs(comp) do
				ncomp += 1
				if not mainSize or #members > mainSize then mainSize = #members; mainRoot = r end
			end
			if ncomp > 1 then
				local best, bestParts
				for i = 1, k do
					for j = i + 1, k do
						if find(i) ~= find(j) then
							local A, B = AB[i], AB[j]
							local dx = math.max(0, math.abs(A.c.X - B.c.X) - (A.h.X + B.h.X))
							local dy = math.max(0, math.abs(A.c.Y - B.c.Y) - (A.h.Y + B.h.Y))
							local dz = math.max(0, math.abs(A.c.Z - B.c.Z) - (A.h.Z + B.h.Z))
							local d = math.sqrt(dx * dx + dy * dy + dz * dz)
							if not best or d < best then best = d; bestParts = { ps[i], ps[j] } end
						end
					end
				end
				report("nearGaps", out, string.format("%s splits into %d groups without confirmed contact (AABB gap lower bound %.2f; verify surfaces)", m:GetFullName(), ncomp, best or 0), bestParts, "low")
				-- auto-seat (fix pass): a lone floating piece (single-part orphan component) is nudged
				-- into the nearest part of the main blob. Multi-part orphans are only reported — moving a
				-- sub-cluster could distort it, and seating a part with >1 joint could tear the other.
				if seats then
					-- Only auto-seat ISOLATED breaks: count lone (single-part) orphans first. A detailed
					-- prop with MANY spread pieces (plant fronds, decorative greebles) is not one broken
					-- part — mass-seating would collapse it inward. >2 lone orphans => report only.
					local lone = 0
					for r, members in pairs(comp) do
						if r ~= mainRoot and #members == 1 then lone += 1 end
					end
					if lone <= 2 then
						for r, members in pairs(comp) do
							if r ~= mainRoot and #members == 1 then
								local F = ps[members[1]]
								local fc = AB[members[1]].c
								local nearest, nd
								for _, mi in ipairs(comp[mainRoot]) do
									local d = (fc - AB[mi].c).Magnitude
									if not nd or d < nd then nd = d; nearest = ps[mi] end
								end
								-- near-miss only: a large move means the part is meant to sit apart, not seat
								local face = nearest and qaFaceGap(F, nearest, 0.1, 0.48, 0.001)
								local mv = face and face.normal * (face.gap + 0.12)
								if mv and mv.Magnitude <= 0.6 then table.insert(seats, { part = F, move = mv }) end
							end
						end
					end
				end
			end
		end
	end
end

-- Core QA scan over an instance (shared by handlers.qa and the build handler's auto-QA).
-- Deliberately NOT a global: this file otherwise keeps every helper local, and a leaked
-- global here could collide with another plugin's `qaScan`.
local p4Region, p4InRegion

local qaScan = function(inst, options)
	local args = type(options) == "table" and options or {}
	local fix = args.fix == true
	local allParts = partsOf(inst)
	local region = args.region ~= nil and p4Region(args.region, "qa region") or nil
	local parts, allowed = {}, nil
	if region then
		allowed = {}
		for _, part in ipairs(allParts) do
			if p4InRegion(part, region) then parts[#parts + 1] = part; allowed[part] = true end
		end
	else
		parts = allParts
	end
	local n = #parts
	local unanchored = {}
	local CAP = 1200
	local duplicates, deepOverlaps, nearGaps, zFights, fitGaps = {}, {}, {}, {}, {}
	local counts = { unanchored = 0, duplicates = 0, deepOverlaps = 0, nearGaps = 0, zFights = 0, fitGaps = 0 }
	local issues = {}
	local coverage = {
		status = "complete", partsSelected = n, partsTotal = #allParts, sampleCap = 25,
		pairScan = n <= CAP and "complete" or "skipped", pairCap = CAP,
		fitScan = args.fit and (n <= CAP and "complete" or "skipped") or "disabled",
		leavesChecked = 0, leavesSkipped = 0, leafCap = 400, skippedLeafSample = {},
		overlapQueryFailures = 0, assemblyScan = n <= CAP and "complete" or "skipped",
		geometry = "collision-query overlaps; near/fit faces only for aligned oriented blocks; not exact mesh surfaces",
	}
	local function report(kind, sample, message, objects, confidence, face)
		counts[kind] += 1
		if #sample >= 25 then return end
		table.insert(sample, message)
		local names = {}
		for _, object in ipairs(objects) do table.insert(names, object:GetFullName()) end
		local issue = { kind = kind, message = message, parts = names, confidence = confidence }
		if face then
			issue.points = { { face.pointA.X, face.pointA.Y, face.pointA.Z }, { face.pointB.X, face.pointB.Y, face.pointB.Z } }
			issue.gap = face.gap
		end
		table.insert(issues, issue)
	end
	for _, p in ipairs(parts) do
		if not p.Anchored then report("unanchored", unanchored, p:GetFullName(), { p }, "high") end
	end
	local unanchoredCount = counts.unanchored
	local zfFix = {} -- {part, axis, dir} pairs to nudge apart when args.fix
	local seats = {} -- {part, move} floating pieces to auto-seat when args.fix
	local ov = {}
	-- fit-gap (args.fit): a piece that should sit flush against a DIFFERENT assembly but leaves a
	-- visible slot (a leg short of the floor, a panel not meeting its frame, a drawer front not
	-- filling its opening). assemblyId groups by nearest Model so within-model disconnects (which
	-- assemblyGaps already catches) aren't double-counted; slidingModel spots an INTENDED drawer/door
	-- slide clearance so it isn't flagged as a defect.
	local function assemblyId(p)
		local a = p.Parent
		while a and a ~= workspace do if a:IsA("Model") then return a end; a = a.Parent end
		return p
	end
	local function slidingModel(p)
		local a = p.Parent
		while a and a ~= workspace do
			if a:IsA("Model") then local k = a:GetAttribute("Kind"); if k == "drawer" or k == "door" then return a end end
			a = a.Parent
		end
		return nil
	end
	if n <= CAP then
		ov, coverage.overlapQueryFailures = realOverlaps(parts)
		local AB = {}
		for i = 1, n do
			local c, h = worldAABB(parts[i])
			AB[i] = { c = c, h = h, vol = 8 * h.X * h.Y * h.Z }
		end
		for i = 1, n do
			local a = parts[i]
			local A = AB[i]
			for j = i + 1, n do
				local b = parts[j]
				local B = AB[j]
				local assemblyA, assemblyB = assemblyId(a), assemblyId(b)
				if args.fit and assemblyA ~= assemblyB then
						local sa, sb = slidingModel(a), slidingModel(b)
						local intended = (sa and not b:IsDescendantOf(sa)) or (sb and not a:IsDescendantOf(sb))
						if not intended then
							local face = qaFaceGap(a, b, 0.03, 0.6, 0.5)
							if face then
								report("fitGaps", fitGaps, string.format("%s | %s — %.2f local block-face gap (verify intended clearance)", a:GetFullName(), b:GetFullName(), face.gap), { a, b }, "medium", face)
							end
						end
					end
					if (a.Position - b.Position).Magnitude < 0.05 and (a.Size - b.Size).Magnitude < 0.05 then
					report("duplicates", duplicates, a:GetFullName() .. " == " .. b:GetFullName(), { a, b }, "low")
				elseif ov[a] and ov[a][b] then
					-- only pairs whose REAL geometry intersects (no phantom overlaps from oblique
					-- parts). Magnitudes come from rotation-aware world AABBs.
					local ox = math.min(A.c.X + A.h.X, B.c.X + B.h.X) - math.max(A.c.X - A.h.X, B.c.X - B.h.X)
					local oy = math.min(A.c.Y + A.h.Y, B.c.Y + B.h.Y) - math.max(A.c.Y - A.h.Y, B.c.Y - B.h.Y)
					local oz = math.min(A.c.Z + A.h.Z, B.c.Z + B.h.Z) - math.max(A.c.Z - A.h.Z, B.c.Z - B.h.Z)
					if ox > 0 and oy > 0 and oz > 0 then
						local ovol = ox * oy * oz
						local minvol = math.min(A.vol, B.vol)
						if minvol > 0 and ovol > 0.25 * minvol then
							report("deepOverlaps", deepOverlaps, string.format("%s overlaps %s (AABB estimate %d%%)", a:GetFullName(), b:GetFullName(), math.floor(100 * ovol / minvol)), { a, b }, "low")
						end
						-- z-fight: a SAME-direction face pair is coincident (within eps) while the
						-- parts overlap for real on the other two axes — two surfaces at the same
						-- plane fight over depth and FLICKER. (Opposite-direction coincidence = a
						-- clean butt joint, not flagged.)
						local EPS = 0.05
						local zf
						if (math.abs((A.c.X + A.h.X) - (B.c.X + B.h.X)) < EPS or math.abs((A.c.X - A.h.X) - (B.c.X - B.h.X)) < EPS) and oy > 0.15 and oz > 0.15 then
							zf = "X"
						elseif (math.abs((A.c.Y + A.h.Y) - (B.c.Y + B.h.Y)) < EPS or math.abs((A.c.Y - A.h.Y) - (B.c.Y - B.h.Y)) < EPS) and ox > 0.15 and oz > 0.15 then
							zf = "Y"
						elseif (math.abs((A.c.Z + A.h.Z) - (B.c.Z + B.h.Z)) < EPS or math.abs((A.c.Z - A.h.Z) - (B.c.Z - B.h.Z)) < EPS) and ox > 0.15 and oy > 0.15 then
							zf = "Z"
						end
						if zf then
							report("zFights", zFights, string.format("%s vs %s — AABB coplanarity on %s (possible z-fight; verify surfaces)", a:GetFullName(), b:GetFullName(), zf), { a, b }, "low")
							if fix then
								local function plane(h)
									if zf == "X" then return (2 * h.Y) * (2 * h.Z)
									elseif zf == "Y" then return (2 * h.X) * (2 * h.Z)
									else return (2 * h.X) * (2 * h.Y) end
								end
								local pa, pb = plane(A.h), plane(B.h)
								local ratio = (math.max(pa, pb) > 0) and (math.min(pa, pb) / math.max(pa, pb)) or 1
								-- skip a small detail flush on a big surface (fuller/label/trim): nudging it protrudes
								if ratio >= 0.5 then
									local mover = (pb <= pa) and b or a
									local oh = (mover == b) and A or B
									local mc = (zf == "X" and mover.Position.X) or (zf == "Y" and mover.Position.Y) or mover.Position.Z
									local oc = (zf == "X" and oh.c.X) or (zf == "Y" and oh.c.Y) or oh.c.Z
									table.insert(zfFix, { p = mover, axis = zf, dir = (mc >= oc) and 1 or -1 })
								end
							end
						end
					end
				end
			end
		end
	end
	-- disconnected pieces inside each built assembly (drawer front off its tray, handle off panel)
	assemblyGaps(inst, nearGaps, ov, fix and coverage.overlapQueryFailures == 0 and seats or nil, allowed, coverage, report)
	-- fix=true: nudge each z-fighting part 0.06 off the shared plane (one undo step). Capped: a model
	-- with MANY coplanar pairs is densely detailed (leaf planks, greebles) where mass-nudging does more
	-- harm than the flicker — report those instead of shoving 20+ parts around.
	local zFixed = 0
	if fix and #zfFix > 0 and #zfFix <= 12 then
		recorded("BuildKit qa fix z-fights", function()
			local done = {}
			for _, f in ipairs(zfFix) do
				if f.p and f.p.Parent and not done[f.p] then
					done[f.p] = true
					local off = 0.06 * f.dir
					f.p.CFrame = f.p.CFrame + Vector3.new(f.axis == "X" and off or 0, f.axis == "Y" and off or 0, f.axis == "Z" and off or 0)
					zFixed += 1
				end
			end
		end)
	end
	-- fix=true: auto-seat lone floating pieces into the main blob (one undo step).
	local seated = 0
	if fix and #seats > 0 then
		recorded("BuildKit qa seat floating parts", function()
			for _, s in ipairs(seats) do
				if s.part and s.part.Parent and s.move.Magnitude > 0.001 then
					s.part.CFrame = s.part.CFrame + s.move
					seated += 1
				end
			end
		end)
	end
	local center, size = bboxOf(inst)
	local warnings = {}
	if n > CAP then
		table.insert(warnings, string.format("partial QA: pair and assembly scans skipped: %d parts over %d cap", n, CAP))
	end
	if coverage.leavesSkipped > 0 then
		table.insert(warnings, string.format("partial QA: %d leaf assembly scan(s) skipped (400-part leaf / 1200-part total cap)", coverage.leavesSkipped))
	end
	if coverage.overlapQueryFailures > 0 then
		table.insert(warnings, string.format("partial QA: %d collision queries failed; connectivity is uncertain", coverage.overlapQueryFailures))
		coverage.pairScan, coverage.assemblyScan = "partial", "partial"
	end
	if n > CAP or coverage.leavesSkipped > 0 or coverage.overlapQueryFailures > 0 then
		coverage.status = "partial"
		if n <= CAP then coverage.assemblyScan = "partial" end
	end
	if n > 1000 then
		table.insert(warnings, string.format("high part count: %d", n))
	end
	if unanchoredCount > 0 then
		table.insert(warnings, string.format("%d unanchored part(s)", unanchoredCount))
	end
	if counts.duplicates > 0 then
		table.insert(warnings, string.format("%d duplicate-placement pair(s)", counts.duplicates))
	end
	if counts.deepOverlaps > 0 then
		table.insert(warnings, string.format("%d deep-overlap pair(s)", counts.deepOverlaps))
	end
	if counts.nearGaps > 0 then
		table.insert(warnings, string.format("%d assembly(ies) without confirmed contact between groups (verify surfaces)", counts.nearGaps))
	end
	if counts.zFights > 0 then
		table.insert(warnings, string.format("%d coplanar/overlapping surface pair(s) — possible z-fight risk", counts.zFights))
	end
	if counts.fitGaps > 0 then
		table.insert(warnings, string.format("%d local block-face fit-gap(s) (opt-in fit check; verify intended clearance)", counts.fitGaps))
	end
	if zFixed > 0 then
		table.insert(warnings, string.format("fix: nudged %d z-fighting part(s) 0.06 apart (re-run rbx_qa to confirm)", zFixed))
	end
	if seated > 0 then
		table.insert(warnings, string.format("fix: seated %d floating part(s) into the model (re-run rbx_qa to confirm)", seated))
	end
	local result = {
		counts = counts,
		coverage = coverage,
		issues = issues,
		target = inst.Name,
		parts = n,
		bbox = { center = { center.X, center.Y, center.Z }, size = { size.X, size.Y, size.Z } },
		unanchored = { count = unanchoredCount, sample = unanchored },
		duplicates = duplicates,
		deepOverlaps = deepOverlaps,
		nearGaps = nearGaps,
		zFights = zFights,
		fitGaps = fitGaps,
		fixed = zFixed,
		seated = seated,
		warnings = warnings,
	}
	if region then result.region = args.region end
	return result
end

function handlers.qa(args)
	local inst = findInst(args.target)
	if not inst then
		error("target not found: " .. tostring(args.target))
	end
	return qaScan(inst, args)
end

-- insert a generated Open Cloud asset (from the local-gen pipeline) into the workspace,
-- scale it to a target largest-dimension, anchor + place it. Called by the rbx_gen_mesh tool.
function handlers.insertAsset(args)
	local assetId = tonumber(args.assetId)
	if not assetId then
		error("insertAsset: bad assetId " .. tostring(args.assetId))
	end
	local ok, res = pcall(function()
		return game:GetService("InsertService"):LoadAsset(assetId)
	end)
	if not ok then
		error("LoadAsset failed: " .. tostring(res))
	end
	res.Parent = workspace
	res.Name = args.name or ("GenAsset_" .. assetId)
	-- scale whole model to a target largest dimension (Hunyuan meshes import oversized)
	local target = tonumber(args.size) or 4
	local _, sz = res:GetBoundingBox()
	local maxd = math.max(sz.X, sz.Y, sz.Z)
	if maxd > 0 and target > 0 then
		pcall(function() res:ScaleTo(target / maxd) end)
	end
	for _, d in ipairs(res:GetDescendants()) do
		if d:IsA("BasePart") then d.Anchored = true end
	end
	local p = args.place
	if type(p) == "table" and #p == 3 then
		res:PivotTo(CFrame.new(tonumber(p[1]) or 0, tonumber(p[2]) or 0, tonumber(p[3]) or 0))
	end
	local parts = 0
	for _, d in ipairs(res:GetDescendants()) do
		if d:IsA("BasePart") then parts += 1 end
	end
	local _, fsz = res:GetBoundingBox()
	return { model = res.Name, assetId = assetId, parts = parts, size = { r1(fsz.X), r1(fsz.Y), r1(fsz.Z) } }
end

-- runtime open/close controller embedded in a split chest: a ProximityPrompt on the base
-- swings the Lid up about its back-bottom hinge edge (Play mode only — scripts don't run in Edit).
local CHEST_LID_SOURCE = [==[
local chest = script.Parent
local lid = chest:FindFirstChild("Lid")
local base = chest:FindFirstChild("Base")
if not (lid and base) then return end
local TweenService = game:GetService("TweenService")
local prompt = Instance.new("ProximityPrompt")
prompt.ActionText = "Open"; prompt.ObjectText = "Chest"; prompt.HoldDuration = 0
prompt.MaxActivationDistance = 14; prompt.RequiresLineOfSight = false; prompt.Parent = base
local closedCF = lid.CFrame
local sz = lid.Size
-- hinge edge: back-bottom; axis = the wider horizontal axis (runs along the back edge)
local hingePos, hingeRot
if sz.X >= sz.Z then
	hingePos = lid.Position + Vector3.new(0, -sz.Y / 2, -sz.Z / 2) -- back = -Z
	hingeRot = CFrame.new(hingePos) -- rotate about world X
else
	hingePos = lid.Position + Vector3.new(-sz.X / 2, -sz.Y / 2, 0) -- back = -X
	hingeRot = CFrame.new(hingePos) * CFrame.Angles(0, math.rad(90), 0) -- rotate about world Z->local X
end
local rel = hingeRot:Inverse() * closedCF
local openCF = hingeRot * CFrame.Angles(math.rad(-105), 0, 0) * rel
local isOpen = false
prompt.Triggered:Connect(function()
	isOpen = not isOpen
	prompt.ActionText = isOpen and "Close" or "Open"
	TweenService:Create(lid, TweenInfo.new(0.6, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), { CFrame = isOpen and openCF or closedCF }):Play()
end)
]==]

-- insert a SPLIT generated asset (base + lid) as one openable chest. Loads both halves (which
-- share the source FBX coordinate frame), re-stacks the lid flush on the base, scales the whole
-- thing to a target size, and embeds the open/close controller. Called by rbx_gen_mesh split=true.
function handlers.insertChest(args)
	local IS = game:GetService("InsertService")
	local function loadMesh(id)
		local asset = IS:LoadAsset(tonumber(id))
		local mp
		for _, d in ipairs(asset:GetDescendants()) do
			if d:IsA("MeshPart") or d:IsA("BasePart") then mp = d; break end
		end
		return asset, mp
	end
	local baseAsset, baseMP = loadMesh(args.baseAssetId)
	local lidAsset, lidMP = loadMesh(args.lidAssetId)
	if not (baseMP and lidMP) then
		error("insertChest: a half is missing its mesh")
	end
	local chest = Instance.new("Model")
	chest.Name = args.name or "GenChest"
	chest.Parent = workspace
	baseMP.Name = "Base"; baseMP.Anchored = true; baseMP.Parent = chest
	lidMP.Name = "Lid"; lidMP.Anchored = true; lidMP.Parent = chest
	pcall(function() baseAsset:Destroy() end)
	pcall(function() lidAsset:Destroy() end)
	-- re-stack: lid bottom flush on base top, centered on the base footprint (robust to any drift)
	local bc, bs = baseMP.Position, baseMP.Size
	local _, ls = lidMP.Position, lidMP.Size
	lidMP.CFrame = CFrame.new(bc.X, bc.Y + bs.Y / 2 + ls.Y / 2, bc.Z)
	-- scale whole chest to target largest dimension
	local target = tonumber(args.size) or 4
	local _, csz = chest:GetBoundingBox()
	local maxd = math.max(csz.X, csz.Y, csz.Z)
	if maxd > 0 and target > 0 then
		pcall(function() chest:ScaleTo(target / maxd) end)
	end
	chest.PrimaryPart = baseMP
	local p = args.place
	if type(p) == "table" and #p == 3 then
		chest:PivotTo(CFrame.new(tonumber(p[1]) or 0, tonumber(p[2]) or 0, tonumber(p[3]) or 0))
	end
	local s = Instance.new("Script")
	s.Name = "ChestController"
	s.Source = CHEST_LID_SOURCE
	s.Parent = chest
	local _, fsz = chest:GetBoundingBox()
	return { model = chest.Name, base = args.baseAssetId, lid = args.lidAssetId, size = { r1(fsz.X), r1(fsz.Y), r1(fsz.Z) } }
end

-- Undo/redo Studio waypoints (each BuildKit mutation is one recorded step).
function handlers.undo(args)
	local steps = math.max(1, math.floor(tonumber(args.steps) or 1))
	local redo = args.redo == true
	local done = 0
	for _ = 1, steps do
		local ok = pcall(function()
			if redo then
				if not ChangeHistoryService:GetCanRedo() then error("nothing to redo") end
				ChangeHistoryService:Redo()
			else
				if not ChangeHistoryService:GetCanUndo() then error("nothing to undo") end
				ChangeHistoryService:Undo()
			end
		end)
		if not ok then break end
		done += 1
	end
	return { action = redo and "redo" or "undo", steps = done }
end

function handlers.cutaway(args)
	local root = findInst(args.target)
	if not root then
		error("target not found: " .. tostring(args.target))
	end
	local center, size = getBBox(args.target)
	local y
	if args.mode == "y" then
		-- Hide above an explicit world height (rbx_floor_plan / rbx_capture cutawayY).
		if not args.y then
			error("cutaway mode='y' requires y (world height)")
		end
		y = args.y
	elseif args.mode == "roof" then
		-- Hide the model's top slice so the interior is readable — down to ~15% below the
		-- bbox top, i.e. "cut the roof off".
		y = (center.Y + size.Y / 2) - size.Y * 0.15
	else
		-- Legacy callers (no mode): fall back to the old default (hide top 15%).
		y = (center.Y + size.Y / 2) - size.Y * 0.15
	end
	cutSeq += 1
	local token = "cut" .. cutSeq
	-- Register the token BEFORE mutating so a throw partway through the hide loop can never
	-- strand parts with no restorable token. Hidden parts that fail (locked) are simply
	-- skipped, so the recorded list always matches what actually changed.
	cutStore[token] = {}
	local hidden = cutStore[token]
	for _, d in ipairs(root:GetDescendants()) do
		if d:IsA("BasePart") and not d:IsA("Terrain") and d.Position.Y > y then
			local orig = d.Transparency
			if hidePart(d) then
				table.insert(hidden, { inst = d, transparency = orig })
			end
		end
	end
	return { token = token, hiddenCount = #hidden, y = y }
end

-- Un-hide a cutaway/isolate token: restore each part's saved Transparency.
-- Reports a miss for an unknown token instead of silently no-oping, so a stale
-- token (server/plugin state divergence) surfaces as a real error.
function handlers.restore(args)
	local hidden = cutStore[args.token]
	if not hidden then
		return { restored = false, reason = "unknown or already-restored token: " .. tostring(args.token) }
	end
	for _, e in ipairs(hidden) do
		if e.inst and e.inst.Parent then
			pcall(function()
				e.inst.Transparency = e.transparency
				e.inst:SetAttribute(ATTR.hidden, nil)
			end)
		end
	end
	cutStore[args.token] = nil
	return { restored = true }
end

-- Sweep-restore EVERY outstanding BuildKit hide/recolor, with no token needed.
--
-- The in-memory cutStore is the fast path, but it dies with the plugin session, so a
-- token stranded by a failed tool call (or a Studio restart) used to be unrecoverable —
-- the parts stayed invisible, and saving the place baked that into the .rbxl. Each
-- mutation now also writes its original value to an attribute on the part, so this can
-- rebuild the undo from the DataModel alone. Runs on plugin load and is exposed as a
-- command, so "everything went invisible" is always one call away from fixed.
function handlers.restore_all()
	local shown, recolored, skipped = 0, 0, 0
	for _, d in ipairs(workspace:GetDescendants()) do
		if d:IsA("BasePart") then
			local t = d:GetAttribute(ATTR.hidden)
			if type(t) == "number" then
				if d.Locked then
					-- Can't restore a locked part's Transparency; leave the stash so a later
					-- unlock + rbx_restore can still fix it. Don't count it as shown.
					skipped += 1
				else
					pcall(function()
						d.Transparency = t
						d:SetAttribute(ATTR.hidden, nil)
					end)
					shown += 1
				end
			end
			local c = d:GetAttribute(ATTR.contrastColor)
			local m = d:GetAttribute(ATTR.contrastMat)
			if typeof(c) == "Color3" then
				if d.Locked then
					skipped += 1
				else
					pcall(function()
						d.Color = c
						-- Enum.Material[bad] THROWS rather than returning nil, so guard the
						-- lookup separately — an unrecognized saved name must not abort the
						-- color restore or leave the attributes behind.
						if type(m) == "string" then
							local okMat, mat = pcall(function()
								return Enum.Material[m]
							end)
							if okMat and mat then
								d.Material = mat
							end
						end
						d:SetAttribute(ATTR.contrastColor, nil)
						d:SetAttribute(ATTR.contrastMat, nil)
					end)
					recolored += 1
				end
			end
		end
	end
	-- Drop the in-memory tokens too; the DataModel is now the source of truth.
	table.clear(cutStore)
	return { restored = true, shown = shown, recolored = recolored, skipped = skipped }
end

function handlers.inspect(args)
	local inst = findInst(args.target)
	if not inst then
		error("target not found: " .. tostring(args.target))
	end
	local center, size = getBBox(args.target)
	local parts = 0
	for _, d in ipairs(inst:GetDescendants()) do
		if d:IsA("BasePart") then
			parts += 1
		end
	end
	if inst:IsA("BasePart") then
		parts += 1
	end
	local kids = {}
	for _, k in ipairs(inst:GetChildren()) do
		table.insert(kids, k.Name .. " (" .. k.ClassName .. ")")
	end
	return {
		name = inst.Name,
		class = inst.ClassName,
		center = { center.X, center.Y, center.Z },
		size = { size.X, size.Y, size.Z },
		parts = parts,
		children = kids,
	}
end

-- Text "eyes": compact recursive readback so most edits need no screenshot.
function handlers.describe(args)
	local inst = findInst(args.target)
	if not inst then
		error("target not found: " .. tostring(args.target))
	end
	local depth = math.clamp(math.floor(tonumber(args.depth) or 1), 0, 4)
	local result = describeInst(inst, depth)
	result.path = inst:GetFullName()
	result.isBasePart = inst:IsA("BasePart")
	result.isModel = inst:IsA("Model")
	result.hasGeometry = #partsOf(inst) > 0
	return result
end

-- Flat full-fidelity part dump (pos+rotation+shape+color) for the three.js mirror
-- viewer — feeds a free-camera local render instead of a Studio screenshot.
function handlers.scene_dump(args)
	local inst = findInst(args.target)
	if not inst then
		error("target not found: " .. tostring(args.target))
	end
	return sceneDump(inst, 800, nil, args.precise == true)
end

-- Phase 4 map/edit helpers. These stay in the handler module so the Node side can
-- send already-validated data without adding another plugin module/edge.
local function p4Number(value, label, low, high)
	if type(value) ~= "number" or value ~= value or value == math.huge or value == -math.huge then
		error(label .. " must be a number")
	end
	if low and value < low then error(label .. " must be >= " .. tostring(low)) end
	if high and value > high then error(label .. " must be <= " .. tostring(high)) end
	return value
end

local function p4Vec(value, label)
	if type(value) ~= "table" or #value ~= 3 then error(label .. " must be [x,y,z]") end
	return Vector3.new(
		p4Number(value[1], label .. "[1]"),
		p4Number(value[2], label .. "[2]"),
		p4Number(value[3], label .. "[3]")
	)
end

local function p4Array(value)
	return { r1(value.X), r1(value.Y), r1(value.Z) }
end

p4Region = function(value, label)
	if value == nil then return nil end
	if type(value) ~= "table" then error(label .. " must be {min,max}, {center,size}, or {center,radius}") end
	if value.min ~= nil or value.max ~= nil then
		if value.min == nil or value.max == nil then error(label .. " needs both min and max") end
		local minV, maxV = p4Vec(value.min, label .. ".min"), p4Vec(value.max, label .. ".max")
		if minV.X > maxV.X or minV.Y > maxV.Y or minV.Z > maxV.Z then error(label .. ".min must not exceed max") end
		return { kind = "box", min = minV, max = maxV }
	elseif value.center ~= nil and value.size ~= nil then
		local center, size = p4Vec(value.center, label .. ".center"), p4Vec(value.size, label .. ".size")
		if size.X <= 0 or size.Y <= 0 or size.Z <= 0 then error(label .. ".size must be positive") end
		return { kind = "box", min = center - size / 2, max = center + size / 2 }
	elseif value.center ~= nil and value.radius ~= nil then
		local center = p4Vec(value.center, label .. ".center")
		local radius = p4Number(value.radius, label .. ".radius", 0.001, 100000)
		return { kind = "sphere", center = center, radius = radius }
	end
	error(label .. " needs min/max, center/size, or center/radius")
end

p4InRegion = function(part, region)
	if not region then return true end
	local center, half = worldAABB(part)
	if region.kind == "sphere" then
		return (center - region.center).Magnitude <= region.radius + half.Magnitude
	end
	local lo, hi = center - half, center + half
	return hi.X >= region.min.X and lo.X <= region.max.X
		and hi.Y >= region.min.Y and lo.Y <= region.max.Y
		and hi.Z >= region.min.Z and lo.Z <= region.max.Z
end

-- Read-only scoped map. sceneDump owns the 800-part serialization cap; this
-- wrapper counts the complete scope and marks any omitted entries explicitly.
function handlers.map(args)
	args = args or {}
	local root = findInst(args.target or "workspace")
	if not root then error("map target not found: " .. tostring(args.target)) end
	local cap = 800
	if args.maxParts ~= nil then
		cap = p4Number(args.maxParts, "map maxParts", 1, 800)
		if math.floor(cap) ~= cap then error("map maxParts must be an integer") end
	end
	local lod = args.lod or "parts"
	if lod ~= "parts" and lod ~= "bbox" then error("map lod must be 'parts' or 'bbox'") end
	local region = p4Region(args.region, "map region")
	local dump = sceneDump(root, cap, region and function(part)
		return p4InRegion(part, region)
	end or nil)
	local total = dump.totalParts
	local shown = lod == "parts" and dump.parts or {}
	local center, size = bboxOf(root)
	local result = {
		target = root:GetFullName(),
		lod = lod,
		maxParts = cap,
		totalParts = total,
		dumped = #shown,
		truncated = dump.truncated,
		coverage = dump.coverage,
		parts = shown,
		bbox = { center = p4Array(center), size = p4Array(size) },
	}
	if lod == "bbox" then result.partsOmitted = true end
	if not region and lod == "parts" then result.tree = dump.tree end
	if region then result.region = args.region end
	return result
end

-- rbx_view can frame the existing Studio camera or return frame coordinates for
-- the official capture path. Luau does not claim to produce a screenshot.
function handlers.view(args)
	args = args or {}
	local target = args.target or "workspace"
	local view = tostring(args.view or "iso")
	if not VIEW_DIRS[view] then error("view must be front, back, left, right, iso, or top") end
	local zoom = args.zoom
	if zoom ~= nil then zoom = p4Number(zoom, "view zoom", 0.01, 100) end
	local mode = args.mode or "coords"
	if mode ~= "coords" and mode ~= "frame" then error("view mode must be 'coords' or 'frame'") end
	local angled = args.azimuth ~= nil or args.elevation ~= nil
	local frame
	if angled then
		local azimuth = p4Number(args.azimuth or 0, "view azimuth", -3600, 3600)
		local elevation = p4Number(args.elevation or 20, "view elevation", -89, 89)
		local frameArgs = { target = target, azimuth = azimuth, elevation = elevation, zoom = zoom }
		frame = (mode == "frame") and handlers.frame_dir(frameArgs) or handlers.frame_dir_coords(frameArgs)
	else
		local frameArgs = { target = target, view = view, zoom = zoom }
		frame = (mode == "frame") and handlers.frame(frameArgs) or handlers.frame_coords(frameArgs)
	end
	local warnings = {}
	if args.capture == true then table.insert(warnings, "capture is not available inside the Luau handler; use the official capture path") end
	if args.angles ~= nil then
		local angles = p4Number(args.angles, "view angles", 1, 32)
		if math.floor(angles) ~= angles then error("view angles must be an integer") end
		if angles > 1 then table.insert(warnings, "turntable capture is not available inside the Luau handler") end
	end
	for _, key in ipairs({ "isolate", "hide", "cutaway", "annotate", "contrast", "plan" }) do
		if args[key] ~= nil then table.insert(warnings, "view option '" .. key .. "' is not composed by this handler") end
	end
	local out = {
		status = (mode == "frame") and "framed" or "coordinates-only",
		capture = false,
		target = target,
		view = view,
		camera_position = frame.camera_position or frame.pos,
		look_at_position = frame.look_at_position or frame.look,
		field_of_view = frame.field_of_view or camera().FieldOfView,
		size = frame.size,
	}
	if #warnings > 0 then out.warnings = warnings end
	return out
end

local function p4AddTarget(out, inst, label)
	if not (inst:IsA("Model") or inst:IsA("BasePart")) then error(label .. " targets must be Models or BaseParts") end
	for i = #out, 1, -1 do
		if out[i] == inst or inst:IsDescendantOf(out[i]) then return end
		if out[i]:IsDescendantOf(inst) then table.remove(out, i) end
	end
	table.insert(out, inst)
end

-- Explicit targets or a deliberately scoped selector. An unfiltered workspace
-- selector is rejected so a typo cannot move an entire place.
local function p4BulkTargets(args, label)
	if type(args) ~= "table" then error(label .. " args must be a table") end
	if args.target ~= nil and (args.targets ~= nil or args.select ~= nil) then error(label .. " accepts target, targets, or select, not more than one") end
	if args.targets ~= nil and args.select ~= nil then error(label .. " accepts targets or select, not both") end
	local out = {}
	local selection
	if args.target ~= nil then
		if type(args.target) ~= "string" then error(label .. " target must be a path/name") end
		local inst = findInst(args.target)
		if not inst then error(label .. " target not found: " .. tostring(args.target)) end
		if inst == workspace then error(label .. " cannot target workspace directly") end
		p4AddTarget(out, inst, label)
	elseif args.targets ~= nil then
		if type(args.targets) ~= "table" or #args.targets == 0 then error(label .. " targets must be a non-empty array") end
		for _, name in ipairs(args.targets) do
			if type(name) ~= "string" then error(label .. " target names must be strings") end
			local inst = findInst(name)
			if not inst then error(label .. " target not found: " .. name) end
			if inst == workspace then error(label .. " cannot target workspace directly") end
			p4AddTarget(out, inst, label)
		end
	elseif args.select ~= nil then
		local sel = args.select
		selection = sel
		if type(sel) ~= "table" then error(label .. " select must be a table") end
		local root = findInst(sel.root or "workspace")
		if not root then error(label .. " select root not found: " .. tostring(sel.root)) end
		local hasFilter = sel.name ~= nil or sel.class ~= nil or sel.tag ~= nil or sel.attr ~= nil
		if root == workspace and not hasFilter then error(label .. " select needs a filter when root is workspace") end
		local nameQ
		if sel.name ~= nil then
			if type(sel.name) ~= "string" or sel.name == "" then error(label .. " select.name must be non-empty") end
			nameQ = string.lower(sel.name)
		end
		local class = sel.class
		if class ~= nil then
			if type(class) ~= "string" or class == "" then error(label .. " select.class must be a class name") end
			local validClass = pcall(function() return game:IsA(class) end)
			if not validClass then error(label .. " select.class is invalid: " .. class) end
		end
		if sel.tag ~= nil and (type(sel.tag) ~= "string" or sel.tag == "") then error(label .. " select.tag must be non-empty") end
		local attrKey, attrValue
		if sel.attr ~= nil then
			if type(sel.attr) ~= "table" or type(sel.attr.key) ~= "string" or sel.attr.key == "" then error(label .. " select.attr needs key") end
			attrKey, attrValue = sel.attr.key, sel.attr.value
		end
		local candidates = {}
		if sel.tag then
			for _, inst in ipairs(game:GetService("CollectionService"):GetTagged(sel.tag)) do table.insert(candidates, inst) end
		else
			if root:IsA("Model") or root:IsA("BasePart") then table.insert(candidates, root) end
			for _, inst in ipairs(root:GetDescendants()) do table.insert(candidates, inst) end
		end
		for _, inst in ipairs(candidates) do
			local ok = (root == workspace or inst == root or inst:IsDescendantOf(root))
			if ok and nameQ then
				local name = string.lower(inst.Name)
				ok = sel.exact == true and name == nameQ or sel.exact ~= true and string.find(name, nameQ, 1, true) ~= nil
			end
			if ok and class then local okClass, isClass = pcall(function() return inst:IsA(class) end); ok = okClass and isClass end
			if ok and attrKey then local value = inst:GetAttribute(attrKey); ok = attrValue == nil and value ~= nil or attrValue ~= nil and (value == attrValue or tostring(value) == tostring(attrValue)) end
			if ok then p4AddTarget(out, inst, label) end
		end
	else
		error(label .. " needs target, targets, or select")
	end
	if #out == 0 then error(label .. " matched no Model/BasePart targets") end
	local limit = selection and selection.limit or args.limit or 500
	limit = p4Number(limit, label .. " limit", 1, 500)
	if math.floor(limit) ~= limit then error(label .. " limit must be an integer") end
	if #out > limit then error(label .. " matched " .. tostring(#out) .. " targets over limit " .. tostring(limit)) end
	table.sort(out, function(a, b) return a:GetFullName() < b:GetFullName() end)
	return out
end

local function p4Pivot(inst)
	if inst:IsA("Model") then return inst:GetPivot() end
	return inst.CFrame
end

local function p4Place(inst, cf)
	if inst:IsA("Model") then inst:PivotTo(cf) else inst.CFrame = cf end
end

function handlers.replace(args)
	args = args or {}
	local templateName = args.template or args.with
	if type(templateName) ~= "string" or templateName == "" then error("replace needs template") end
	local template = findInst(templateName)
	if not template or not (template:IsA("Model") or template:IsA("BasePart")) or #partsOf(template) == 0 then error("replace template must be a Model or BasePart with geometry") end
	local targets = p4BulkTargets(args, "replace")
	for _, inst in ipairs(targets) do
		if inst == template or inst:IsDescendantOf(template) or template:IsDescendantOf(inst) then error("replace template cannot overlap a replacement target") end
	end
	return recorded("BuildKit replace", function()
		local items = {}
		for _, old in ipairs(targets) do
			local clone = old and template:Clone()
			if not clone then error("replace could not clone template") end
			local cf, parent, oldPath = p4Pivot(old), old.Parent, old:GetFullName()
			clone.Name = old.Name
			clone.Parent = parent
			p4Place(clone, cf)
			old.Parent = nil -- keep the old instance recoverable by Studio undo
			table.insert(items, { old = oldPath, new = clone:GetFullName() })
		end
		return { verb = "replace", count = #items, items = items }
	end)
end

local function p4Next(state)
	state = (state * 1103515245 + 12345) % 2147483648
	return state, state / 2147483648
end

local function p4Sample(region, state)
	if region.kind == "sphere" then
		for _ = 1, 12 do
			local x, y, z
			state, x = p4Next(state); state, y = p4Next(state); state, z = p4Next(state)
			x, y, z = x * 2 - 1, y * 2 - 1, z * 2 - 1
			if x * x + y * y + z * z <= 1 then return region.center + Vector3.new(x, y, z) * region.radius, state end
		end
		return region.center, state
	end
	local x, y, z
	state, x = p4Next(state); state, y = p4Next(state); state, z = p4Next(state)
	return Vector3.new(
		region.min.X + (region.max.X - region.min.X) * x,
		region.min.Y + (region.max.Y - region.min.Y) * y,
		region.min.Z + (region.max.Z - region.min.Z) * z
	), state
end

local PLACEMENT_CAP = 500
local function p4Count(value, label, default)
	if value == nil then value = default end
	value = p4Number(value, label, 1)
	if math.floor(value) ~= value then error(label .. " must be an integer") end
	return value
end

local function p4Cap(value, label)
	if value > PLACEMENT_CAP then
		error(label .. " computed " .. tostring(value) .. " instances; maximum is " .. tostring(PLACEMENT_CAP))
	end
	return value
end

local function p4Seed(value, label, required)
	if value == nil then
		if required then error(label .. " is required for deterministic placement") end
		return 1
	end
	value = p4Number(value, label)
	if math.floor(value) ~= value then error(label .. " must be an integer") end
	value = value % 2147483647
	if value == 0 then value = 1 end
	return value
end

local function p4Jitter(value, label)
	if value == nil then return Vector3.new(0, 0, 0) end
	local jitter
	if type(value) == "number" then
		local j = p4Number(value, label, 0, 100000)
		jitter = Vector3.new(j, j, j)
	else
		jitter = p4Vec(value, label)
	end
	if jitter.X < 0 or jitter.Y < 0 or jitter.Z < 0 then error(label .. " must be non-negative") end
	return jitter
end

local function p4Snap(value, step)
	if not step then return value end
	local function round(number)
		return number < 0 and math.ceil(number - 0.5) or math.floor(number + 0.5)
	end
	return Vector3.new(
		round(value.X / step) * step,
		round(value.Y / step) * step,
		round(value.Z / step) * step
	)
end

local function p4Palette()
	local palette = workspace:FindFirstChild("Palette")
	if not palette or not palette:IsA("Folder") then error("place requires Workspace.Palette Folder") end
	return palette
end

local function p4PaletteNames(palette)
	local names = {}
	for _, child in ipairs(palette:GetChildren()) do names[#names + 1] = child.Name end
	table.sort(names)
	return names
end

local function p4PalettePrefab(palette, name)
	if type(name) ~= "string" or name == "" then error("place needs prefab") end
	local prefab = palette:FindFirstChild(name)
	if not prefab then
		local names = p4PaletteNames(palette)
		error("unknown prefab '" .. name .. "'; Palette contains: " .. (#names > 0 and table.concat(names, ", ") or "<none>"))
	end
	if not (prefab:IsA("Model") or prefab:IsA("BasePart")) or #partsOf(prefab) == 0 then
		error("prefab '" .. name .. "' must be a Model or BasePart with geometry")
	end
	return prefab
end

local function p4PaletteManifest(palette)
	local manifest = {}
	for _, child in ipairs(palette:GetChildren()) do
		if (child:IsA("Model") or child:IsA("BasePart")) and #partsOf(child) > 0 then
			local center, size = bboxOf(child)
			local pivot = p4Pivot(child)
			manifest[#manifest + 1] = {
				name = child.Name,
				size = p4Array(size),
				pivotY = r1((center.Y - size.Y / 2) - pivot.Position.Y),
			}
		end
	end
	table.sort(manifest, function(a, b) return a.name < b.name end)
	return manifest
end

local function p4GroundTarget(value, label)
	if value == nil then return nil end
	if type(value) ~= "string" or value == "" then error(label .. " must be an instance path or name") end
	local target = findInst(value)
	if not target then error(label .. " not found: " .. value) end
	if not target:IsA("BasePart") and not target:IsA("Model") then
		error(label .. " must be a BasePart or Model")
	end
	if #partsOf(target) == 0 then error(label .. " must contain geometry") end
	return target
end

local function p4PlacementSpec(args)
	if args.verb ~= nil then
		local verb = string.lower(tostring(args.verb))
		if verb ~= "place" and verb ~= "line" and verb ~= "grid" and verb ~= "ring" and verb ~= "scatter" then
			error("place unknown verb: " .. tostring(args.verb))
		end
		local spec = args[verb]
		return verb, type(spec) == "table" and spec or args
	end
	local found, verb = 0, nil
	for _, key in ipairs({ "place", "at", "line", "grid", "ring", "scatter" }) do
		if args[key] ~= nil then
			found += 1
			verb = key == "at" and "place" or key
		end
	end
	if found == 0 then error("place needs one shape: at, line, grid, ring, or scatter") end
	if found > 1 then error("place accepts one shape only") end
	local spec = args[verb]
	if verb == "place" and spec == nil then spec = args end
	if type(spec) ~= "table" then error("place " .. verb .. " must be a table") end
	return verb, spec
end

local function p4FlatTangent(tangent)
	local flat = Vector3.new(tangent.X, 0, tangent.Z)
	if flat.Magnitude < 0.0001 then return Vector3.new(0, 0, -1) end
	return flat
end

local function p4PlacementRun(args, source, legacy, placementRoot, resolvedGroundTarget)
	local verb, spec
	if legacy then
		verb, spec = "scatter", args
	else
		verb, spec = p4PlacementSpec(args)
	end
	if args.abut ~= nil and type(args.abut) ~= "boolean" then error("place abut must be a boolean") end
	local abut = args.abut == true
	if abut and verb ~= "line" and verb ~= "grid" then error("place abut only supports line or grid") end
	local _, prefabSize = bboxOf(source)
	local seedRequired = not legacy and (verb == "scatter" or args.jitter ~= nil)
	local seed = p4Seed(args.seed, legacy and "scatter seed" or "place seed", seedRequired)
	local state = seed
	local jitter = p4Jitter(args.jitter, legacy and "scatter jitter" or "place jitter")
	local snap
	if args.snap ~= nil then snap = p4Number(args.snap, "place snap", 0.001, 100000) end
	if args.ground ~= nil and type(args.ground) ~= "boolean" then error("place ground must be a boolean") end
	local doGround = args.ground == true
	local groundTarget = resolvedGroundTarget
	if doGround and not groundTarget and args.groundTarget ~= nil then
		groundTarget = p4GroundTarget(args.groundTarget, "place groundTarget")
	end
	local rotate = string.lower(tostring(args.rotate or "none"))
	if rotate ~= "none" and rotate ~= "random" and rotate ~= "align" then error("place rotate must be none, random, or align") end
	if rotate == "align" and verb ~= "line" and verb ~= "ring" then error("place rotate=align needs line or ring") end
	local rotationValue = spec.rotation or args.rotation
	local extraRotation = CFrame.new()
	if rotationValue ~= nil then
		local rotation = p4Vec(rotationValue, "place rotation")
		extraRotation = CFrame.Angles(math.rad(rotation.X), math.rad(rotation.Y), math.rad(rotation.Z))
	end

	local plans = {}
	local function addPlan(pos, tangent, row, col)
		plans[#plans + 1] = { pos = pos, tangent = tangent, row = row, col = col }
	end
	if verb == "place" then
		addPlan(p4Vec(spec.at, "place at"), nil)
	elseif verb == "line" then
		local from = p4Vec(spec.from, "place line from")
		local to = p4Vec(spec.to, "place line to")
		local via = spec.via ~= nil and p4Vec(spec.via, "place line via") or nil
		if abut and via then error("place line abut does not support via") end
		if spec.spacing ~= nil and spec.count ~= nil then error("place line needs spacing or count, not both") end
		if abut and (spec.spacing ~= nil or spec.count ~= nil) then error("place line abut cannot include spacing or count") end
		if not abut and spec.spacing == nil and spec.count == nil then error("place line needs spacing or count") end
		local count, abutSpacing, distance = nil, nil, (to - from).Magnitude
		if abut then
			if distance < 0.0001 then error("place line abut needs distinct endpoints") end
			local axis = (to - from).Unit
			abutSpacing = math.abs(axis.X) * prefabSize.X + math.abs(axis.Y) * prefabSize.Y + math.abs(axis.Z) * prefabSize.Z
			if abutSpacing < 0.001 then error("place line prefab has no usable extent") end
			count = math.ceil(distance / abutSpacing) + 1
			p4Cap(count, "place line")
		elseif spec.spacing ~= nil then
			local spacing = p4Number(spec.spacing, "place line spacing", 0.001, 100000)
			count = math.ceil(distance / spacing) + 1
			p4Cap(count, "place line")
		else
			count = p4Count(spec.count, "place line count")
			p4Cap(count, "place line")
		end
		local function pointAt(t)
			if via then
				local u = 1 - t
				return from * (u * u) + via * (2 * u * t) + to * (t * t)
			end
			return from + (to - from) * t
		end
		local function tangentAt(t)
			local tangent = via and ((via - from) * (2 * (1 - t)) + (to - via) * (2 * t)) or (to - from)
			return tangent.Magnitude > 0.0001 and tangent or (to - from)
		end
		for i = 1, count do
			local t = abut and math.min((i - 1) * abutSpacing / distance, 1) or (count == 1 and 0 or (i - 1) / (count - 1))
			addPlan(pointAt(t), tangentAt(t), 1, i)
		end
	elseif verb == "grid" then
		local origin = p4Vec(spec.origin, "place grid origin")
		local rows = p4Count(spec.rows, "place grid rows")
		local cols = p4Count(spec.cols, "place grid cols")
		p4Cap(rows * cols, "place grid")
		if abut and (spec.spacingX ~= nil or spec.spacingZ ~= nil) then error("place grid abut cannot include spacingX or spacingZ") end
		if not abut and (spec.spacingX == nil or spec.spacingZ == nil) then error("place grid needs spacingX and spacingZ") end
		local spacingX = abut and prefabSize.X or p4Number(spec.spacingX, "place grid spacingX", 0.001, 100000)
		local spacingZ = abut and prefabSize.Z or p4Number(spec.spacingZ, "place grid spacingZ", 0.001, 100000)
		for row = 0, rows - 1 do
			for col = 0, cols - 1 do
				addPlan(origin + Vector3.new(col * spacingX, 0, row * spacingZ), nil, row + 1, col + 1)
			end
		end
	elseif verb == "ring" then
		local center = p4Vec(spec.center, "place ring center")
		local radius = p4Number(spec.radius, "place ring radius", 0.001, 100000)
		local count = p4Count(spec.count, "place ring count")
		p4Cap(count, "place ring")
		local startAngle = p4Number(spec.startAngle or 0, "place ring startAngle")
		for i = 1, count do
			local angle = math.rad(startAngle + (i - 1) * 360 / count)
			addPlan(
				center + Vector3.new(math.cos(angle) * radius, 0, math.sin(angle) * radius),
				Vector3.new(-math.sin(angle), 0, math.cos(angle))
			)
		end
	else
		local region = p4Region(spec.region, "place scatter region")
		if not region then error("place scatter needs region") end
		local count = p4Count(spec.count, "place scatter count", 10)
		p4Cap(count, "place scatter")
		for _ = 1, count do
			local pos
			pos, state = p4Sample(region, state)
			addPlan(pos, nil)
		end
	end
	p4Cap(#plans, "place")

	local parent, groupName
	if legacy then
		parent = args.parent and findInst(args.parent) or source.Parent
		if not parent or not (parent == workspace or parent:IsDescendantOf(workspace)) then error("scatter parent must be inside Workspace") end
	else
		groupName = args.name
		if groupName == nil then groupName = source.Name .. "s" end
		if type(groupName) ~= "string" or groupName == "" then error("place name must be a non-empty string") end
	end
	local maxDistance = doGround and p4Number(args.maxDistance or 1000, "place maxDistance", 0.1, 100000) or 0
	local offset = doGround and p4Number(args.offset or 0, "place offset", -100000, 100000) or 0
	local baseRotation = p4Pivot(source).Rotation
	local recordingName = legacy and "BuildKit scatter" or "BuildKit place " .. groupName
	return recorded(recordingName, function()
		local group
		if not legacy then
			local placements = placementRoot or workspace:FindFirstChild("Placements")
			if placements and not placements:IsA("Folder") then error("placement root must be a Folder") end
			if not placements then
				placements = Instance.new("Folder")
				placements.Name = "Placements"
				placements.Parent = workspace
			end
			group = Instance.new("Model")
			group.Name = groupName
			group.Parent = placements
			parent = group
		end
		local items, names, placedByPlan, skipped = {}, {}, {}, 0
		for i, plan in ipairs(plans) do
			local pos = plan.pos
			if verb == "scatter" or args.jitter ~= nil or legacy then
				local jx, jy, jz
				state, jx = p4Next(state); state, jy = p4Next(state); state, jz = p4Next(state)
				pos += Vector3.new((jx * 2 - 1) * jitter.X, (jy * 2 - 1) * jitter.Y, (jz * 2 - 1) * jitter.Z)
			end
			pos = p4Snap(pos, snap)
			local orientation = baseRotation
			if rotate == "align" then
				orientation = CFrame.lookAt(Vector3.new(0, 0, 0), p4FlatTangent(plan.tangent)).Rotation * orientation
			elseif rotate == "random" then
				local yaw
				state, yaw = p4Next(state)
				orientation = CFrame.Angles(0, yaw * math.pi * 2, 0) * orientation
			end
			orientation = orientation * extraRotation
			local clone = source:Clone()
			if not clone then error((legacy and "scatter" or "place") .. " could not clone prefab") end
			if not legacy then clone.Name = source.Name .. "_" .. string.format("%03d", i) end
			clone.Parent = parent
			p4Place(clone, CFrame.new(pos) * orientation)
			if doGround then
				local params = RaycastParams.new()
				if groundTarget then
					params.FilterType = Enum.RaycastFilterType.Include
					params.FilterDescendantsInstances = { groundTarget }
				else
					params.FilterType = Enum.RaycastFilterType.Exclude
					params.FilterDescendantsInstances = { legacy and clone or group }
				end
				params.IgnoreWater = true
				local center, size = bboxOf(clone)
				local hit = workspace:Raycast(center + Vector3.new(0, size.Y / 2 + 0.05, 0), Vector3.new(0, -maxDistance, 0), params)
				if hit then
					local delta = hit.Position.Y + offset - (center.Y - size.Y / 2)
					if math.abs(delta) > 0.001 then pivotWorld(clone, CFrame.new(0, delta, 0)) end
				else
					skipped += 1
					clone:Destroy()
				end
			end
			if clone.Parent then
				placedByPlan[i] = clone
				if legacy then
					items[#items + 1] = { path = clone:GetFullName(), pos = p4Array(pos) }
				else
					names[#names + 1] = clone.Name
				end
			end
		end
		if legacy then return { verb = "scatter", count = #items, items = items, seed = seed } end
		local center, size
		if #names > 0 then
			center, size = bboxOf(group)
		else
			center, size = Vector3.new(0, 0, 0), Vector3.new(0, 0, 0)
		end
		local sample = {}
		if names[1] then sample[1] = names[1] end
		if #names > 1 then sample[2] = names[#names] end
		local result = {
			verb = verb,
			prefab = source.Name,
			placed = #names,
			skipped = skipped,
			group = (placementRoot and placementRoot.Name or "Placements") .. "/" .. groupName,
			bounds = { center = p4Array(center), size = p4Array(size) },
			sample = sample,
		}
		local gaps = {}
		local function checkGap(a, b)
			if not a or not b then return end
			local ac, aSize = bboxOf(a)
			local bc, bSize = bboxOf(b)
			local dx = math.max(0, math.abs(ac.X - bc.X) - (aSize.X + bSize.X) / 2)
			local dy = math.max(0, math.abs(ac.Y - bc.Y) - (aSize.Y + bSize.Y) / 2)
			local dz = math.max(0, math.abs(ac.Z - bc.Z) - (aSize.Z + bSize.Z) / 2)
			local gap = math.sqrt(dx * dx + dy * dy + dz * dz)
			if gap > 0.1 and #gaps < 25 then gaps[#gaps + 1] = { from = a.Name, to = b.Name, gap = r1(gap) } end
		end
		if verb == "line" then
			for i = 2, #plans do checkGap(placedByPlan[i - 1], placedByPlan[i]) end
		elseif verb == "grid" then
			local cols = p4Count(spec.cols, "place grid cols")
			for i, plan in ipairs(plans) do
				if plan.col > 1 then checkGap(placedByPlan[i - 1], placedByPlan[i]) end
				if plan.row > 1 then checkGap(placedByPlan[i - cols], placedByPlan[i]) end
			end
		end
		result.gaps = gaps
		if abut then result.abut = true end
		if verb == "scatter" or args.jitter ~= nil or rotate == "random" then result.seed = seed end
		if groundTarget then result.groundTarget = groundTarget:GetFullName() end
		if skipped > 0 then result.reason = "no ground hit" end
		return result
	end)
end

function handlers.place(args)
	args = args or {}
	local palette = p4Palette()
	if args.mode == "palette" then return { mode = "palette", manifest = p4PaletteManifest(palette) } end
	return p4PlacementRun(args, p4PalettePrefab(palette, args.prefab), false)
end

-- Declarative map files own only MapPlacements. Each rule is rebuilt under a stable
-- Map_<file>_<id> group, so a second apply replaces the file's result instead of
-- accumulating copies or touching user-owned Workspace.Placements.
-- ponytail: full rebuild per map file keeps ownership and one-step undo simple; add
-- per-rule mutation only when map size makes the rebuild measurable.
function handlers.map_apply(args)
	args = args or {}
	local mapName = args.map
	if type(mapName) ~= "string" or not string.match(mapName, "^[A-Za-z0-9][A-Za-z0-9_.-]*$") then
		error("map_apply needs a safe map file name")
	end
	local rules = args.rules
	if type(rules) ~= "table" then error("map_apply needs rules") end
	if #rules > 256 then error("map_apply is capped at 256 rules") end
	local palette = nil
	if #rules > 0 then palette = p4Palette() end
	local prefix = "Map_" .. mapName .. "_"
	local sources = {}
	local ids = {}
	local hasGround = false
	for _, rule in ipairs(rules) do
		if type(rule) ~= "table" then error("map_apply rule must be a table") end
		local id = rule.id
		if type(id) ~= "string" or not string.match(id, "^[A-Za-z0-9][A-Za-z0-9_.:-]*$") then
			error("map_apply rule id must be safe")
		end
		if ids[id] then error("map_apply duplicate rule id: " .. id) end
		ids[id] = true
		p4PlacementSpec(rule) -- validate the one-verb contract before changing the map
		if rule.ground == true then hasGround = true end
		sources[#sources + 1] = { rule = rule, source = p4PalettePrefab(palette, rule.prefab) }
	end
	local groundTarget = hasGround and p4GroundTarget(args.groundTarget, "map groundTarget") or nil
	return recorded("BuildKit map " .. mapName, function()
		local root = workspace:FindFirstChild("MapPlacements")
		if root and not root:IsA("Folder") then error("Workspace.MapPlacements must be a Folder") end
		if not root then
			root = Instance.new("Folder")
			root.Name = "MapPlacements"
			root.Parent = workspace
		end
		local removed = 0
		for _, child in ipairs(root:GetChildren()) do
			if string.sub(child.Name, 1, #prefix) == prefix then
				child.Parent = nil -- keep removed groups recoverable by Studio undo
				removed += 1
			end
		end
		local placements = {}
		for _, item in ipairs(sources) do
			local placementArgs = {}
			for key, value in pairs(item.rule) do
				if key ~= "id" and key ~= "name" and key ~= "groundTarget" then placementArgs[key] = value end
			end
			placementArgs.name = prefix .. item.rule.id
			placements[#placements + 1] = p4PlacementRun(placementArgs, item.source, false, root, groundTarget)
		end
		local result = { map = mapName, rules = #sources, removed = removed, placements = placements, group = "MapPlacements/" .. prefix }
		if groundTarget then result.groundTarget = groundTarget:GetFullName() end
		return result
	end)
end

function handlers.scatter(args)
	args = args or {}
	local templateName = args.template or args.target
	if type(templateName) ~= "string" or templateName == "" then error("scatter needs template") end
	local template = findInst(templateName)
	if not template or not (template:IsA("Model") or template:IsA("BasePart")) or #partsOf(template) == 0 then error("scatter template must be a Model or BasePart with geometry") end
	return p4PlacementRun(args, template, true)
end

function handlers.distribute(args)
	args = args or {}
	local from = p4Vec(args.from or args.start or args.a, "distribute from")
	local to = p4Vec(args.to or args.finish or args.b, "distribute to")
	local targets = p4BulkTargets(args, "distribute")
	if #targets < 2 then error("distribute needs at least two targets") end
	-- Optional `via` control point turns the straight run into a quadratic Bezier, so a
	-- fence/lamp line can follow a curved path instead of only a straight one.
	local via = args.via ~= nil and p4Vec(args.via, "distribute via") or nil
	return recorded("BuildKit distribute", function()
		local items = {}
		for i, inst in ipairs(targets) do
			local t = (i - 1) / (#targets - 1)
			local desired
			if via then
				local u = 1 - t
				desired = from * (u * u) + via * (2 * u * t) + to * (t * t)
			else
				desired = from + (to - from) * t
			end
			local center = bboxOf(inst)
			pivotWorld(inst, CFrame.new(desired - center))
			table.insert(items, { path = inst:GetFullName(), pos = p4Array(desired) })
		end
		return { verb = "distribute", count = #items, items = items }
	end)
end

function handlers.align(args)
	args = args or {}
	local axis = string.lower(tostring(args.axis or ""))
	if axis ~= "x" and axis ~= "y" and axis ~= "z" then error("align axis must be x, y, or z") end
	local mode = args.mode or "center"
	if mode ~= "center" and mode ~= "min" and mode ~= "max" then error("align mode must be center, min, or max") end
	local value = args.value
	if value == nil then
		if not args.reference then error("align needs value or reference") end
		local reference = findInst(args.reference)
		if not reference then error("align reference not found: " .. tostring(args.reference)) end
		value = bboxOf(reference)
		value = (axis == "x" and value.X) or (axis == "y" and value.Y) or value.Z
	end
	value = p4Number(value, "align value")
	local targets = p4BulkTargets(args, "align")
	return recorded("BuildKit align", function()
		local items = {}
		for _, inst in ipairs(targets) do
			local center, size = bboxOf(inst)
			local current = (axis == "x" and center.X) or (axis == "y" and center.Y) or center.Z
			local half = (axis == "x" and size.X) or (axis == "y" and size.Y) or size.Z
			local desired = mode == "min" and value + half / 2 or mode == "max" and value - half / 2 or value
			local delta = desired - current
			local move = (axis == "x" and Vector3.new(delta, 0, 0)) or (axis == "y" and Vector3.new(0, delta, 0)) or Vector3.new(0, 0, delta)
			pivotWorld(inst, CFrame.new(move))
			table.insert(items, { path = inst:GetFullName(), pos = p4Array(bboxOf(inst)) })
		end
		return { verb = "align", axis = axis, mode = mode, count = #items, items = items }
	end)
end

function handlers.ground(args)
	args = args or {}
	local targets = p4BulkTargets(args, "ground")
	local maxDistance = p4Number(args.maxDistance or 1000, "ground maxDistance", 0.1, 100000)
	local offset = p4Number(args.offset or 0, "ground offset", -100000, 100000)
	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.FilterDescendantsInstances = targets
	params.IgnoreWater = true
	local moves, skipped = {}, {}
	for _, inst in ipairs(targets) do
		local center, size = bboxOf(inst)
		local hit = workspace:Raycast(center + Vector3.new(0, size.Y / 2 + 0.05, 0), Vector3.new(0, -maxDistance, 0), params)
		if hit then
			local delta = hit.Position.Y + offset - (center.Y - size.Y / 2)
			if math.abs(delta) > 0.001 then table.insert(moves, { inst = inst, delta = delta, hit = hit.Position.Y }) end
		else
			table.insert(skipped, inst:GetFullName())
		end
	end
	if #moves == 0 then
		return { verb = "ground", moved = 0, skipped = #skipped, skippedTargets = skipped, warnings = { "no selected target intersected a downward ray" } }
	end
	return recorded("BuildKit ground", function()
		local items = {}
		for _, move in ipairs(moves) do
			pivotWorld(move.inst, CFrame.new(0, move.delta, 0))
			table.insert(items, { path = move.inst:GetFullName(), deltaY = r1(move.delta), groundY = r1(move.hit) })
		end
		local result = { verb = "ground", moved = #items, skipped = #skipped, items = items }
		if #skipped > 0 then result.skippedTargets = skipped; result.warnings = { "some targets had no ground hit and were left unchanged" } end
		return result
	end)
end

-- ---------- terrain ----------------------------------------------------------
-- Roblox Terrain is a voxel system entirely separate from BaseParts. BuildKit had NO
-- terrain surface at all (only skip-guards), so every landscape/water job fell back to
-- raw execute_luau. Terrain voxels are on a 4-stud grid — hence ExpandToGrid(4) and the
-- fixed resolution of 4 that FillRegion/ReplaceMaterial require.
local TERRAIN_MATERIALS = {
	air = Enum.Material.Air, water = Enum.Material.Water, grass = Enum.Material.Grass,
	sand = Enum.Material.Sand, rock = Enum.Material.Rock, slate = Enum.Material.Slate,
	concrete = Enum.Material.Concrete, brick = Enum.Material.Brick, sandstone = Enum.Material.Sandstone,
	mud = Enum.Material.Mud, basalt = Enum.Material.Basalt, ground = Enum.Material.Ground,
	crackedlava = Enum.Material.CrackedLava, asphalt = Enum.Material.Asphalt,
	cobblestone = Enum.Material.Cobblestone, ice = Enum.Material.Ice, leafygrass = Enum.Material.LeafyGrass,
	salt = Enum.Material.Salt, limestone = Enum.Material.Limestone, pavement = Enum.Material.Pavement,
	snow = Enum.Material.Snow, woodplanks = Enum.Material.WoodPlanks,
}

local function terrainMaterial(name, default)
	if name == nil then return default end
	local key = (string.gsub(string.lower(tostring(name)), "[%s_%-]", ""))
	local mat = TERRAIN_MATERIALS[key]
	if not mat then
		local names = {}
		for k in pairs(TERRAIN_MATERIALS) do table.insert(names, k) end
		table.sort(names)
		error("unknown terrain material '" .. tostring(name) .. "' — valid: " .. table.concat(names, ", "))
	end
	return mat
end

local function terrainRegion(args, label)
	local a = p4Vec(args.min, label .. " min")
	local b = p4Vec(args.max, label .. " max")
	local lo = Vector3.new(math.min(a.X, b.X), math.min(a.Y, b.Y), math.min(a.Z, b.Z))
	local hi = Vector3.new(math.max(a.X, b.X), math.max(a.Y, b.Y), math.max(a.Z, b.Z))
	return Region3.new(lo, hi):ExpandToGrid(4)
end

local function terrainCFrame(args, label)
	local center = p4Vec(args.center, label .. " center")
	local rot = args.rotation
	if rot == nil then return CFrame.new(center) end
	local r = p4Vec(rot, label .. " rotation")
	return CFrame.new(center) * CFrame.Angles(math.rad(r.X), math.rad(r.Y), math.rad(r.Z))
end

function handlers.terrain(args)
	args = args or {}
	local terrain = workspace.Terrain
	if not terrain then error("workspace has no Terrain object") end
	local mode = string.lower(tostring(args.mode or "fill"))

	if mode == "clear" then
		return recorded("BuildKit terrain clear", function()
			if args.min ~= nil or args.max ~= nil then
				local region = terrainRegion(args, "terrain clear")
				terrain:FillRegion(region, 4, Enum.Material.Air)
				return { mode = "clear", scope = "region", min = p4Array(region.CFrame.Position - region.Size / 2), max = p4Array(region.CFrame.Position + region.Size / 2) }
			end
			terrain:Clear()
			return { mode = "clear", scope = "all" }
		end)
	end

	if mode == "paint" or mode == "replace" then
		local region = terrainRegion(args, "terrain paint")
		local from = terrainMaterial(args.from, nil)
		local to = terrainMaterial(args.to or args.material, nil)
		if not from or not to then error("terrain paint needs `from` and `to` materials") end
		return recorded("BuildKit terrain paint", function()
			terrain:ReplaceMaterial(region, 4, from, to)
			return { mode = "paint", from = from.Name, to = to.Name }
		end)
	end

	if mode ~= "fill" then error("terrain mode must be fill, clear, or paint") end

	local material = terrainMaterial(args.material, Enum.Material.Grass)
	local shape = string.lower(tostring(args.shape or "block"))
	return recorded("BuildKit terrain fill", function()
		if shape == "ball" then
			local center = p4Vec(args.center, "terrain center")
			local radius = p4Number(args.radius, "terrain radius", 0.1, 2048)
			terrain:FillBall(center, radius, material)
			return { mode = "fill", shape = "ball", material = material.Name, center = p4Array(center), radius = r1(radius) }
		elseif shape == "cylinder" then
			local height = p4Number(args.height, "terrain height", 0.1, 4096)
			local radius = p4Number(args.radius, "terrain radius", 0.1, 2048)
			terrain:FillCylinder(terrainCFrame(args, "terrain"), height, radius, material)
			return { mode = "fill", shape = "cylinder", material = material.Name, height = r1(height), radius = r1(radius) }
		elseif shape == "wedge" then
			local size = p4Vec(args.size, "terrain size")
			terrain:FillWedge(terrainCFrame(args, "terrain"), size, material)
			return { mode = "fill", shape = "wedge", material = material.Name, size = p4Array(size) }
		elseif shape == "region" then
			local region = terrainRegion(args, "terrain fill")
			terrain:FillRegion(region, 4, material)
			return { mode = "fill", shape = "region", material = material.Name, size = p4Array(region.Size) }
		end
		local size = p4Vec(args.size, "terrain size")
		terrain:FillBlock(terrainCFrame(args, "terrain"), size, material)
		return { mode = "fill", shape = "block", material = material.Name, size = p4Array(size) }
	end)
end

-- ---------- collision groups --------------------------------------------------
-- Lets scenery stop blocking NPCs (or vice versa) without deleting collision entirely.
function handlers.collision(args)
	args = args or {}
	local PhysicsService = game:GetService("PhysicsService")
	local mode = string.lower(tostring(args.mode or "list"))

	if mode == "list" then
		local groups = {}
		local ok, registered = pcall(function() return PhysicsService:GetRegisteredCollisionGroups() end)
		if ok and type(registered) == "table" then
			for _, g in ipairs(registered) do table.insert(groups, g.name or tostring(g)) end
		end
		return { mode = "list", count = #groups, groups = groups }
	end

	local name = args.name and tostring(args.name) or nil
	if mode == "create" then
		if not name then error("collision create needs a name") end
		return recorded("BuildKit collision group", function()
			PhysicsService:RegisterCollisionGroup(name)
			return { mode = "create", name = name }
		end)
	end
	if mode == "delete" then
		if not name then error("collision delete needs a name") end
		return recorded("BuildKit collision group", function()
			PhysicsService:UnregisterCollisionGroup(name)
			return { mode = "delete", name = name }
		end)
	end
	if mode == "collidable" then
		local other = args.other and tostring(args.other) or nil
		if not name or not other then error("collision collidable needs `name` and `other`") end
		local canCollide = args.canCollide
		if type(canCollide) ~= "boolean" then error("collision collidable needs canCollide bool") end
		return recorded("BuildKit collision rule", function()
			PhysicsService:CollisionGroupSetCollidable(name, other, canCollide)
			return { mode = "collidable", name = name, other = other, canCollide = canCollide }
		end)
	end
	if mode == "assign" then
		if not name then error("collision assign needs a group name") end
		local targets = p4BulkTargets(args, "collision assign")
		return recorded("BuildKit collision assign", function()
			local assigned = 0
			for _, inst in ipairs(targets) do
				for _, p in ipairs(partsOf(inst)) do
					if not p:IsA("Terrain") then
						pcall(function() p.CollisionGroup = name end)
						assigned += 1
					end
				end
			end
			return { mode = "assign", name = name, parts = assigned }
		end)
	end
	error("collision mode must be list, create, delete, assign, or collidable")
end

-- ---------- sound -------------------------------------------------------------
-- Set dressing is audio too. A Sound parented to a BasePart is positional 3D audio;
-- parented to SoundService it is global ambience.
local function soundAssetId(value, label)
	if type(value) == "number" then return "rbxassetid://" .. tostring(math.floor(value)) end
	local s = tostring(value or "")
	if s == "" then error(label .. " needs a soundId (number or rbxassetid:// string)") end
	if string.match(s, "^%d+$") then return "rbxassetid://" .. s end
	return s
end

function handlers.sound(args)
	args = args or {}
	local mode = string.lower(tostring(args.mode or "add"))
	local SoundService = game:GetService("SoundService")

	if mode == "list" then
		local host = args.target and findInst(args.target) or workspace
		if not host then error("target not found: " .. tostring(args.target)) end
		local out = {}
		for _, d in ipairs(host:GetDescendants()) do
			if d:IsA("Sound") then
				table.insert(out, { path = d:GetFullName(), soundId = d.SoundId, volume = r1(d.Volume), looped = d.Looped, playing = d.Playing })
			end
			if #out >= 100 then break end
		end
		return { mode = "list", count = #out, sounds = out }
	end

	if mode == "remove" then
		local host = args.target and findInst(args.target) or SoundService
		if not host then error("target not found: " .. tostring(args.target)) end
		return recorded("BuildKit sound remove", function()
			local removed = 0
			for _, d in ipairs(host:GetDescendants()) do
				if d:IsA("Sound") and (args.name == nil or d.Name == tostring(args.name)) then
					d:Destroy()
					removed += 1
				end
			end
			return { mode = "remove", removed = removed }
		end)
	end

	if mode ~= "add" then error("sound mode must be add, remove, or list") end

	local parent = SoundService
	if args.target ~= nil then
		local inst = findInst(args.target)
		if not inst then error("target not found: " .. tostring(args.target)) end
		parent = inst
	end
	local soundId = soundAssetId(args.soundId, "sound add")
	return recorded("BuildKit sound", function()
		local s = Instance.new("Sound")
		s.Name = args.name and tostring(args.name) or "BuildKitSound"
		s.SoundId = soundId
		s.Volume = args.volume ~= nil and p4Number(args.volume, "sound volume", 0, 10) or 0.5
		s.Looped = args.looped == true
		s.PlaybackSpeed = args.speed ~= nil and p4Number(args.speed, "sound speed", 0.05, 20) or 1
		if args.rollOffMin ~= nil then s.RollOffMinDistance = p4Number(args.rollOffMin, "sound rollOffMin", 0, 10000) end
		if args.rollOffMax ~= nil then s.RollOffMaxDistance = p4Number(args.rollOffMax, "sound rollOffMax", 0, 100000) end
		s.Parent = parent
		return { mode = "add", path = s:GetFullName(), soundId = s.SoundId, positional = parent:IsA("BasePart") }
	end)
end

-- ---------- physical constraints ----------------------------------------------
-- Articulated props were ProximityPrompt scripts only — nothing physically hinged.
local CONSTRAINT_KINDS = {
	hinge = "HingeConstraint", weld = "WeldConstraint", motor = "Motor6D", motor6d = "Motor6D",
	spring = "SpringConstraint", prismatic = "PrismaticConstraint", ball = "BallSocketConstraint",
	rope = "RopeConstraint", rod = "RodConstraint",
}

function handlers.constraint(args)
	args = args or {}
	local mode = string.lower(tostring(args.mode or "add"))

	if mode == "list" then
		local host = args.target and findInst(args.target) or workspace
		if not host then error("target not found: " .. tostring(args.target)) end
		local out = {}
		for _, d in ipairs(host:GetDescendants()) do
			if d:IsA("Constraint") or d:IsA("WeldConstraint") or d:IsA("Motor6D") then
				table.insert(out, { path = d:GetFullName(), class = d.ClassName })
			end
			if #out >= 100 then break end
		end
		return { mode = "list", count = #out, constraints = out }
	end

	if mode == "remove" then
		local host = args.target and findInst(args.target) or workspace
		if not host then error("target not found: " .. tostring(args.target)) end
		return recorded("BuildKit constraint remove", function()
			local removed = 0
			for _, d in ipairs(host:GetDescendants()) do
				if d:IsA("Constraint") or d:IsA("WeldConstraint") or d:IsA("Motor6D") then
					d:Destroy()
					removed += 1
				end
			end
			return { mode = "remove", removed = removed }
		end)
	end

	if mode ~= "add" then error("constraint mode must be add, remove, or list") end

	local kindKey = (string.gsub(string.lower(tostring(args.kind or "hinge")), "[%s_%-]", ""))
	local className = CONSTRAINT_KINDS[kindKey]
	if not className then
		local names = {}
		for k in pairs(CONSTRAINT_KINDS) do table.insert(names, k) end
		table.sort(names)
		error("unknown constraint kind '" .. tostring(args.kind) .. "' — valid: " .. table.concat(names, ", "))
	end

	local a = findInst(args.a or args.part0)
	local b = findInst(args.b or args.part1)
	if not a or not a:IsA("BasePart") then error("constraint `a` must name a BasePart") end
	if not b or not b:IsA("BasePart") then error("constraint `b` must name a BasePart") end

	return recorded("BuildKit constraint", function()
		-- WeldConstraint takes parts directly; every other kind is Attachment-based.
		if className == "WeldConstraint" then
			local w = Instance.new("WeldConstraint")
			w.Name = args.name and tostring(args.name) or "BuildKitWeld"
			w.Part0, w.Part1 = a, b
			w.Parent = a
			return { mode = "add", kind = "weld", class = className, path = w:GetFullName() }
		end

		local a0 = Instance.new("Attachment")
		a0.Name = "BuildKitA0"
		if args.offsetA ~= nil then a0.Position = p4Vec(args.offsetA, "constraint offsetA") end
		a0.Parent = a

		local a1 = Instance.new("Attachment")
		a1.Name = "BuildKitA1"
		if args.offsetB ~= nil then a1.Position = p4Vec(args.offsetB, "constraint offsetB") end
		a1.Parent = b

		-- The hinge axis is the attachments' local X (Axis), so orient both the same way.
		if args.axis ~= nil then
			local axis = p4Vec(args.axis, "constraint axis")
			if axis.Magnitude > 0 then
				a0.Axis = axis.Unit
				a1.Axis = axis.Unit
			end
		end

		local c = Instance.new(className)
		c.Name = args.name and tostring(args.name) or ("BuildKit" .. className)
		if className == "Motor6D" then
			c.Part0, c.Part1 = a, b
			c.C0 = CFrame.new(a0.Position)
			c.C1 = CFrame.new(a1.Position)
			a0:Destroy()
			a1:Destroy()
		else
			c.Attachment0 = a0
			c.Attachment1 = a1
			if className == "HingeConstraint" then
				if args.limits == true then
					c.LimitsEnabled = true
					if args.lower ~= nil then c.LowerAngle = p4Number(args.lower, "constraint lower", -180, 180) end
					if args.upper ~= nil then c.UpperAngle = p4Number(args.upper, "constraint upper", -180, 180) end
				end
				if args.motor == true then
					c.ActuatorType = Enum.ActuatorType.Motor
					c.AngularVelocity = args.velocity ~= nil and p4Number(args.velocity, "constraint velocity", -100, 100) or 1
					-- plain integer, not 1e9: the plugin static-scan gate reads `e9` as an unknown identifier
					c.MotorMaxTorque = args.torque ~= nil and p4Number(args.torque, "constraint torque", 0, 1000000000) or 10000
				end
			end
		end
		c.Parent = a
		return { mode = "add", kind = kindKey, class = className, path = c:GetFullName() }
	end)
end

local APPLY_ACTIONS = { build = true, edit = true, replace = true, scatter = true, place = true, distribute = true, align = true, ground = true, terrain = true }
function handlers.apply(args)
	args = args or {}
	local ops = args.ops
	if type(ops) ~= "table" or #ops == 0 then error("apply needs a non-empty ops array") end
	if #ops > 500 then error("apply is capped at 500 ops") end
	for i, op in ipairs(ops) do
		if type(op) ~= "table" or type(op.action) ~= "string" or not APPLY_ACTIONS[op.action] then error("apply op " .. tostring(i) .. ": unknown action " .. tostring(op and op.action)) end
		if type(op.args) ~= "table" then error("apply op " .. tostring(i) .. ": args must be a table") end
	end
	return recorded("BuildKit apply (" .. #ops .. ")", function()
		local results, warnings = {}, {}
		for i, op in ipairs(ops) do
			local result = handlers[op.action](op.args)
			results[i] = { action = op.action, result = result }
			if type(result) == "table" then
				if result.qa and type(result.qa.warnings) == "table" then for _, warning in ipairs(result.qa.warnings) do table.insert(warnings, tostring(warning)) end end
				if type(result.warnings) == "table" then for _, warning in ipairs(result.warnings) do table.insert(warnings, tostring(warning)) end end
			end
		end
		return { count = #results, results = results, warnings = warnings }
	end)
end

-- Read or set the Studio selection: operate on what the user clicked ('get'),
-- or select a target so the user SEES what you mean ('set'). Full paths are
-- preserved so duplicate leaf names stay addressable.
function handlers.selection(args)
	local Selection = game:GetService("Selection")
	if args.mode == "set" then
		local inst = findInst(args.target)
		if not inst then
			error("target not found: " .. tostring(args.target))
		end
		Selection:Set({ inst })
		return { mode = "set", selected = inst:GetFullName() }
	end
	local out = {}
	for _, s in ipairs(Selection:Get()) do
		local fullPath = s:GetFullName()
		local entry = { name = s.Name, class = s.ClassName, path = fullPath, fullPath = fullPath }
		if s:IsA("Model") or s:IsA("BasePart") then
			local c, sz = bboxOf(s)
			entry.center = { r1(c.X), r1(c.Y), r1(c.Z) }
			entry.size = { r1(sz.X), r1(sz.Y), r1(sz.Z) }
		end
		table.insert(out, entry)
	end
	return { mode = "get", count = #out, selection = out }
end

-- Distance + axis delta between two points. Each of a,b is a name or [x,y,z].
function handlers.measure(args)
	local function resolve(t)
		if type(t) == "table" and #t == 3 then
			return Vector3.new(t[1], t[2], t[3])
		end
		local inst = findInst(t)
		if not inst then
			error("measure target not found: " .. tostring(t))
		end
		return (bboxOf(inst))
	end
	local pa = resolve(args.a)
	local pb = resolve(args.b)
	local d = pb - pa
	return {
		a = { r1(pa.X), r1(pa.Y), r1(pa.Z) },
		b = { r1(pb.X), r1(pb.Y), r1(pb.Z) },
		delta = { r1(d.X), r1(d.Y), r1(d.Z) },
		distance = r1(d.Magnitude),
	}
end

-- find: query the scene by name/class/tag/attribute/proximity. Unlike findInst
-- (name-only, first match) this returns ALL matches so the agent can locate things
-- it didn't pre-name. Read-only.
function handlers.find(args)
	local CS = game:GetService("CollectionService")
	local root = (args.root and findInst(args.root)) or workspace
	if not root then error("find root not found: " .. tostring(args.root)) end
	local limit = math.clamp(tonumber(args.limit) or 50, 1, 500)
	local nameQ = args.name and string.lower(tostring(args.name)) or nil
	local exact = args.exact == true
	local class = args.class
	local attrK = args.attr and args.attr.key
	local attrV = args.attr and args.attr.value
	local center, radius
	if type(args.near) == "table" then
		local n = args.near
		if n.target then local ti = findInst(n.target); if ti then center = (bboxOf(ti)) end
		elseif type(n.point) == "table" and #n.point == 3 then center = Vector3.new(n.point[1], n.point[2], n.point[3]) end
		radius = tonumber(n.radius) or 50
	end
	local candidates = args.tag and CS:GetTagged(args.tag) or root:GetDescendants()
	local out = {}
	for _, inst in ipairs(candidates) do
		local ok = true
		if args.tag and root ~= workspace and inst ~= root and not inst:IsDescendantOf(root) then ok = false end
		if ok and nameQ then
			local ln = string.lower(inst.Name)
			ok = exact and (ln == nameQ) or (not exact and string.find(ln, nameQ, 1, true) ~= nil)
		end
		if ok and class then local okc, isa = pcall(function() return inst:IsA(class) end); ok = okc and isa end
		if ok and attrK ~= nil then
			local av = inst:GetAttribute(attrK)
			if attrV == nil then ok = av ~= nil else ok = (av == attrV) or (tostring(av) == tostring(attrV)) end
		end
		local pos, size
		if ok then local okp, p, s = pcall(function() return bboxOf(inst) end); if okp then pos, size = p, s end end
		if ok and center then ok = pos ~= nil and (pos - center).Magnitude <= radius end
		if ok then
			local entry = { path = inst:GetFullName(), class = inst.ClassName }
			if pos then entry.pos = { r1(pos.X), r1(pos.Y), r1(pos.Z) } end
			if size then entry.size = { r1(size.X), r1(size.Y), r1(size.Z) } end
			out[#out + 1] = entry
			if #out >= limit then break end
		end
	end
	return { count = #out, truncated = #out >= limit, results = out }
end

-- cast: raycast (LOS/ground/wall) or box/sphere overlap (clearance/containment).
-- Read-only spatial perception so the agent stops hand-writing Luau for these.
function handlers.cast(args)
	local filter = {}
	if type(args.ignore) == "table" then
		for _, nm in ipairs(args.ignore) do local i = findInst(nm); if i then filter[#filter + 1] = i end end
	end
	local mode = args.mode or "ray"
	if mode == "ray" then
		local o, d = args.origin, args.dir
		if not (type(o) == "table" and #o == 3 and type(d) == "table" and #d == 3) then error("ray needs origin[3] + dir[3]") end
		local origin = Vector3.new(o[1], o[2], o[3])
		local dir = Vector3.new(d[1], d[2], d[3])
		if args.length then dir = dir.Unit * tonumber(args.length) end
		local rp = RaycastParams.new()
		rp.FilterType = Enum.RaycastFilterType.Exclude
		rp.FilterDescendantsInstances = filter
		rp.IgnoreWater = true
		local res = workspace:Raycast(origin, dir, rp)
		if not res then return { mode = "ray", hit = false } end
		return {
			mode = "ray", hit = true,
			part = res.Instance and res.Instance:GetFullName(),
			position = { r1(res.Position.X), r1(res.Position.Y), r1(res.Position.Z) },
			normal = { r1(res.Normal.X), r1(res.Normal.Y), r1(res.Normal.Z) },
			distance = r1((res.Position - origin).Magnitude),
			material = tostring(res.Material),
		}
	else
		local c = args.center
		if not (type(c) == "table" and #c == 3) then error("box/sphere needs center[3]") end
		local center = Vector3.new(c[1], c[2], c[3])
		local op = OverlapParams.new()
		op.FilterType = Enum.RaycastFilterType.Exclude
		op.FilterDescendantsInstances = filter
		op.MaxParts = math.clamp(tonumber(args.limit) or 50, 1, 500)
		local parts
		if mode == "sphere" then
			parts = workspace:GetPartBoundsInRadius(center, tonumber(args.radius) or 10, op)
		else
			local s = args.size
			if not (type(s) == "table" and #s == 3) then error("box needs size[3]") end
			parts = workspace:GetPartBoundsInBox(CFrame.new(center), Vector3.new(s[1], s[2], s[3]), op)
		end
		local out = {}
		for _, p in ipairs(parts) do out[#out + 1] = p:GetFullName() end
		return { mode = mode, count = #out, parts = out }
	end
end

-- script: READ Luau source (sync only writes). read one / list all / grep. Read-only.
function handlers.script(args)
	local mode = args.mode or "read"
	local function lineCount(src) return select(2, src:gsub("\n", "\n")) + 1 end
	if mode == "list" then
		local root = (args.target and findInst(args.target)) or game
		if not root then error("script list root not found: " .. tostring(args.target)) end
		local out = {}
		for _, d in ipairs(root:GetDescendants()) do
			if d:IsA("LuaSourceContainer") then
				out[#out + 1] = { path = d:GetFullName(), class = d.ClassName, lines = lineCount(d.Source) }
			end
		end
		return { mode = "list", count = #out, scripts = out }
	elseif mode == "find" then
		local q = tostring(args.query or "")
		if q == "" then error("script find needs query") end
		local root = (args.target and findInst(args.target)) or game
		if not root then error("script find root not found: " .. tostring(args.target)) end
		local limit = math.clamp(tonumber(args.limit) or 100, 1, 500)
		local matches = {}
		for _, d in ipairs(root:GetDescendants()) do
			if d:IsA("LuaSourceContainer") then
				local ln = 0
				for line in (d.Source .. "\n"):gmatch("(.-)\n") do
					ln += 1
					if string.find(line, q, 1, true) then
						matches[#matches + 1] = { path = d:GetFullName(), line = ln, text = string.sub(line, 1, 200) }
						if #matches >= limit then break end
					end
				end
			end
			if #matches >= limit then break end
		end
		return { mode = "find", count = #matches, truncated = #matches >= limit, matches = matches }
	else
		local inst = findInst(args.target)
		if not inst then error("script not found: " .. tostring(args.target)) end
		if not inst:IsA("LuaSourceContainer") then error(inst:GetFullName() .. " is a " .. inst.ClassName .. ", not a script") end
		local src = inst.Source
		local total = lineCount(src)
		local fromL, toL = tonumber(args.from), tonumber(args.to)
		if fromL or toL then
			fromL = math.max(1, fromL or 1); toL = toL or total
			local lines, ln = {}, 0
			for line in (src .. "\n"):gmatch("(.-)\n") do
				ln += 1
				if ln >= fromL and ln <= toL then lines[#lines + 1] = line end
				if ln > toL then break end
			end
			return { mode = "read", path = inst:GetFullName(), totalLines = total, from = fromL, to = math.min(toL, total), source = table.concat(lines, "\n") }
		end
		if total > 1500 then
			return { mode = "read", path = inst:GetFullName(), totalLines = total, error = "source has " .. total .. " lines; pass from/to to page it" }
		end
		return { mode = "read", path = inst:GetFullName(), totalLines = total, source = src }
	end
end

-- prop: get/set/list ANY property (not just Attributes, which handlers.attr covers). One undo step.
function handlers.prop(args)
	local inst = findInst(args.target)
	if not inst then error("prop target not found: " .. tostring(args.target)) end
	local mode = args.mode or "get"
	local function toValue(key, v)
		if type(v) == "table" and #v == 3 then
			local lk = string.lower(key)
			if lk:find("color") or lk:find("colour") then return Color3.new(v[1], v[2], v[3]) end
			return Vector3.new(v[1], v[2], v[3])
		end
		return v
	end
	local function fromValue(v)
		local t = typeof(v)
		if t == "Vector3" then return { r1(v.X), r1(v.Y), r1(v.Z) }
		elseif t == "Color3" then return { r1(v.R), r1(v.G), r1(v.B) }
		elseif t == "EnumItem" then return tostring(v)
		elseif t == "Instance" then return v:GetFullName()
		elseif t == "CFrame" then local p = v.Position; return { pos = { r1(p.X), r1(p.Y), r1(p.Z) } }
		else return v end
	end
	if mode == "set" then
		if not args.name then error("prop set needs name") end
		local ok, err = pcall(function()
			recorded("BuildKit prop set " .. tostring(args.name), function()
				local cur = inst[args.name]
				if typeof(cur) == "EnumItem" and type(args.value) == "string" then
					inst[args.name] = cur.EnumType[args.value]
				else
					inst[args.name] = toValue(args.name, args.value)
				end
			end)
		end)
		if not ok then error("set " .. tostring(args.name) .. " failed: " .. tostring(err)) end
		return { mode = "set", path = inst:GetFullName(), name = args.name, value = fromValue(inst[args.name]) }
	elseif mode == "list" then
		local names = args.names or { "Name", "ClassName", "Anchored", "CanCollide", "CanQuery", "CanTouch", "Transparency", "Reflectance", "Material", "Color", "Size", "CastShadow", "Massless", "Locked" }
		local out = {}
		for _, k in ipairs(names) do local ok, v = pcall(function() return inst[k] end); if ok then out[k] = fromValue(v) end end
		return { mode = "list", path = inst:GetFullName(), props = out }
	else
		if not args.name then error("prop get needs name") end
		local ok, v = pcall(function() return inst[args.name] end)
		if not ok then error("no property '" .. tostring(args.name) .. "' on " .. inst.ClassName) end
		return { mode = "get", path = inst:GetFullName(), name = args.name, value = fromValue(v), type = typeof(v) }
	end
end

-- group: wrap parts into a Model (with PrimaryPart) so a logical unit (e.g. one drawer) is one
-- grouped object; also ungroup and weld-into-a-rigid-assembly. One undo step each. The parametric
-- builders already group their sub-units (a drawer/door is its own Kind-tagged Model); this is for
-- hand-built or ungrouped geometry, or to regroup after edits.
function handlers.group(args)
	local mode = args.mode or "group"
	if mode == "group" then
		local items = {}
		if type(args.parts) == "table" then
			for _, nm in ipairs(args.parts) do local i = findInst(nm); if i then items[#items + 1] = i end end
		else
			for _, i in ipairs(game:GetService("Selection"):Get()) do items[#items + 1] = i end
		end
		if #items == 0 then error("group: no parts (pass `parts` names or select instances in Studio)") end
		local parent = items[1].Parent
		local result
		recorded("BuildKit group", function()
			local m = Instance.new("Model")
			m.Name = args.name or "Group"
			m.Parent = parent
			for _, i in ipairs(items) do i.Parent = m end
			local pp
			if args.primary then pp = m:FindFirstChild(args.primary, true) end
			if not (pp and pp:IsA("BasePart")) then
				for _, d in ipairs(m:GetDescendants()) do if d:IsA("BasePart") then pp = d; break end end
			end
			if pp and pp:IsA("BasePart") then m.PrimaryPart = pp end
			if args.kind then m:SetAttribute("Kind", tostring(args.kind)) end
			result = m
		end)
		local _, sz = bboxOf(result)
		return { mode = "group", path = result:GetFullName(), count = #items, primaryPart = result.PrimaryPart and result.PrimaryPart.Name, size = { r1(sz.X), r1(sz.Y), r1(sz.Z) } }
	elseif mode == "ungroup" then
		local m = findInst(args.target)
		if not m then error("ungroup target not found: " .. tostring(args.target)) end
		if not m:IsA("Model") then error(m:GetFullName() .. " is not a Model") end
		local parent, moved = m.Parent, 0
		recorded("BuildKit ungroup", function()
			for _, c in ipairs(m:GetChildren()) do c.Parent = parent; moved += 1 end
			m.Parent = nil
		end)
		return { mode = "ungroup", moved = moved }
	else
		local m = findInst(args.target)
		if not m then error("weld target not found: " .. tostring(args.target)) end
		local anchor = m.PrimaryPart or (m:IsA("BasePart") and m) or m:FindFirstChildWhichIsA("BasePart", true)
		if not anchor then error("weld: no BasePart under " .. m:GetFullName()) end
		local made = 0
		recorded("BuildKit weld", function()
			for _, d in ipairs(m:GetDescendants()) do
				if d:IsA("BasePart") and d ~= anchor then
					local w = Instance.new("WeldConstraint")
					w.Part0 = anchor; w.Part1 = d; w.Parent = anchor
					d.Anchored = false
					made += 1
				end
			end
			anchor.Anchored = args.anchored ~= false
		end)
		return { mode = "weld", weldsMade = made, anchor = anchor:GetFullName() }
	end
end

-- console: read the Studio LogService output in-channel (edit-time). For PLAY-mode logs the official
-- get_console_output is better; this keeps edit-time prints/warnings/errors in one perceive channel.
function handlers.console(args)
	local LS = game:GetService("LogService")
	local hist = LS:GetLogHistory()
	local limit = math.clamp(tonumber(args.limit) or 50, 1, 300)
	local filter = args.filter and string.lower(tostring(args.filter)) or nil
	local onlyErr = args.errorsOnly == true
	local out = {}
	for i = #hist, 1, -1 do
		local e = hist[i]
		local isErr = e.messageType == Enum.MessageType.MessageError or e.messageType == Enum.MessageType.MessageWarning
		local pass = true
		if onlyErr and not isErr then pass = false end
		if pass and filter and not string.find(string.lower(e.message), filter, 1, true) then pass = false end
		if pass then
			out[#out + 1] = { t = (tostring(e.messageType):gsub("Enum.MessageType.Message", "")), msg = string.sub(e.message, 1, 400) }
			if #out >= limit then break end
		end
	end
	local rev = {}
	for i = #out, 1, -1 do rev[#rev + 1] = out[i] end
	return { count = #rev, lines = rev }
end

-- Hard savepoint: clone target (held parentless in this Lua session); restore swaps
-- it back (one undo step). Genuinely safer than the undo stack — the clone is NOT in
-- the datamodel, so rbx_undo/Ctrl+Z can't sweep it out. Cleared on Studio restart.
local checkpoints = {}
function handlers.checkpoint(args)
	local name = args.name or "checkpoint"
	if args.mode == "restore" then
		local cp = checkpoints[name]
		if not cp then
			error("no checkpoint named " .. tostring(name))
		end
		return recorded("BuildKit restore " .. name, function()
			local cur = cp.parent and cp.parent:FindFirstChild(cp.origName)
			if cur then
				cur.Parent = nil -- ponytail: Parent=nil not Destroy() so undo of a restore works
			end
			local fresh = cp.clone:Clone()
			fresh.Name = cp.origName
			fresh.Parent = cp.parent or workspace
			return { mode = "restore", name = name, restored = fresh:GetFullName() }
		end)
	end
	local inst = findInst(args.target)
	if not inst then
		error("target not found: " .. tostring(args.target))
	end
	if checkpoints[name] and checkpoints[name].clone then
		checkpoints[name].clone:Destroy()
	end
	local clone = inst:Clone()
	clone.Parent = nil -- ponytail: parentless + held by `checkpoints` ref = undo-proof; never enters the datamodel
	checkpoints[name] = { clone = clone, parent = inst.Parent, origName = inst.Name }
	local c, sz = bboxOf(inst)
	return { mode = "save", name = name, of = inst:GetFullName(), size = { r1(sz.X), r1(sz.Y), r1(sz.Z) } }
end

-- rbx_navcheck: PathfindingService walkability report between two points (name or
-- [x,y,z]), with an optional in-editor path visualization. Fills the official gap —
-- character_navigation only DRIVES a char, it doesn't QA whether a layout is navigable.
function handlers.navcheck(args)
	local PFS = game:GetService("PathfindingService")
	local function toV3(t)
		if type(t) == "table" and #t == 3 then return Vector3.new(t[1], t[2], t[3]) end
		local inst = findInst(t)
		if not inst then error("navcheck point not found: " .. tostring(t)) end
		return (bboxOf(inst))
	end
	local from, to = toV3(args.from), toV3(args.to)
	local path = PFS:CreatePath({
		AgentRadius = args.agentRadius or 2,
		AgentHeight = args.agentHeight or 5,
		AgentCanJump = args.agentCanJump ~= false,
		WaypointSpacing = args.waypointSpacing or 4,
	})
	local ok, err = pcall(function() path:ComputeAsync(from, to) end)
	local old = workspace:FindFirstChild("BuildKitNavPath") -- clear any prior viz
	if old then old:Destroy() end
	local res = { from = { r1(from.X), r1(from.Y), r1(from.Z) }, to = { r1(to.X), r1(to.Y), r1(to.Z) } }
	if not ok then res.status = "Error"; res.error = tostring(err); return res end
	local wps = path:GetWaypoints()
	res.status = path.Status.Name
	res.reachable = (path.Status == Enum.PathStatus.Success)
	res.waypointCount = #wps
	local len, jumps = 0, 0
	for i = 2, #wps do len = len + (wps[i].Position - wps[i - 1].Position).Magnitude end
	for _, w in ipairs(wps) do if w.Action == Enum.PathWaypointAction.Jump then jumps = jumps + 1 end end
	res.pathLength, res.jumps = r1(len), jumps
	if args.visualize and #wps > 0 then
		local folder = Instance.new("Folder"); folder.Name = "BuildKitNavPath"; folder.Parent = workspace
		for _, w in ipairs(wps) do
			local m = Instance.new("Part")
			m.Shape = Enum.PartType.Ball; m.Size = Vector3.new(0.6, 0.6, 0.6); m.Position = w.Position
			m.Anchored = true; m.CanCollide = false; m.CanQuery = false; m.Material = Enum.Material.Neon
			m.Color = (w.Action == Enum.PathWaypointAction.Jump) and Color3.fromRGB(255, 170, 0) or Color3.fromRGB(80, 200, 255)
			m.Parent = folder
		end
		res.visualized = "BuildKitNavPath (delete the folder to clear)"
	end
	return res
end

-- rbx_tag: CollectionService tags (gameplay wiring). add/remove (one undo) / list a
-- target's tags / query every instance carrying a tag. Cheaper + multi-agent-safe vs execute_luau.
function handlers.tag(args)
	local CS = game:GetService("CollectionService")
	local mode = args.mode
	if mode == "query" then
		local out = {}
		for _, inst in ipairs(CS:GetTagged(args.tag)) do out[#out + 1] = inst:GetFullName() end
		return { mode = "query", tag = args.tag, count = #out, instances = out }
	end
	local inst = findInst(args.target)
	if not inst then error("tag target not found: " .. tostring(args.target)) end
	if mode == "list" then return { mode = "list", target = inst:GetFullName(), tags = CS:GetTags(inst) } end
	if not args.tag or args.tag == "" then error("tag: need a tag name") end
	return recorded("BuildKit tag " .. tostring(mode), function()
		if mode == "add" then CS:AddTag(inst, args.tag)
		elseif mode == "remove" then CS:RemoveTag(inst, args.tag)
		else error("tag: unknown mode " .. tostring(mode)) end
		return { mode = mode, target = inst:GetFullName(), tag = args.tag, tags = CS:GetTags(inst) }
	end)
end

-- rbx_attr: instance Attributes. set (one undo) / get / list. value coerces JSON
-- primitives; a [x,y,z] array becomes a Vector3. Non-JSON values come back stringified.
-- (the runtime harness's `safe` lives inside RUNTIME_SOURCE, not this scope — attrs are
-- flat scalars/Vector3/Color3, so a one-level stringify is all we need.)
local function attrVal(v)
	local t = typeof(v)
	if t == "number" or t == "string" or t == "boolean" then return v end
	return tostring(v)
end
function handlers.attr(args)
	local inst = findInst(args.target)
	if not inst then error("attr target not found: " .. tostring(args.target)) end
	local mode = args.mode
	if mode == "list" then
		local out = {}
		for k, v in pairs(inst:GetAttributes()) do out[k] = attrVal(v) end
		return { mode = "list", target = inst:GetFullName(), attributes = out }
	end
	if mode == "get" then
		if not args.name or args.name == "" then error("attr get: need a name") end
		return { mode = "get", target = inst:GetFullName(), name = args.name, value = attrVal(inst:GetAttribute(args.name)) }
	end
	if not args.name or args.name == "" then error("attr set: need a name") end
	local v = args.value
	if type(v) == "table" and #v == 3 then v = Vector3.new(v[1], v[2], v[3]) end
	return recorded("BuildKit attr set", function()
		inst:SetAttribute(args.name, v)
		return { mode = "set", target = inst:GetFullName(), name = args.name, value = attrVal(inst:GetAttribute(args.name)) }
	end)
end

-- rbx_diff: compare two trees (each = a checkpoint NAME or a live instance name) and
-- report added/removed/changed (moved/resized/recolored/material/anchored), keyed by
-- path RELATIVE to each root so the root's own name differing doesn't matter.
function handlers.diff(args)
	local function resolveRoot(nm)
		if checkpoints[nm] and checkpoints[nm].clone then return checkpoints[nm].clone, "checkpoint:" .. nm end
		local inst = findInst(nm)
		if inst then return inst, inst:GetFullName() end
		return nil
	end
	local ra, la = resolveRoot(args.a)
	local rb, lb = resolveRoot(args.b)
	if not ra then error("diff: 'a' not found (checkpoint or instance): " .. tostring(args.a)) end
	if not rb then error("diff: 'b' not found (checkpoint or instance): " .. tostring(args.b)) end
	local function sig(root)
		local map = {}
		local function rel(d)
			local parts, cur = {}, d
			while cur and cur ~= root do parts[#parts + 1] = cur.Name; cur = cur.Parent end
			local s = ""
			for i = #parts, 1, -1 do s = s .. "/" .. parts[i] end
			return s == "" and "." or s
		end
		for _, d in ipairs(root:GetDescendants()) do
			local p = { class = d.ClassName }
			if d:IsA("BasePart") then
				p.pos, p.size, p.color, p.material, p.anchored = d.Position, d.Size, d.Color, d.Material.Name, d.Anchored
			end
			map[rel(d)] = p
		end
		return map
	end
	local ma, mb = sig(ra), sig(rb)
	local added, removed, changed = {}, {}, {}
	for k in pairs(mb) do if not ma[k] then added[#added + 1] = k end end
	for k, va in pairs(ma) do
		local vb = mb[k]
		if not vb then removed[#removed + 1] = k
		else
			local f = {}
			if va.class ~= vb.class then f.class = { va.class, vb.class } end
			if va.pos and vb.pos and (va.pos - vb.pos).Magnitude > 0.05 then f.moved = r1((va.pos - vb.pos).Magnitude) end
			if va.size and vb.size and (va.size - vb.size).Magnitude > 0.05 then f.resized = true end
			if va.color and vb.color and va.color ~= vb.color then f.recolored = true end
			if va.material and vb.material and va.material ~= vb.material then f.material = { va.material, vb.material } end
			if va.anchored ~= nil and va.anchored ~= vb.anchored then f.anchored = { va.anchored, vb.anchored } end
			if next(f) then changed[#changed + 1] = { path = k, fields = f } end
		end
	end
	local CAP = 100
	local function cap(t)
		if #t <= CAP then return t end
		local r = {}
		for i = 1, CAP do r[i] = t[i] end
		r[CAP + 1] = "... +" .. (#t - CAP) .. " more"
		return r
	end
	return {
		a = la, b = lb,
		addedCount = #added, removedCount = #removed, changedCount = #changed,
		added = cap(added), removed = cap(removed), changed = cap(changed),
	}
end

-- rbx_optimize: perf/streaming audit (extends rbx_qa to runtime cost). Counts parts,
-- flags Precise-collision MeshParts, unanchored geometry, far-from-origin parts, big
-- models, StreamingEnabled. fix=true lowers Precise->Box CollisionFidelity (one undo).
function handlers.optimize(args)
	local root = findInst(args.target) or workspace
	local parts, meshParts, unanchored, decals, far = 0, 0, 0, 0, 0
	local precise, bigModels = {}, {}
	for _, d in ipairs(root:GetDescendants()) do
		if d:IsA("BasePart") then
			parts = parts + 1
			if not d.Anchored then unanchored = unanchored + 1 end
			if d.Position.Magnitude > 10000 then far = far + 1 end
			if d:IsA("MeshPart") then
				meshParts = meshParts + 1
				-- selene: allow(incorrect_standard_library_use) -- CollisionFidelity.Precise exists in Roblox; selene 0.31's bundled std is stale
				if d.CollisionFidelity == Enum.CollisionFidelity.Precise then precise[#precise + 1] = d end
			end
		elseif d:IsA("Decal") or d:IsA("Texture") then
			decals = decals + 1
		elseif d:IsA("Model") then
			local c = 0
			for _, x in ipairs(d:GetDescendants()) do if x:IsA("BasePart") then c = c + 1 end end
			if c > 500 then bigModels[#bigModels + 1] = d.Name .. " (" .. c .. " parts)" end
		end
	end
	local streaming = workspace.StreamingEnabled
	local warnings = {}
	if #precise > 0 then warnings[#warnings + 1] = #precise .. " MeshParts use Precise CollisionFidelity (expensive; Box/Default suits static props — fix=true lowers them)" end
	if unanchored > 0 then warnings[#warnings + 1] = unanchored .. " unanchored parts (physics cost; anchor static geometry via rbx_edit anchor)" end
	if far > 0 then warnings[#warnings + 1] = far .. " parts >10000 studs from origin (float jitter risk)" end
	if not streaming and parts > 1000 then warnings[#warnings + 1] = "StreamingEnabled OFF with " .. parts .. " parts (enable it for large places to cut client memory)" end
	for _, m in ipairs(bigModels) do warnings[#warnings + 1] = "large model: " .. m end
	local fixed = 0
	if args.fix and #precise > 0 then
		recorded("BuildKit optimize", function()
			for _, mp in ipairs(precise) do mp.CollisionFidelity = Enum.CollisionFidelity.Box; fixed = fixed + 1 end
		end)
	end
	return {
		target = root:GetFullName(), totalParts = parts, meshParts = meshParts, decals = decals,
		unanchored = unanchored, preciseMeshes = #precise, streamingEnabled = streaming,
		warnings = warnings, fixedCollisionFidelity = fixed,
	}
end

-- Isolate: hide every BasePart not under `target` by Transparency=1 (NOT
-- reparent-to-nil — a lost restore must never orphan/GC a part) so a capture shows
-- only the object being built. mode='off' restores all isolates.
function handlers.isolate(args)
	if args.mode == "off" then
		local n = 0
		for token, hidden in pairs(cutStore) do
			if string.sub(token, 1, 3) == "iso" then
				for _, e in ipairs(hidden) do
					if e.inst and e.inst.Parent then
						pcall(function()
							e.inst.Transparency = e.transparency
							e.inst:SetAttribute(ATTR.hidden, nil)
						end)
					end
				end
				cutStore[token] = nil
				n += #hidden
			end
		end
		return { mode = "off", restored = n }
	end
	local keep = findInst(args.target)
	if not keep then
		error("target not found: " .. tostring(args.target))
	end
	local keepSet = { [keep] = true }
	for _, d in ipairs(keep:GetDescendants()) do
		keepSet[d] = true
	end
	local a = keep.Parent
	while a and a ~= game do
		keepSet[a] = true
		a = a.Parent
	end
	cutSeq += 1
	local token = "iso" .. cutSeq
	-- Register the token BEFORE mutating (see cutaway) so a throw can't strand parts.
	cutStore[token] = {}
	local hidden = cutStore[token]
	for _, d in ipairs(workspace:GetDescendants()) do
		if d:IsA("BasePart") and not d:IsA("Terrain") and not keepSet[d] then
			local orig = d.Transparency
			if hidePart(d) then
				table.insert(hidden, { inst = d, transparency = orig })
			end
		end
	end
	cutStore[token] = hidden
	return { mode = "on", token = token, hiddenCount = #hidden }
end

-- Annotate: overlay a bbox outline + a "W x H x D" dimension label on the target
-- so the LLM can read scale/extent off the screenshot. mode='off' clears them.
local function clearAnno()
	local doomed = {}
	for _, root in ipairs({ game:GetService("CoreGui"), workspace }) do
		for _, d in ipairs(root:GetDescendants()) do
			if d:GetAttribute("BuildKitAnno") then
				table.insert(doomed, d)
			end
		end
	end
	for _, d in ipairs(doomed) do
		d:Destroy()
	end
	return #doomed
end
function handlers.annotate(args)
	if args.mode == "off" then
		return { mode = "off", cleared = clearAnno() }
	end
	local inst = findInst(args.target)
	if not inst then
		error("target not found: " .. tostring(args.target))
	end
	clearAnno()
	local center, size = bboxOf(inst)
	local coreGui = game:GetService("CoreGui")
	local box = Instance.new("SelectionBox")
	box.Adornee = inst
	box.LineThickness = math.max(0.03, size.Magnitude / 600)
	box.Color3 = Color3.fromRGB(255, 210, 80)
	box.SurfaceTransparency = 1
	box:SetAttribute("BuildKitAnno", true)
	box.Parent = coreGui
	local anchor = Instance.new("Part")
	anchor.Anchored = true
	anchor.CanCollide = false
	anchor.Transparency = 1
	anchor.Size = Vector3.new(0.1, 0.1, 0.1)
	anchor.CFrame = CFrame.new(center + Vector3.new(0, size.Y / 2 + 1, 0))
	anchor:SetAttribute("BuildKitAnno", true)
	anchor.Parent = workspace
	local bb = Instance.new("BillboardGui")
	bb.Adornee = anchor
	bb.Size = UDim2.fromOffset(230, 44)
	bb.AlwaysOnTop = true
	bb:SetAttribute("BuildKitAnno", true)
	local lab = Instance.new("TextLabel")
	lab.Size = UDim2.fromScale(1, 1)
	lab.BackgroundColor3 = Color3.new(0, 0, 0)
	lab.BackgroundTransparency = 0.35
	lab.Font = Enum.Font.GothamBold
	lab.TextSize = 18
	lab.TextColor3 = Color3.fromRGB(255, 210, 80)
	lab.Text = string.format("%.1f x %.1f x %.1f", size.X, size.Y, size.Z)
	lab.Parent = bb
	bb.Parent = coreGui
	return { mode = "on", target = inst.Name, size = { r1(size.X), r1(size.Y), r1(size.Z) } }
end

-- Contrast: recolor a target's parts in an alternating high-contrast flat palette so
-- seams/misalignment/gaps pop in a capture (pair with isolate=true to float it on the
-- sky). Stores originals; mode='off' restores all contrast stashes. Non-destructive.
local CONTRAST_PALETTE = {
	Color3.fromRGB(255, 64, 160), Color3.fromRGB(64, 220, 255), Color3.fromRGB(255, 220, 60),
	Color3.fromRGB(120, 255, 120), Color3.fromRGB(255, 140, 40), Color3.fromRGB(180, 120, 255),
}
function handlers.contrast(args)
	if args.mode == "off" then
		local n = 0
		for token, stash in pairs(cutStore) do
			if string.sub(token, 1, 4) == "cont" then
				for _, e in ipairs(stash) do
					if e.inst and e.inst.Parent then
						pcall(function()
							e.inst.Color = e.color
							e.inst.Material = e.material
							e.inst:SetAttribute(ATTR.contrastColor, nil)
							e.inst:SetAttribute(ATTR.contrastMat, nil)
						end)
					end
				end
				cutStore[token] = nil
				n += #stash
			end
		end
		return { mode = "off", restored = n }
	end
	local inst = findInst(args.target)
	if not inst then
		error("target not found: " .. tostring(args.target))
	end
	cutSeq += 1
	local token = "cont" .. cutSeq
	-- Register the token BEFORE mutating (see cutaway) so a throw can't strand parts.
	cutStore[token] = {}
	local stash = cutStore[token]
	local i = 0
	for _, p in ipairs(partsOf(inst)) do
		local origC, origM = p.Color, p.Material
		if contrastPart(p, CONTRAST_PALETTE[(i % #CONTRAST_PALETTE) + 1]) then
			table.insert(stash, { inst = p, color = origC, material = origM })
		end
		i += 1
	end
	return { mode = "on", token = token, count = #stash }
end

-- LAST RESORT play-mode harness. Inject the Script so it runs during Play. Can't
-- set LoadStringEnabled (not script-accessible) — the user ticks it in Properties.
function handlers.runtime_install()
	local sss = game:GetService("ServerScriptService")
	local existing = sss:FindFirstChild("BuildKitRuntime")
	if existing then
		existing:Destroy()
	end
	local s = Instance.new("Script")
	s.Name = "BuildKitRuntime"
	s.Source = RUNTIME_SOURCE:gsub("__BRIDGE_TOKEN__", BRIDGE_TOKEN)
	s.Parent = sss
	local httpOk = pcall(function()
		game:GetService("HttpService").HttpEnabled = true
	end)
	return {
		installed = true,
		name = "BuildKitRuntime",
		httpEnabled = httpOk,
		hint = "LAST RESORT — prefer official execute_luau(Server/Client). Before Play: tick ServerScriptService.LoadStringEnabled in Properties"
			.. (httpOk and "" or " AND enable HttpService.HttpEnabled (the plugin couldn't set it)")
			.. ". Then start_stop_play, then rbx_run.",
	}
end

function handlers.runtime_remove()
	local sss = game:GetService("ServerScriptService")
	local s = sss:FindFirstChild("BuildKitRuntime")
	local had = s ~= nil
	if s then
		s:Destroy()
	end
	return { removed = had }
end

-- Run several build/edit ops as ONE undo step + one round trip. Each op is
-- { action = "build"|"edit", args = {...} } where args is what that handler takes.
-- Nested recorded() no-ops (TryBeginRecording returns nil while one is open), so
-- the outer recording owns the whole batch — if any op errors it Cancels = atomic.
local BATCHABLE = { build = true, edit = true }
function handlers.batch(args)
	local ops = args.ops or {}
	return recorded("BuildKit batch (" .. #ops .. ")", function()
		local results = {}
		for i, op in ipairs(ops) do
			local action = op.action
			if not BATCHABLE[action] then
				error("batch op " .. i .. ": action not batchable: " .. tostring(action))
			end
			results[i] = handlers[action](op.args or {})
		end
		return { count = #ops, results = results }
	end)
end

-- Insert a marketplace/toolbox asset by id (InsertService:LoadAsset) so the buildkit
-- doesn't need the official insert_model. Anchors parts, parents + positions + names
-- the result. Fails clearly if the asset isn't loadable (private/not owned).
function handlers.insert(args)
	local assetId = tonumber(args.assetId or args.id)
	if not assetId then error("insert needs a numeric assetId") end
	return recorded("BuildKit insert " .. assetId, function()
		local ok, asset = pcall(function()
			return game:GetService("InsertService"):LoadAsset(assetId)
		end)
		if not ok or not asset then
			error("LoadAsset(" .. assetId .. ") failed (asset must be free or owned by you): " .. tostring(asset))
		end
		local target = (args.parent and workspace:FindFirstChild(args.parent)) or workspace
		local inserted = {}
		for _, child in ipairs(asset:GetChildren()) do
			child.Parent = target
			inserted[#inserted + 1] = child
			if child:IsA("BasePart") then child.Anchored = (args.anchored ~= false) end
			for _, d in ipairs(child:GetDescendants()) do
				if d:IsA("BasePart") then d.Anchored = (args.anchored ~= false) end
			end
		end
		asset:Destroy()
		local first = inserted[1]
		if first then
			if args.name then first.Name = args.name end
			if args.position then
				local p = Vector3.new(args.position[1], args.position[2], args.position[3])
				if first:IsA("Model") then
					first:PivotTo(CFrame.new(p))
				elseif first:IsA("BasePart") then
					first.Position = p
				end
			end
		end
		return { inserted = #inserted, name = first and first.Name or nil }
	end)
end

-- Push disk script source into the DataModel (rbx_sync). Each item is
-- { dmPath = {Service, ...folders, LeafName}, className, source, file }.
-- Missing parent folders are created; an existing leaf of the right class has
-- its Source updated, a wrong-class leaf is replaced (children re-parented).
local SYNC_CLASSES = { Script = true, LocalScript = true, ModuleScript = true }
function handlers.sync(args)
	local items = args.items or {}
	if #items == 0 then error("sync: no items") end
	return recorded("BuildKit Sync", function()
		local Selection = game:GetService("Selection")
		local synced, results = {}, {}
		local created, updated, replaced = 0, 0, 0
		for _, item in ipairs(items) do
			local dmPath = item.dmPath
			if type(dmPath) ~= "table" or #dmPath < 2 then
				error("sync: bad dmPath (need {Service,...,Leaf})")
			end
			local cls = item.className or "ModuleScript"
			if not SYNC_CLASSES[cls] then error("sync: bad className " .. tostring(cls)) end
			local ok, root = pcall(function() return game:GetService(dmPath[1]) end)
			if not ok or not root then error("sync: unknown service '" .. tostring(dmPath[1]) .. "'") end
			-- walk/create intermediate folders
			local parent = root
			for i = 2, #dmPath - 1 do
				local name = dmPath[i]
				local child = parent:FindFirstChild(name)
				if not child then
					child = Instance.new("Folder")
					child.Name = name
					child.Parent = parent
				end
				parent = child
			end
			-- leaf
			local leafName = dmPath[#dmPath]
			local src = item.source or ""
			local existing = parent:FindFirstChild(leafName)
			local inst, action
			-- EXACT class match, NOT :IsA: LocalScript:IsA("Script") is true, so :IsA would
			-- update server source in place onto a LocalScript (wrong run context). ClassName ==
			-- forces a real replace when the script class changes (.luau<->.server<->.client).
			if existing and existing.ClassName == cls then
				existing.Source = src
				inst, action = existing, "updated"
				updated = updated + 1
			elseif existing then
				inst = Instance.new(cls)
				inst.Name = leafName
				inst.Source = src
				-- carry over manual Studio-side state that has no disk source, so a class change
				-- doesn't silently re-enable/untag a script: attributes, tags, Disabled, children.
				for k, v in pairs(existing:GetAttributes()) do inst:SetAttribute(k, v) end
				local CollectionService = game:GetService("CollectionService")
				for _, tag in ipairs(CollectionService:GetTags(existing)) do CollectionService:AddTag(inst, tag) end
				if not inst:IsA("ModuleScript") and not existing:IsA("ModuleScript") then
					pcall(function() inst.Disabled = existing.Disabled end)
				end
				for _, c in ipairs(existing:GetChildren()) do c.Parent = inst end
				inst.Parent = parent
				existing:Destroy()
				action = "replaced"
				replaced = replaced + 1
			else
				inst = Instance.new(cls)
				inst.Name = leafName
				inst.Source = src
				inst.Parent = parent
				action = "created"
				created = created + 1
			end
			synced[#synced + 1] = inst
			results[#results + 1] = { path = inst:GetFullName(), action = action, file = item.file }
		end
		if args.select ~= false and #synced > 0 then
			pcall(function() Selection:Set(synced) end)
		end
		return { items = results, created = created, updated = updated, replaced = replaced }
	end)
end

function handlers.build(spec)
	spec = spec or {}
	-- Tolerate an accidental double-wrap ({spec={kind=...}}) from a client that
	-- nested the payload one level too deep.
	if spec.spec and not spec.kind then
		spec = spec.spec
	end
	if not spec.kind then
		local keys = {}
		for k in pairs(spec) do
			keys[#keys + 1] = tostring(k)
		end
		error("build: missing 'kind' (got nil). spec keys = {" .. table.concat(keys, ", ") .. "}")
	end
	return recorded("BuildKit build " .. tostring(spec.kind), function()
		prepSpec(spec) -- apply era preset + real-proportion default size before building
		FxParts.buildWarnings = {} -- reset primitive-guard warnings for this build (shared upvalue with makePart)
		local model
		if spec.kind == "room" then
			model = buildRoom(spec)
		elseif spec.kind == "stairs" then
			model = buildStairs(spec)
		elseif spec.kind == "slab" then
			model = buildSlab(spec)
		elseif spec.kind == "cabinet" then
			model = buildCabinet(spec)
		elseif spec.kind == "table" then
			model = buildTable(spec)
		elseif spec.kind == "shelf" then
			model = buildShelf(spec)
		elseif spec.kind == "bed" then
			model = buildBed(spec)
		elseif spec.kind == "chair" then
			model = buildChair(spec)
		elseif spec.kind == "sofa" then
			model = buildSeating(spec, math.max(2, math.floor(spec.seats or 3)))
		elseif spec.kind == "armchair" then
			model = buildSeating(spec, 1)
		elseif spec.kind == "desk" then
			model = buildDesk(spec)
		elseif spec.kind == "nightstand" then
			model = buildNightstand(spec)
		elseif spec.kind == "dresser" then
			model = buildDresser(spec)
		elseif spec.kind == "wardrobe" then
			model = buildWardrobe(spec)
		elseif spec.kind == "fridge" then
			model = buildFridge(spec)
		elseif spec.kind == "stove" then
			model = buildStove(spec)
		elseif spec.kind == "toilet" then
			model = buildToilet(spec)
		elseif spec.kind == "bathtub" then
			model = buildBathtub(spec)
		elseif spec.kind == "prop" then
			model = buildProp(spec)
		else
			error("unknown build kind: " .. tostring(spec.kind))
		end
		-- opt-in quality pass (csg shell / weathering), then make it parametric
		applyQuality(model, spec)
		tagBuildKit(model, spec)
		watchBuildKit(model)
		local parts = 0
		for _, d in ipairs(model:GetDescendants()) do
			if d:IsA("BasePart") then
				parts += 1
			end
		end
		local bc, bsz = bboxOf(model)
			-- Auto-QA: unless the panel toggle is off, scan the just-built model for
			-- possible z-fights, deep overlaps, and unjoined/floating pieces, and
			-- return a compact report so correctness issues always surface.
			local qa = nil
			local autoQA = plugin:GetSetting("bk_autoQA")
			if autoQA == nil then autoQA = true end
			if autoQA and qaScan then
				local ok, r = pcall(qaScan, model, { fix = false })
				if ok and type(r) == "table" then
					qa = {
						zfights = r.counts.zFights,
						fixed = r.fixed,
						seated = r.seated,
						unjoined = r.counts.nearGaps,
						overlaps = r.counts.deepOverlaps,
						counts = r.counts,
						coverage = r.coverage,
						issues = r.issues,
						warnings = r.warnings,
					}
				else
					qa = { coverage = { status = "failed" }, warnings = { "Automatic QA failed: " .. tostring(r) } }
				end
			end
			-- D: surface primitive guards (ball-collapse / degenerate) + prop oversize, even if auto-QA off.
			local extra = {}
			for _, w in ipairs(FxParts.buildWarnings) do extra[#extra + 1] = w end
			if spec.kind == "prop" then
				local md = math.max(bsz.X, bsz.Y, bsz.Z)
				if md > 24 then
					extra[#extra + 1] = string.format("prop is %.0f studs (largest dim) — likely oversized for a prop", md)
				end
			end
			if #extra > 0 then
				qa = qa or { zfights = 0, fixed = 0, seated = 0, unjoined = 0, overlaps = 0, warnings = {} }
				qa.warnings = qa.warnings or {}
				for _, w in ipairs(extra) do
					table.insert(qa.warnings, w)
				end
			end
			return {
				model = model.Name,
				parts = parts,
				center = { r1(bc.X), r1(bc.Y), r1(bc.Z) },
				size = { r1(bsz.X), r1(bsz.Y), r1(bsz.Z) },
				qa = qa,
			}
	end)
end

-- Build a styled ScreenGui: real copy into StarterGui (shows at gameplay), an
-- edit-time preview clone into CoreGui (renders in the edit viewport). Same name
-- replaces both. CoreGui previews are tagged with a BuildKitPreview attribute.
local function clearPreview(coreGui, name)
	local n = 0
	for _, ch in ipairs(coreGui:GetChildren()) do
		local tag = ch:GetAttribute("BuildKitPreview")
		if (name == nil and tag ~= nil) or tag == name then
			ch:Destroy()
			n += 1
		end
	end
	return n
end

function handlers.build_gui(spec)
	if not spec or not spec.root then
		error("build_gui needs a root node")
	end
	-- Validate the camera BEFORE any DataModel mutation: a nil camera must fail here,
	-- not after the GUI is half-installed into StarterGui/CoreGui.
	local cam = camera()
	return recorded("BuildKit GUI " .. tostring(spec.name or "Gui"), function()
	local theme = gmerge(GUI_DEFAULT_THEME, spec.theme or {})
	local name = spec.name or "BuildKitGui"

	local sg = Instance.new("ScreenGui")
	sg.Name = name
	sg.ResetOnSpawn = false
	sg.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
	sg.IgnoreGuiInset = (spec.root.ignoreInset == true)
	sg.Enabled = (spec.enabled ~= false)

	local root = buildNode(spec.root, theme, nil)
	root.Parent = sg

	local starter = game:GetService("StarterGui")
	local old = starter:FindFirstChild(name)
	if old then
		old:Destroy()
	end
	sg.Parent = starter

	local coreGui = game:GetService("CoreGui")
	clearPreview(coreGui, name)
	local preview = sg:Clone()
	preview.Name = name .. "__preview"
	preview.Enabled = true
	preview:SetAttribute("BuildKitPreview", name)
	preview.Parent = coreGui

	local vp = cam.ViewportSize
	return {
		name = name,
		enabled = sg.Enabled,
		instances = #sg:GetDescendants(),
		viewport = { vp.X, vp.Y },
	}
	end)
end

function handlers.gui_preview(args)
	local coreGui = game:GetService("CoreGui")
	local name = args.name
	if args.mode == "off" then
		return { mode = "off", cleared = clearPreview(coreGui, name) }
	end
	local starter = game:GetService("StarterGui")
	local src = starter:FindFirstChild(name)
	if not src then
		error("no ScreenGui named '" .. tostring(name) .. "' in StarterGui")
	end
	clearPreview(coreGui, name)
	local preview = src:Clone()
	preview.Name = name .. "__preview"
	preview.Enabled = true
	preview:SetAttribute("BuildKitPreview", name)
	preview.Parent = coreGui
	local vp = camera().ViewportSize
	return { mode = "on", viewport = { vp.X, vp.Y } }
end

local lightStash = {}
function handlers.set_lighting(args)
	if args.mode == "day" then
		if lightStash.ClockTime == nil then
			lightStash.ClockTime = Lighting.ClockTime
			lightStash.Brightness = Lighting.Brightness
			lightStash.Ambient = Lighting.Ambient
			lightStash.OutdoorAmbient = Lighting.OutdoorAmbient
			lightStash.ExposureCompensation = Lighting.ExposureCompensation
		end
		Lighting.ClockTime = 14
		Lighting.Brightness = 2
		Lighting.Ambient = Color3.fromRGB(120, 120, 120)
		Lighting.OutdoorAmbient = Color3.fromRGB(140, 140, 140)
		Lighting.ExposureCompensation = 0
		return { mode = "day" }
	else
		if lightStash.ClockTime ~= nil then
			Lighting.ClockTime = lightStash.ClockTime
			Lighting.Brightness = lightStash.Brightness
			Lighting.Ambient = lightStash.Ambient
			Lighting.OutdoorAmbient = lightStash.OutdoorAmbient
			Lighting.ExposureCompensation = lightStash.ExposureCompensation
			lightStash = {}
		end
		return { mode = "noir" }
	end
end

-- Restore the user's original lighting if a day-mode stash is still active when the
-- plugin is unloaded/disabled — a session that ends mid-capture otherwise leaves the
-- place stuck in bright "day" lighting with no way to flip it back.
local function restoreLightingIfStashed()
	if lightStash.ClockTime ~= nil then
		pcall(function()
			Lighting.ClockTime = lightStash.ClockTime
			Lighting.Brightness = lightStash.Brightness
			Lighting.Ambient = lightStash.Ambient
			Lighting.OutdoorAmbient = lightStash.OutdoorAmbient
			Lighting.ExposureCompensation = lightStash.ExposureCompensation
		end)
		lightStash = {}
	end
end
pcall(function()
	plugin.Unloading:Connect(restoreLightingIfStashed)
end)

--#region exports (generated — do not hand-edit)
return { handlers = handlers, CHEST_LID_SOURCE = CHEST_LID_SOURCE }
--#endregion
