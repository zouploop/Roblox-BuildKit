-- ---------- command handlers -------------------------------------------------
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

-- Fit math shared by frame (moves the camera) and frame_coords (returns only).
local function computeFrame(target, view, zoom)
	local center, size = getBBox(target)
	local cam = camera()
	view = view or "iso"
	local dir = (VIEW_DIRS[view] or VIEW_DIRS.iso).Unit
	local fov = cam.FieldOfView
	local radius = size.Magnitude / 2
	local dist = (radius / math.tan(math.rad(fov) / 2)) * (zoom or 1.1)
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
	local radius = size.Magnitude / 2
	local dist = (radius / math.tan(math.rad(fov) / 2)) * (args.zoom or 1.15)
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
	local dist = (size.Magnitude / 2 / math.tan(math.rad(fov) / 2)) * (args.zoom or 1.15)
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
	local inst = findInst(args.target)
	if not inst then
		error("target not found: " .. tostring(args.target))
	end
	local op = args.op
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

-- Real geometry overlap set (rotation-correct): set[a][b]=true iff a and b actually intersect.
-- Gates the AABB magnitude math so oblique parts can't raise phantom overlap/z-fight flags, and
-- gives connectivity that rewards real seating instead of bounding-box kisses.
local function realOverlaps(parts)
	local set, idx = {}, {}
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
		end
	end
	return set
end

-- Translation that seats a FLOATING part F into its nearest neighbour N (~0.12 stud overlap),
-- moving only along axes that are actually gapped so a part already seated on 2 axes just slides
-- in on the third. Used by the fix pass to auto-close true gaps (single-part orphans only).
local function seatMove(F, N)
	local fc, fh = worldAABB(F)
	local nc, nh = worldAABB(N)
	local function axm(fcv, fhv, ncv, nhv)
		local gap = math.abs(fcv - ncv) - (fhv + nhv)
		if gap <= -0.1 then return 0 end -- already overlapping enough on this axis
		local dir = (ncv >= fcv) and 1 or -1
		return dir * (gap + 0.12)
	end
	return Vector3.new(axm(fc.X, fh.X, nc.X, nh.X), axm(fc.Y, fh.Y, nc.Y, nh.Y), axm(fc.Z, fh.Z, nc.Z, nh.Z))
end

-- Geometric lint you can't eyeball: unanchored parts, double-placed duplicates,
-- deep interpenetrations (z-fight/clipping risk), part-budget warnings.
-- Within each LEAF Model (holds BaseParts but no sub-Models — a single built assembly
-- like a drawer or door), verify all its parts form ONE connected blob (REAL geometry
-- overlap, rotation-correct). A split means a piece isn't joined to the rest — a drawer
-- front off its tray, a handle floating off its panel. Scoped per-leaf-model so a drawer's
-- sliding clearance to the CARCASS (a different model) is never mistaken for a defect.
-- ov = realOverlaps set over the whole instance; seats (optional) collects {part,move} to auto-seat.
local function assemblyGaps(root, out, ov, seats)
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
			if d:IsA("BasePart") then table.insert(ps, d) end
		end
		local k = #ps
		if k >= 2 and k <= 400 then
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
			-- adjacency = REAL geometry overlap (rotation-correct) OR a flush/near-touch within a small
			-- rotation-aware tolerance, so clean butt joints and tight multi-segment chains (frond
			-- arcs, candelabra arms) aren't mistaken for floating pieces. EPS is kept small (0.1) so an
			-- oblique part's empty AABB corner still reads as a real gap.
			local EPS = 0.1
			local function near(ia, ib)
				local A, B = AB[ia], AB[ib]
				return math.abs(A.c.X - B.c.X) <= A.h.X + B.h.X + EPS
					and math.abs(A.c.Y - B.c.Y) <= A.h.Y + B.h.Y + EPS
					and math.abs(A.c.Z - B.c.Z) <= A.h.Z + B.h.Z + EPS
			end
			for i = 1, k do
				for j = i + 1, k do
					if (ov[ps[i]] and ov[ps[i]][ps[j]]) or near(i, j) then
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
				local best
				for i = 1, k do
					for j = i + 1, k do
						if find(i) ~= find(j) then
							local A, B = AB[i], AB[j]
							local dx = math.max(0, math.abs(A.c.X - B.c.X) - (A.h.X + B.h.X))
							local dy = math.max(0, math.abs(A.c.Y - B.c.Y) - (A.h.Y + B.h.Y))
							local dz = math.max(0, math.abs(A.c.Z - B.c.Z) - (A.h.Z + B.h.Z))
							local d = math.sqrt(dx * dx + dy * dy + dz * dz)
							if not best or d < best then best = d end
						end
					end
				end
				if #out < 25 then
					table.insert(out, string.format("%s splits into %d unjoined groups (nearest gap %.2f)", m:GetFullName(), ncomp, best or 0))
				end
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
								local mv = nearest and seatMove(F, nearest)
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
local qaScan = function(inst, doFix)
	local args = { fix = doFix }
	local parts = partsOf(inst)
	local n = #parts
	local unanchored = {}
	for _, p in ipairs(parts) do
		if not p.Anchored then
			if #unanchored < 25 then
				table.insert(unanchored, p:GetFullName())
			end
		end
	end
	local unanchoredCount = 0
	for _, p in ipairs(parts) do
		if not p.Anchored then unanchoredCount += 1 end
	end
	local CAP = 1200
	local duplicates, deepOverlaps, nearGaps, zFights, fitGaps = {}, {}, {}, {}, {}
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
		ov = realOverlaps(parts) -- rotation-correct real-overlap set; gates the AABB magnitude math
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
				if args.fit and assemblyId(a) ~= assemblyId(b) then
						local sa, sb = slidingModel(a), slidingModel(b)
						local intended = (sa and not b:IsDescendantOf(sa)) or (sb and not a:IsDescendantOf(sb))
						if not intended then
							local gx = math.min(A.c.X + A.h.X, B.c.X + B.h.X) - math.max(A.c.X - A.h.X, B.c.X - B.h.X)
							local gy = math.min(A.c.Y + A.h.Y, B.c.Y + B.h.Y) - math.max(A.c.Y - A.h.Y, B.c.Y - B.h.Y)
							local gz = math.min(A.c.Z + A.h.Z, B.c.Z + B.h.Z) - math.max(A.c.Z - A.h.Z, B.c.Z - B.h.Z)
							local GMIN, GMAX, FACE = 0.03, 0.6, 0.5
							local axis, g
							if gx < -GMIN and gx >= -GMAX and gy > FACE and gz > FACE then axis, g = "X", -gx
							elseif gy < -GMIN and gy >= -GMAX and gx > FACE and gz > FACE then axis, g = "Y", -gy
							elseif gz < -GMIN and gz >= -GMAX and gx > FACE and gy > FACE then axis, g = "Z", -gz end
							if axis and #fitGaps < 25 then
								table.insert(fitGaps, string.format("%s | %s — %.2f gap on %s (faces nearly meet but don't touch; butt them or close the gap)", a:GetFullName(), b:GetFullName(), g, axis))
							end
						end
					end
					if (a.Position - b.Position).Magnitude < 0.05 and (a.Size - b.Size).Magnitude < 0.05 then
					if #duplicates < 25 then
						table.insert(duplicates, a:GetFullName() .. " == " .. b:GetFullName())
					end
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
							if #deepOverlaps < 25 then
								table.insert(deepOverlaps, string.format("%s overlaps %s (%d%%)", a:GetFullName(), b:GetFullName(), math.floor(100 * ovol / minvol)))
							end
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
							if #zFights < 25 then
								table.insert(zFights, string.format("%s vs %s — coplanar faces on %s (z-fight/flicker; inset ~0.05 or separate)", a:GetFullName(), b:GetFullName(), zf))
							end
							if args.fix then
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
	assemblyGaps(inst, nearGaps, ov, args.fix and seats or nil)
	-- fix=true: nudge each z-fighting part 0.06 off the shared plane (one undo step). Capped: a model
	-- with MANY coplanar pairs is densely detailed (leaf planks, greebles) where mass-nudging does more
	-- harm than the flicker — report those instead of shoving 20+ parts around.
	local zFixed = 0
	if args.fix and #zfFix > 0 and #zfFix <= 12 then
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
	if args.fix and #seats > 0 then
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
		table.insert(warnings, string.format("overlap scan skipped: %d parts over %d cap", n, CAP))
	end
	if n > 1000 then
		table.insert(warnings, string.format("high part count: %d", n))
	end
	if unanchoredCount > 0 then
		table.insert(warnings, string.format("%d unanchored part(s)", unanchoredCount))
	end
	if #duplicates > 0 then
		table.insert(warnings, string.format("%d duplicate-placement pair(s)", #duplicates))
	end
	if #deepOverlaps > 0 then
		table.insert(warnings, string.format("%d deep-overlap pair(s)", #deepOverlaps))
	end
	if #nearGaps > 0 then
		table.insert(warnings, string.format("%d assembly(ies) with unjoined pieces (gap inside a model)", #nearGaps))
	end
	if #zFights > 0 then
		table.insert(warnings, string.format("%d coplanar/overlapping surface pair(s) — z-fight FLICKER risk", #zFights))
	end
	if #fitGaps > 0 then
		table.insert(warnings, string.format("%d fit-gap(s) — pieces from different assemblies nearly touch but leave a slot (opt-in fit check; VERIFY vs a capture — rotated parts can false-flag)", #fitGaps))
	end
	if zFixed > 0 then
		table.insert(warnings, string.format("fix: nudged %d z-fighting part(s) 0.06 apart (re-run rbx_qa to confirm)", zFixed))
	end
	if seated > 0 then
		table.insert(warnings, string.format("fix: seated %d floating part(s) into the model (re-run rbx_qa to confirm)", seated))
	end
	return {
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
end

function handlers.qa(args)
	local inst = findInst(args.target)
	if not inst then
		error("target not found: " .. tostring(args.target))
	end
	return qaScan(inst, args.fix)
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
	return describeInst(inst, depth)
end

-- Read or set the Studio selection: operate on what the user clicked ('get'),
-- or select a target so the user SEES what you mean ('set').
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
		local entry = { name = s.Name, class = s.ClassName, path = s:GetFullName() }
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
			-- z-fights (auto-nudged), deep overlaps, and unjoined/floating pieces, and
			-- return a compact report so correctness issues always surface.
			local qa = nil
			local autoQA = plugin:GetSetting("bk_autoQA")
			if autoQA == nil then autoQA = true end
			if autoQA and qaScan then
				local ok, r = pcall(qaScan, model, true)
				if ok and type(r) == "table" then
					qa = {
						zfights = #r.zFights,
						fixed = r.fixed,
						seated = r.seated,
						unjoined = #r.nearGaps,
						overlaps = #r.deepOverlaps,
						warnings = r.warnings,
					}
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

