local function buildProp(spec)
	local c = spec.center or { 0, 0, 0 }
	local k = tonumber(spec.scale) or 1
	-- Props own their CSG (csgProp below). Clear spec.csg so the later applyQuality pass
	-- doesn't ALSO run the furniture csgShell on the same model (was producing 2-3 unions).
	local wantCsg = spec.csg
	spec.csg = nil
	local parts = spec.parts
	local pname = spec.prop and tostring(spec.prop):lower() or nil
	if pname and PROP_PRESETS[pname] then
		parts = PROP_PRESETS[pname](spec)
	end
	parts = parts or {}
	local default = pname and (pname:sub(1, 1):upper() .. pname:sub(2)) or "Prop"
	local model = getOrMakeModel(spec.parent, spec.name or default)
	for _, ps in ipairs(parts) do
		makePart(model, scaleP(ps, k), c[1], c[2], c[3])
	end
	model.PrimaryPart = model:FindFirstChildWhichIsA("BasePart")
	-- Opt-in CSG: union solids (subtract `negate` parts first) into one smooth solid.
	-- A union isn't a parts list, so CSG props skip the regen script (final bake, not parametric).
	if wantCsg and csgProp(model) then
		return model
	end
	-- Self-contained procedural model: stash the UNSCALED parts + embed a runtime
	-- regen Script so the prop rebuilds itself from Scale/parts without the plugin.
	local okj, jp = pcall(function() return HttpService:JSONEncode(parts) end)
	if okj then model:SetAttribute("BuildKitParts", jp) end
	local rs = Instance.new("Script")
	rs.Name = "BuildKitRegen"
	rs.Source = PROP_REGEN_SOURCE
	rs.Parent = model
	return model
end

-- a wall along an axis with optional openings (doors/windows)
-- axis "X": wall runs along world X, normal is Z (fixed = z)
-- axis "Z": wall runs along world Z, normal is X (fixed = x)
-- openings: { {center=lateralOffset, width=w, sill=fromBase, top=fromBase}, ... }
local function buildWall(parent, axis, fixed, spanCenter, spanLen, baseY, height, thickness, color, mat, openings)
	local left = spanCenter - spanLen / 2
	local right = spanCenter + spanLen / 2
	openings = openings or {}
	table.sort(openings, function(a, b)
		return a.center < b.center
	end)

	local function vSeg(a, b)
		if b - a <= 0.05 then
			return
		end
		local c = (a + b) / 2
		local len = b - a
		if axis == "X" then
			makeBox(parent, c, baseY + height / 2, fixed, len, height, thickness, color, mat, "Wall")
		else
			makeBox(parent, fixed, baseY + height / 2, c, thickness, height, len, color, mat, "Wall")
		end
	end
	local function fill(aL, aR, yb, yt)
		if (aR - aL) <= 0.05 or (yt - yb) <= 0.05 then
			return
		end
		local c = (aL + aR) / 2
		local len = aR - aL
		local cy = (yb + yt) / 2
		local hh = yt - yb
		if axis == "X" then
			makeBox(parent, c, cy, fixed, len, hh, thickness, color, mat, "Wall")
		else
			makeBox(parent, fixed, cy, c, thickness, hh, len, color, mat, "Wall")
		end
	end

	local cursor = left
	for _, o in ipairs(openings) do
		local oL = spanCenter + o.center - o.width / 2
		local oR = spanCenter + o.center + o.width / 2
		vSeg(cursor, oL)
		if o.sill and o.sill > 0 then
			fill(oL, oR, baseY, baseY + o.sill)
		end
		local top = o.top or height
		if top < height then
			fill(oL, oR, baseY + top, baseY + height)
		end
		cursor = oR
	end
	vSeg(cursor, right)
end

local function buildRoom(spec)
	local c = Vector3.new(spec.center[1], spec.center[2], spec.center[3])
	local w, h, d = spec.size[1], spec.size[2], spec.size[3]
	local t = spec.thickness or 1
	local color = colorOf(spec.color, Color3.fromRGB(150, 140, 128))
	local mat = matOf(spec.material, Enum.Material.Concrete)
	local model = getOrMakeModel(spec.parent, spec.name or "Room")
	local baseY = c.Y - h / 2

	if spec.floor ~= false then
		makeBox(model, c.X, baseY - t / 2, c.Z, w, t, d, color, Enum.Material.WoodPlanks, "Floor")
	end
	if spec.ceiling ~= false then
		makeBox(model, c.X, baseY + h + t / 2, c.Z, w, t, d, color, mat, "Ceiling")
	end

	local function openingsFor(wall)
		local list = {}
		if spec.door and spec.door.wall == wall then
			table.insert(list, { center = 0, width = spec.door.width, sill = 0, top = spec.door.height })
		end
		if spec.windows then
			for _, wd in ipairs(spec.windows) do
				if wd.wall == wall then
					table.insert(
						list,
						{ center = wd.offset or 0, width = wd.width, sill = wd.sill, top = wd.sill + wd.height }
					)
				end
			end
		end
		return list
	end

	buildWall(model, "X", c.Z + d / 2 + t / 2, c.X, w + 2 * t, baseY, h, t, color, mat, openingsFor("front"))
	buildWall(model, "X", c.Z - d / 2 - t / 2, c.X, w + 2 * t, baseY, h, t, color, mat, openingsFor("back"))
	buildWall(model, "Z", c.X - w / 2 - t / 2, c.Z, d, baseY, h, t, color, mat, openingsFor("left"))
	buildWall(model, "Z", c.X + w / 2 + t / 2, c.Z, d, baseY, h, t, color, mat, openingsFor("right"))
	return model
end

local function buildStairs(spec)
	local c = Vector3.new(spec.center[1], spec.center[2], spec.center[3])
	local w, h, d = spec.size[1], spec.size[2], spec.size[3]
	local color = colorOf(spec.color, Color3.fromRGB(140, 134, 122))
	local mat = matOf(spec.material, Enum.Material.Concrete)
	local model = getOrMakeModel(spec.parent, spec.name or "Stairs")
	local steps = spec.steps or math.max(2, math.floor(h / 0.6))
	local rise = h / steps
	local run = d / steps
	for i = 0, steps - 1 do
		local sy = (c.Y - h / 2) + rise * (i + 0.5)
		local sz = (c.Z - d / 2) + run * (i + 0.5)
		makeBox(model, c.X, sy, sz, w, rise, run, color, mat, "Step")
	end
	return model
end

local function buildSlab(spec)
	local c = Vector3.new(spec.center[1], spec.center[2], spec.center[3])
	local w, h, d = spec.size[1], spec.size[2], spec.size[3]
	local color = colorOf(spec.color, Color3.fromRGB(150, 140, 128))
	local mat = matOf(spec.material, Enum.Material.Concrete)
	local model = getOrMakeModel(spec.parent, spec.name or "Slab")
	makeBox(model, c.X, c.Y, c.Z, w, h, d, color, mat, "Slab")
	return model
end

-- ---------- cabinet: clean parametric furniture ------------------------------
-- Encodes the joinery lessons so the geometry is z-fight-/gap-free by construction:
-- sides are the outer frame; top/bottom/back fit BETWEEN them (butt, never coplanar-
-- overlapping); drawer trays MEET their fronts (one joined assembly); doors fill the
-- opening with a tight reveal, hinge on the OUTER edge, and swing OUTWARD (+Z front).
-- rbx_qa stays the verifier. Animated out of the box via an embedded controller.
local CABINET_CONTROLLER = [==[
local TweenService = game:GetService("TweenService")
local model = script.Parent
for _, m in ipairs(model:GetDescendants()) do
	if m:IsA("Model") then
		local kind = m:GetAttribute("Kind")
		if (kind == "drawer" or kind == "door") and m.PrimaryPart then
			local prompt = m.PrimaryPart:FindFirstChildWhichIsA("ProximityPrompt")
			if prompt then
				local closed = m:GetPivot()
				local opened
				if kind == "drawer" then
					opened = closed * CFrame.new(0, 0, m:GetAttribute("Travel") or 3)
				else
					-- hinge stored as a LOCAL offset so it travels with the cabinet when moved/rotated
					local hl = m:GetAttribute("HingeLocal")
					local pc
					if hl then
						pc = closed * CFrame.new(hl)
					else
						pc = CFrame.new(m:GetAttribute("HingeX"), closed.Position.Y, m:GetAttribute("HingeZ"))
					end
					opened = pc * CFrame.Angles(0, math.rad(m:GetAttribute("Swing") or 100), 0) * pc:Inverse() * closed
				end
				local isOpen = false
				local nv = Instance.new("NumberValue"); nv.Parent = m
				nv.Changed:Connect(function(a) m:PivotTo(closed:Lerp(opened, a)) end)
				prompt.Triggered:Connect(function()
					isOpen = not isOpen
					prompt.ActionText = isOpen and "Close" or "Open"
					TweenService:Create(nv, TweenInfo.new(0.45, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), { Value = isOpen and 1 or 0 }):Play()
				end)
			end
		end
	end
end
]==]

local function cabinetDrawer(parent, cx, cy, w, h, frontZ, depth, col, hw, inner)
	local dm = Instance.new("Model"); dm.Name = "Drawer"; dm:SetAttribute("Kind", "drawer")
	local t = 0.3
	local front = makeBox(dm, cx, cy, frontZ - t / 2, w, h, t, col, Enum.Material.WoodPlanks, "Front")
	dm.PrimaryPart = front
	dm:SetAttribute("Travel", math.min(depth - 1.2, 3.4))
	barPull(dm, cx, cy + 0.02, frontZ, w, hw)
	local bd = math.min(depth - 1.4, 3.8)
	local tf = frontZ - t + 0.05 -- tray front overlaps the front's back -> joined assembly
	local tb = tf - bd
	local bw = w - 0.5
	makeBox(dm, cx, cy - h / 2 + 0.16, (tf + tb) / 2, bw, 0.12, bd, inner, Enum.Material.WoodPlanks, "TrayBottom")
	makeBox(dm, cx - bw / 2, cy, (tf + tb) / 2, 0.12, h - 0.28, bd, inner, Enum.Material.WoodPlanks, "TrayL")
	makeBox(dm, cx + bw / 2, cy, (tf + tb) / 2, 0.12, h - 0.28, bd, inner, Enum.Material.WoodPlanks, "TrayR")
	makeBox(dm, cx, cy, tb + 0.06, bw, h - 0.28, 0.12, inner, Enum.Material.WoodPlanks, "TrayBack")
	local pp = Instance.new("ProximityPrompt"); pp.ActionText = "Open"; pp.ObjectText = "Drawer"
	pp.HoldDuration = 0; pp.MaxActivationDistance = 12; pp.RequiresLineOfSight = false; pp.Parent = front
	dm.Parent = parent
end

local function cabinetDoor(parent, cx, cy, dw, dh, frontZ, hingeX, swing, col, hw, style, panelCol)
	local dm = Instance.new("Model"); dm.Name = "Door"; dm:SetAttribute("Kind", "door")
	dm:SetAttribute("Swing", swing)
	local t = 0.3
	-- hinge = outer-front corner, stored LOCAL to the door (relative to its PrimaryPart pivot at
	-- cx, frontZ-t/2) so opening stays correct after the cabinet is moved/rotated. cx = door centre,
	-- hingeX = outer edge -> local X = hingeX-cx (±dw/2); front face -> local Z = +t/2.
	dm:SetAttribute("HingeLocal", Vector3.new(hingeX - cx, 0, t / 2))
	local front
	if style == "shaker" then
		-- frame (4 rails butting at corners) + a recessed center panel that overlaps the
		-- rails' inner edge (joined) but shares NO coincident face with them (no z-fight,
		-- and no big front slab to deep-overlap). True shaker, qa-clean.
		local rw = math.max(0.4, math.min(0.7, dw * 0.16, dh * 0.1))
		front = makeBox(dm, cx, cy + dh / 2 - rw / 2, frontZ - t / 2, dw, rw, t, col, Enum.Material.WoodPlanks, "RailTop")
		makeBox(dm, cx, cy - dh / 2 + rw / 2, frontZ - t / 2, dw, rw, t, col, Enum.Material.WoodPlanks, "RailBottom")
		makeBox(dm, cx - dw / 2 + rw / 2, cy, frontZ - t / 2, rw, dh - 2 * rw, t, col, Enum.Material.WoodPlanks, "RailLeft")
		makeBox(dm, cx + dw / 2 - rw / 2, cy, frontZ - t / 2, rw, dh - 2 * rw, t, col, Enum.Material.WoodPlanks, "RailRight")
		makeBox(dm, cx, cy, frontZ - t / 2 + 0.02, dw - 2 * rw + 0.1, dh - 2 * rw + 0.1, 0.1, panelCol or col, Enum.Material.WoodPlanks, "Panel")
		dm.PrimaryPart = front
	else
		front = makeBox(dm, cx, cy, frontZ - t / 2, dw, dh, t, col, Enum.Material.WoodPlanks, "Front")
		dm.PrimaryPart = front
	end
	local freeSign = (cx > hingeX) and 1 or -1
	roundKnob(dm, cx + freeSign * (dw / 2 - 0.4), cy, frontZ, hw)
	local pp = Instance.new("ProximityPrompt"); pp.ActionText = "Open"; pp.ObjectText = "Cabinet"
	pp.HoldDuration = 0; pp.MaxActivationDistance = 12; pp.RequiresLineOfSight = false; pp.Parent = front
	dm.Parent = parent
end

-- Drop-in basin (its own joined Model) that sits THROUGH the counter/top hole the
-- cabinet cut for it: walls + bottom hang below, top stays OPEN (no capping rim).
-- ow/od = the hole's width/depth; wallZ = hole's BACK (-Z, wall-side) edge — the
-- faucet rises there and the gooseneck arches FORWARD (+Z) over the basin.
local function buildSink(parent, sCx, topY, cz, ow, od, wallZ, sink, hw)
	local sm = Instance.new("Model"); sm.Name = "Sink"
	local bc = colorOf(sink.basinColor, Color3.fromRGB(230, 231, 234))
	local wt = 0.25
	local rimTop = topY + 0.44 -- = the counter top surface; basin walls rise flush to it
	local down = sink.basinDepth or 2.6
	local botY = rimTop - down
	-- carcass pattern: L/R are the frame; Front(+Z)/Back(-Z)/Bottom fit BETWEEN them
	-- (butt joints — no coplanar outer faces, so no self z-fight). Top left OPEN.
	local iw = ow - 2 * wt
	makeBox(sm, sCx - ow / 2 + wt / 2, rimTop - down / 2, cz, wt, down, od, bc, Enum.Material.SmoothPlastic, "BasinL")
	makeBox(sm, sCx + ow / 2 - wt / 2, rimTop - down / 2, cz, wt, down, od, bc, Enum.Material.SmoothPlastic, "BasinR")
	makeBox(sm, sCx, rimTop - down / 2, cz - od / 2 + wt / 2, iw, down, wt, bc, Enum.Material.SmoothPlastic, "BasinBack")
	makeBox(sm, sCx, rimTop - down / 2, cz + od / 2 - wt / 2, iw, down, wt, bc, Enum.Material.SmoothPlastic, "BasinFront")
	makeBox(sm, sCx, botY + wt / 2, cz, iw, wt, od - 2 * wt, bc, Enum.Material.SmoothPlastic, "BasinBottom")
	if sink.faucet ~= false then
		local fz = wallZ - 0.35 -- behind the basin, between it and the backsplash
		makeCyl(sm, sCx, rimTop + 1.3, fz, 2.6, 0.22, "y", hw, Enum.Material.Metal, "FaucetRiser") -- slimmer, taller gooseneck
		makeCyl(sm, sCx, rimTop + 2.55, (fz + cz) / 2, cz - fz, 0.19, "z", hw, Enum.Material.Metal, "FaucetArm")
		makeCyl(sm, sCx, rimTop + 2.1, cz - 0.05, 1.0, 0.16, "y", hw, Enum.Material.Metal, "FaucetSpout")
		makeBall(sm, sCx, rimTop + 2.55, fz, 0.24, hw, Enum.Material.Metal, "FaucetElbow")
		makeBall(sm, sCx, rimTop + 2.55, cz - 0.05, 0.2, hw, Enum.Material.Metal, "FaucetBend")
	end
	sm.Parent = parent
	return sm
end

-- N interior shelf boards evenly spaced in a carcass opening (behind doors / inside
-- a fridge). Inset off the back + sides so they clear the door swing and back panel.
local function interiorShelves(model, cx, cz, w, depth, openBot, openTop, n, col, mat)
	n = math.floor(n or 0)
	if n < 1 then return end
	local gap = (openTop - openBot) / (n + 1)
	for i = 1, n do
		makeBox(model, cx, openBot + gap * i, cz + 0.2, w, 0.18, depth - 1.0, col, mat, "Shelf")
	end
end

-- spec.front = list of sections L->R, each { type = "drawers"|"doors", count, shelves }.
-- spec.sink = { width, depth, offset, basinDepth, basinColor, faucet } cuts a basin
-- hole through the countertop + carcass top so the basin isn't capped (see buildSink).
local function buildCabinet(spec)
	local cx, cyc, cz = spec.center[1], spec.center[2], spec.center[3]
	local W, H, D = spec.size[1], spec.size[2], spec.size[3]
	local wt = spec.thickness or 0.4
	local col = colorOf(spec.color, Color3.fromRGB(108, 78, 54))
	local mat = matOf(spec.material, Enum.Material.WoodPlanks)
	local hw = colorOf(spec.hardwareColor, Color3.fromRGB(156, 124, 66))
	local inner = colorOf(spec.interiorColor, Color3.fromRGB(64, 48, 38))
	local panelCol = colorOf(spec.panelColor, col:Lerp(Color3.fromRGB(255, 255, 255), 0.12))
	local style = spec.style -- "shaker" => frame+panel doors; else flat
	local toeH = spec.toeKick and 0.5 or 0
	local reveal = 0.06
	local model = getOrMakeModel(spec.parent, spec.name or "Cabinet")

	local botY, topY = cyc - H / 2, cyc + H / 2
	local frontZ = cz + D / 2
	local innerW = W - 2 * wt
	local carcassBot = botY + toeH
	local openBot, openTop = carcassBot + wt, topY - wt
	local openH = openTop - openBot

	-- sink cutout geometry, shared by the carcass Top split + the countertop frame so
	-- the basin drops THROUGH a real hole instead of being capped by counter/top blocks.
	local sink = spec.sink
	local sHx0, sHx1, sHz0, sHz1, sCx
	if sink then
		local sw = sink.width or math.min(innerW * 0.55, 6)
		local sd = sink.depth or math.max(2, D - 1.2)
		sCx = cx + (sink.offset or 0)
		sHx0, sHx1 = sCx - sw / 2, sCx + sw / 2
		sHz0, sHz1 = cz - sd / 2, cz + sd / 2
	end

	makeBox(model, cx - (W / 2 - wt / 2), (carcassBot + topY) / 2, cz, wt, topY - carcassBot, D, col, mat, "SideL")
	makeBox(model, cx + (W / 2 - wt / 2), (carcassBot + topY) / 2, cz, wt, topY - carcassBot, D, col, mat, "SideR")
	makeBox(model, cx, carcassBot + wt / 2, cz, innerW, wt, D, col, mat, "Bottom")
	if sink then
		-- split the top so the basin isn't capped by it
		local lw, rw = sHx0 - (cx - innerW / 2), (cx + innerW / 2) - sHx1
		if lw > 0.1 then makeBox(model, (cx - innerW / 2 + sHx0) / 2, topY - wt / 2, cz, lw, wt, D, col, mat, "TopL") end
		if rw > 0.1 then makeBox(model, (sHx1 + cx + innerW / 2) / 2, topY - wt / 2, cz, rw, wt, D, col, mat, "TopR") end
	else
		makeBox(model, cx, topY - wt / 2, cz, innerW, wt, D, col, mat, "Top")
	end
	if spec.back ~= false then
		makeBox(model, cx, (openBot + openTop) / 2, cz - D / 2 + wt / 2, innerW, openH, wt, col, mat, "Back")
	end
	if toeH > 0 then
		makeBox(model, cx, botY + toeH / 2, cz - 0.4, W - 0.8, toeH, D - 1.0, colorOf(spec.toeColor, Color3.fromRGB(38, 34, 38)), Enum.Material.Wood, "ToeKick")
	end
	if spec.countertop then
		local cc = colorOf(spec.counterColor, Color3.fromRGB(58, 56, 62))
		local cmat = matOf(spec.counterMaterial, Enum.Material.Slate)
		local cyT = topY + 0.22
		if sink then
			-- counter as a 4-strip frame around the basin hole (no slab over the basin)
			local cl, cr = cx - (W + 1) / 2, cx + (W + 1) / 2
			local cf, cb = cz - (D + 0.5) / 2, cz + (D + 0.5) / 2
			makeBox(model, (cl + sHx0) / 2, cyT, cz, sHx0 - cl, 0.44, D + 0.5, cc, cmat, "CounterL")
			makeBox(model, (sHx1 + cr) / 2, cyT, cz, cr - sHx1, 0.44, D + 0.5, cc, cmat, "CounterR")
			makeBox(model, sCx, cyT, (sHz1 + cb) / 2, sHx1 - sHx0, 0.44, cb - sHz1, cc, cmat, "CounterB")
			makeBox(model, sCx, cyT, (cf + sHz0) / 2, sHx1 - sHx0, 0.44, sHz0 - cf, cc, cmat, "CounterF")
		else
			makeBox(model, cx, cyT, cz, W + 1, 0.44, D + 0.5, cc, cmat, "Countertop")
		end
		if spec.bullnose then
			-- rounded front edge (KitchenUnit-style) — a cylinder nose along the counter front
			makeCyl(model, cx, cyT, cz + (D + 0.5) / 2, W + 1, 0.44, "x", cc, cmat, "Bullnose")
		end
		if spec.backsplash then
			makeBox(model, cx, topY + 1.29, cz - D / 2 - 0.15, W + 1, 1.7, 0.3, colorOf(spec.backsplashColor, Color3.fromRGB(150, 140, 122)), Enum.Material.Plaster, "Backsplash")
		end
	end
	if sink then
		buildSink(model, sCx, topY, cz, sHx1 - sHx0, sHz1 - sHz0, sHz0, sink, hw)
		if sink.apron then
			-- farmhouse apron: a big exposed basin front flush at the cabinet face (hero element)
			local aH = math.min(2.6, H * 0.5)
			makeBox(model, sCx, topY - aH / 2 + 0.1, cz + D / 2 + 0.06, sHx1 - sHx0 + 0.5, aH, 0.4, colorOf(sink.basinColor, Color3.fromRGB(236, 238, 240)), Enum.Material.SmoothPlastic, "SinkApron")
		end
	end

	local sections = spec.front or { { type = "doors", count = (W > 7 and 2 or 1) } }
	local nsec = #sections
	local stile = 0.3
	local secW = (innerW - stile * (nsec + 1)) / nsec
	for s = 0, nsec do
		local sx = cx - innerW / 2 + stile / 2 + s * (secW + stile)
		makeBox(model, sx, (openBot + openTop) / 2, frontZ - 0.12, stile, openH, 0.25, col, mat, "Stile")
	end
	for si, sec in ipairs(sections) do
		local secCx = cx - innerW / 2 + stile + (si - 1) * (secW + stile) + secW / 2
		if sec.type == "drawers" then
			local n = sec.count or 3
			local dh = (openH - reveal * (n + 1)) / n
			for i = 1, n do
				cabinetDrawer(model, secCx, openBot + reveal + dh / 2 + (i - 1) * (dh + reveal), secW - reveal, dh, frontZ, D, col, hw, inner)
			end
		else
			local n = sec.count or 2
			local dh, cyo = openH - 2 * reveal, (openBot + openTop) / 2
			if n <= 1 then
				local dw = secW - 2 * reveal
				cabinetDoor(model, secCx, cyo, dw, dh, frontZ, secCx - dw / 2, -100, col, hw, style, panelCol)
			else
				local dw = (secW - 3 * reveal) / 2
				local lcx, rcx = secCx - reveal / 2 - dw / 2, secCx + reveal / 2 + dw / 2
				cabinetDoor(model, lcx, cyo, dw, dh, frontZ, lcx - dw / 2, -100, col, hw, style, panelCol)
				cabinetDoor(model, rcx, cyo, dw, dh, frontZ, rcx + dw / 2, 100, col, hw, style, panelCol)
			end
			if sec.shelves then
				interiorShelves(model, secCx, cz, secW - 0.6, D, openBot, openTop, sec.shelves, col, mat)
			end
		end
	end

	local ctrl = Instance.new("Script"); ctrl.Name = "CabinetController"; ctrl.Source = CABINET_CONTROLLER; ctrl.Parent = model
	model.PrimaryPart = model:FindFirstChild("Bottom")
	return model
end

-- ---------- table / shelf / bed: clean joinery, textured-material defaults -----
local function buildTable(spec)
	local cx, cyc, cz = spec.center[1], spec.center[2], spec.center[3]
	local W, H, D = spec.size[1], spec.size[2], spec.size[3]
	local col = colorOf(spec.color, Color3.fromRGB(110, 80, 56))
	local mat = matOf(spec.material, Enum.Material.WoodPlanks)
	local model = getOrMakeModel(spec.parent, spec.name or "Table")
	local topThick = 0.4
	local topY = cyc + H / 2 - topThick / 2
	makeBox(model, cx, topY, cz, W, topThick, D, col, mat, "Top")
	if spec.bevel then bevelTopEdges(model, cx, topY + topThick / 2, cz, W, D, col, mat) end
	local legW = math.max(0.4, math.min(0.8, W * 0.1, D * 0.1))
	local inset = legW / 2 + 0.4
	local legBot, legTop = cyc - H / 2, topY - topThick / 2
	for _, sx in ipairs({ -1, 1 }) do
		for _, sz in ipairs({ -1, 1 }) do
			roundLeg(model, cx + sx * (W / 2 - inset), legBot, legTop, cz + sz * (D / 2 - inset), legW, col, mat)
		end
	end
	-- apron skirt under the top, inset from the edge, tying the legs together
	-- (learned from procedural-gen: tables read flimsy without it).
	local apY = legTop - 0.5
	local apIn = inset + 0.1
	makeBox(model, cx, apY, cz + D / 2 - apIn, W - 2 * apIn, 0.7, 0.15, col, mat, "Apron")
	makeBox(model, cx, apY, cz - D / 2 + apIn, W - 2 * apIn, 0.7, 0.15, col, mat, "Apron")
	makeBox(model, cx - W / 2 + apIn, apY, cz, 0.15, 0.7, D - 2 * apIn, col, mat, "Apron")
	makeBox(model, cx + W / 2 - apIn, apY, cz, 0.15, 0.7, D - 2 * apIn, col, mat, "Apron")
	model.PrimaryPart = model:FindFirstChild("Top")
	return model
end

local function buildShelf(spec)
	local cx, cyc, cz = spec.center[1], spec.center[2], spec.center[3]
	local W, H, D = spec.size[1], spec.size[2], spec.size[3]
	local wt = spec.thickness or 0.4
	local col = colorOf(spec.color, Color3.fromRGB(110, 80, 56))
	local mat = matOf(spec.material, Enum.Material.WoodPlanks)
	local model = getOrMakeModel(spec.parent, spec.name or "Shelf")
	local botY, topY = cyc - H / 2, cyc + H / 2
	local innerW = W - 2 * wt
	makeBox(model, cx - (W / 2 - wt / 2), cyc, cz, wt, H, D, col, mat, "SideL")
	makeBox(model, cx + (W / 2 - wt / 2), cyc, cz, wt, H, D, col, mat, "SideR")
	makeBox(model, cx, botY + wt / 2, cz, innerW, wt, D, col, mat, "Bottom")
	makeBox(model, cx, topY - wt / 2, cz, innerW, wt, D, col, mat, "Top")
	if spec.back ~= false then
		makeBox(model, cx, cyc, cz - D / 2 + wt / 2, innerW, H - 2 * wt, wt, col, mat, "Back")
	end
	local nshelf = math.max(0, math.floor(spec.shelves or 3))
	local openBot, openTop = botY + wt, topY - wt
	local gap = (openTop - openBot) / (nshelf + 1)
	for i = 1, nshelf do
		makeBox(model, cx, openBot + gap * i, cz + 0.3, innerW, wt * 0.6, D - 1, col, mat, "ShelfBoard")
	end
	model.PrimaryPart = model:FindFirstChild("Bottom")
	return model
end

local function buildBed(spec)
	local cx, cyc, cz = spec.center[1], spec.center[2], spec.center[3]
	local W, H, D = spec.size[1], spec.size[2], spec.size[3] -- D = bed length (head at -Z)
	local col = colorOf(spec.color, Color3.fromRGB(96, 66, 46))
	local mat = matOf(spec.material, Enum.Material.WoodPlanks)
	local matCol = colorOf(spec.mattressColor, Color3.fromRGB(224, 221, 212))
	local model = getOrMakeModel(spec.parent, spec.name or "Bed")
	local botY = cyc - H / 2
	local frameH = math.min(1.4, H * 0.45)
	local matH = math.min(1.2, H * 0.35)
	makeBox(model, cx, botY + frameH / 2, cz, W, frameH, D, col, mat, "Frame")
	makeBox(model, cx, botY + frameH + matH / 2, cz, W - 0.4, matH, D - 0.4, matCol, Enum.Material.Fabric, "Mattress")
	-- framed-and-panel headboard (procedural-gen style: 2 posts + top/bottom rails +
	-- a recessed center panel) instead of a flat slab. Head at -Z.
	local hz = cz - D / 2 - 0.2
	local hbTop, hbBot = botY + H, botY + frameH + matH * 0.3
	local postW, railT = 0.4, 0.5
	for _, sx in ipairs({ -1, 1 }) do
		makeBox(model, cx + sx * (W / 2 - postW / 2), (hbBot + hbTop) / 2, hz, postW, hbTop - hbBot, 0.4, col, mat, "HeadboardPost")
	end
	makeBox(model, cx, hbTop - railT / 2, hz, W - 2 * postW, railT, 0.4, col, mat, "HeadboardTopRail")
	makeBox(model, cx, hbBot + 0.2, hz, W - 2 * postW, 0.4, 0.4, col, mat, "HeadboardBotRail")
	makeBox(model, cx, (hbBot + 0.4 + hbTop - railT) / 2, hz - 0.05, W - 2 * postW, (hbTop - railT) - (hbBot + 0.4), 0.25, colorOf(spec.panelColor, col:Lerp(Color3.fromRGB(255, 255, 255), 0.08)), mat, "HeadboardPanel")
	-- footboard at the foot (+Z), lower than the headboard
	makeBox(model, cx, botY + frameH + 0.5, cz + D / 2 + 0.1, W, 1.2, 0.35, col, mat, "Footboard")
	makeBox(model, cx, botY + frameH + matH + 0.2, cz - D / 2 + 1.6, W - 1.6, 0.5, 1.8, colorOf(spec.pillowColor, Color3.fromRGB(240, 238, 232)), Enum.Material.Fabric, "Pillow")
	model.PrimaryPart = model:FindFirstChild("Frame")
	return model
end

-- ---------- shared carcass + controller (reused by storage furniture) --------
-- 5-panel box (sides full height, top/bottom/back butt BETWEEN them). Returns the
-- open interior bounds so callers can lay drawers/doors. Front = +Z.
local function carcass(model, cx, cyc, cz, W, H, D, wt, col, mat)
	local botY, topY = cyc - H / 2, cyc + H / 2
	local innerW = W - 2 * wt
	makeBox(model, cx - (W / 2 - wt / 2), cyc, cz, wt, H, D, col, mat, "SideL")
	makeBox(model, cx + (W / 2 - wt / 2), cyc, cz, wt, H, D, col, mat, "SideR")
	makeBox(model, cx, botY + wt / 2, cz, innerW, wt, D, col, mat, "Bottom")
	makeBox(model, cx, topY - wt / 2, cz, innerW, wt, D, col, mat, "Top")
	makeBox(model, cx, cyc, cz - D / 2 + wt / 2, innerW, H - 2 * wt, wt, col, mat, "Back")
	return botY + wt, topY - wt, innerW, cz + D / 2 -- openBot, openTop, innerW, frontZ
end

local function addController(model)
	local s = Instance.new("Script"); s.Name = "CabinetController"; s.Source = CABINET_CONTROLLER; s.Parent = model
end

-- ---------- house furniture set (clean joinery, textured defaults, +Z front) --
local function buildChair(spec)
	local cx, cyc, cz = spec.center[1], spec.center[2], spec.center[3]
	local W, H, D = spec.size[1], spec.size[2], spec.size[3]
	local col = colorOf(spec.color, Color3.fromRGB(110, 80, 56))
	local mat = matOf(spec.material, Enum.Material.WoodPlanks)
	local model = getOrMakeModel(spec.parent, spec.name or "Chair")
	local botY = cyc - H / 2
	local seatH = math.min(2.0, H * 0.42)
	local legW = 0.4
	makeBox(model, cx, botY + seatH, cz, W, 0.3, D, col, mat, "Seat")
	for _, sx in ipairs({ -1, 1 }) do
		for _, sz in ipairs({ -1, 1 }) do
			roundLeg(model, cx + sx * (W / 2 - legW / 2 - 0.1), botY, botY + seatH, cz + sz * (D / 2 - legW / 2 - 0.1), legW, col, mat)
		end
	end
	-- slatted back: 2 posts + top rail + a LOWER rail that sits on the seat back, with
	-- vertical slats butting BOTH rails (so they reach the bottom — no floating slats).
	-- rails span between the posts; everything connects seat->lower rail->slats->top rail.
	local bz = cz - D / 2 + 0.25
	local px = W / 2 - legW / 2 - 0.1
	for _, sx in ipairs({ -1, 1 }) do
		roundLeg(model, cx + sx * px, botY + seatH, botY + H, bz, legW, col, mat, "BackPost")
	end
	local backW = 2 * px - legW -- span between the posts (butt their inner faces)
	local railTopY = botY + H - 0.3
	local railBotY = botY + seatH + 0.3 -- 0.3-tall rail; its bottom meets the seat top
	makeBox(model, cx, railTopY, bz, backW, 0.4, 0.18, col, mat, "TopRail")
	makeBox(model, cx, railBotY, bz, backW, 0.3, 0.18, col, mat, "LowerRail")
	local slatBot, slatTop = railBotY + 0.1, railTopY - 0.15
	local nslat = 4
	for i = 1, nslat - 1 do
		makeBox(model, cx - backW / 2 + (backW / nslat) * i, (slatBot + slatTop) / 2, bz, 0.18, slatTop - slatBot, 0.12, col, mat, "Slat")
	end
	-- aprons: thin rails under the seat tying the legs together (procedural-gen style)
	local apY = botY + seatH - 0.4
	makeBox(model, cx, apY, cz + D / 2 - 0.45, W - 0.7, 0.3, 0.12, col, mat, "Apron")
	makeBox(model, cx, apY, cz - D / 2 + 0.45, W - 0.7, 0.3, 0.12, col, mat, "Apron")
	makeBox(model, cx - W / 2 + 0.45, apY, cz, 0.12, 0.3, D - 0.7, col, mat, "Apron")
	makeBox(model, cx + W / 2 - 0.45, apY, cz, 0.12, 0.3, D - 0.7, col, mat, "Apron")
	makeBox(model, cx, botY + seatH + 0.2, cz + 0.1, W - 0.4, 0.22, D - 0.5, colorOf(spec.cushionColor, Color3.fromRGB(120, 110, 96)), Enum.Material.Fabric, "SeatCushion")
	-- NOTE: kept the chair a clean slat-back (seat+cushion / 4 legs / 2 posts / top rail
	-- + slats / aprons). Removed the blind-added finials+stretchers — mixing rustic
	-- (finials/stretchers) with formal (aprons/slats) read as an incoherent frankenchair.
	addSitSeat(model, cx, cz + 0.1, W - 0.6, D - 0.7, botY + seatH + 0.15) -- sittable
	model.PrimaryPart = model:FindFirstChild("Seat")
	return model
end

-- sofa (seats=3) / armchair (seats=1): upholstered base + back + arms + cushions.
local function buildSeating(spec, seats)
	local cx, cyc, cz = spec.center[1], spec.center[2], spec.center[3]
	local W, H, D = spec.size[1], spec.size[2], spec.size[3]
	local fcol = colorOf(spec.color, Color3.fromRGB(70, 74, 82))
	local fmat = matOf(spec.material, Enum.Material.Fabric)
	local ccol = colorOf(spec.cushionColor, fcol:Lerp(Color3.fromRGB(255, 255, 255), 0.08))
	local model = getOrMakeModel(spec.parent, spec.name or (seats > 1 and "Sofa" or "Armchair"))
	local botY = cyc - H / 2
	local baseH = H * 0.45
	local armH = H * 0.66
	-- arms are the OUTER frame; base + back + cushions fit BETWEEN them (butt joints,
	-- no coplanar outer faces / no deep overlap — the old version buried the base).
	local armW = 0.8
	local innerW = W - 2 * armW
	-- arms get a ROLLED top (cylinder along the arm + a ball front cap) — procedural-
	-- gen technique, reads far softer than a square arm; no CSG needed.
	for _, sx in ipairs({ -1, 1 }) do
		local ax = cx + sx * (W - armW) / 2
		makeBox(model, ax, botY + armH / 2, cz + 0.2, armW, armH, D - 0.4, fcol, fmat, "Arm")
		makeCyl(model, ax, botY + armH, cz + 0.2, D - 0.4, armW, "z", fcol, fmat, "ArmRoll")
		makeBall(model, ax, botY + armH, cz + (D - 0.4) / 2 + 0.2, armW, fcol, fmat, "ArmRollCap")
	end
	makeBox(model, cx, botY + baseH / 2, cz, innerW, baseH, D, fcol, fmat, "Base")
	makeBox(model, cx, botY + H / 2, cz - D / 2 + 0.4, innerW, H, 0.8, fcol, fmat, "Back")
	local cw = innerW / seats
	for i = 1, seats do
		local scx = cx - innerW / 2 + cw / 2 + (i - 1) * cw
		makeBox(model, scx, botY + baseH + 0.35, cz + 0.5, cw - 0.25, 0.7, D - 1.4, ccol, fmat, "SeatCushion")
		makeBox(model, scx, botY + baseH + 1.1, cz - D / 2 + 1.0, cw - 0.55, H - baseH - 0.5, 0.6, ccol, fmat, "BackCushion")
	end
	-- throw pillows at the back corners (sofas only)
	if seats > 1 then
		for _, sx in ipairs({ -1, 1 }) do
			makeBox(model, cx + sx * innerW * 0.32, botY + baseH + 1.0, cz - D / 2 + 1.35, 1.3, 1.3, 0.4, colorOf(spec.pillowColor, ccol:Lerp(Color3.fromRGB(40, 40, 50), 0.35)), fmat, "ThrowPillow")
		end
	end
	addSitSeat(model, cx, cz + 0.4, innerW - 0.4, D - 1.6, botY + baseH + 0.7) -- sittable
	model.PrimaryPart = model:FindFirstChild("Base")
	return model
end

local function buildNightstand(spec)
	local cx, cyc, cz = spec.center[1], spec.center[2], spec.center[3]
	local W, H, D = spec.size[1], spec.size[2], spec.size[3]
	local wt = spec.thickness or 0.4
	local col = colorOf(spec.color, Color3.fromRGB(110, 80, 56))
	local mat = matOf(spec.material, Enum.Material.WoodPlanks)
	local hw = colorOf(spec.hardwareColor, Color3.fromRGB(156, 124, 66))
	local inner = colorOf(spec.interiorColor, Color3.fromRGB(64, 48, 38))
	local model = getOrMakeModel(spec.parent, spec.name or "Nightstand")
	local openBot, openTop, innerW, frontZ = carcass(model, cx, cyc, cz, W, H, D, wt, col, mat)
	local n, reveal = math.max(1, math.floor(spec.drawers or 2)), 0.06
	local dh = (openTop - openBot - reveal * (n + 1)) / n
	for i = 1, n do
		cabinetDrawer(model, cx, openBot + reveal + dh / 2 + (i - 1) * (dh + reveal), innerW - reveal, dh, frontZ, D, col, hw, inner)
	end
	addController(model)
	model.PrimaryPart = model:FindFirstChild("Bottom")
	return model
end

local function buildDresser(spec)
	local cx, cyc, cz = spec.center[1], spec.center[2], spec.center[3]
	local W, H, D = spec.size[1], spec.size[2], spec.size[3]
	local wt = spec.thickness or 0.4
	local col = colorOf(spec.color, Color3.fromRGB(110, 80, 56))
	local mat = matOf(spec.material, Enum.Material.WoodPlanks)
	local hw = colorOf(spec.hardwareColor, Color3.fromRGB(156, 124, 66))
	local inner = colorOf(spec.interiorColor, Color3.fromRGB(64, 48, 38))
	local model = getOrMakeModel(spec.parent, spec.name or "Dresser")
	local openBot, openTop, innerW, frontZ = carcass(model, cx, cyc, cz, W, H, D, wt, col, mat)
	local cols = math.max(1, math.floor(spec.columns or 2))
	local rows = math.max(1, math.floor(spec.rows or 3))
	local stile, reveal = 0.3, 0.06
	local secW = (innerW - stile * (cols + 1)) / cols
	for s = 0, cols do
		makeBox(model, cx - innerW / 2 + stile / 2 + s * (secW + stile), (openBot + openTop) / 2, frontZ - 0.12, stile, openTop - openBot, 0.25, col, mat, "Stile")
	end
	local dh = (openTop - openBot - reveal * (rows + 1)) / rows
	for c = 1, cols do
		local secCx = cx - innerW / 2 + stile + (c - 1) * (secW + stile) + secW / 2
		for i = 1, rows do
			cabinetDrawer(model, secCx, openBot + reveal + dh / 2 + (i - 1) * (dh + reveal), secW - reveal, dh, frontZ, D, col, hw, inner)
		end
	end
	-- overhanging top cap (procedural-gen: case goods have a top that overhangs the body)
	makeBox(model, cx, cyc + H / 2 + 0.2, cz, W + 0.8, 0.4, D + 0.4, col, mat, "TopCap")
	if spec.plinth then plinthBase(model, cx, cz, W, D, cyc - H / 2, col, mat) end
	addController(model)
	model.PrimaryPart = model:FindFirstChild("Bottom")
	return model
end

local function buildWardrobe(spec)
	local cx, cyc, cz = spec.center[1], spec.center[2], spec.center[3]
	local W, H, D = spec.size[1], spec.size[2], spec.size[3]
	local wt = spec.thickness or 0.4
	local col = colorOf(spec.color, Color3.fromRGB(110, 80, 56))
	local mat = matOf(spec.material, Enum.Material.WoodPlanks)
	local hw = colorOf(spec.hardwareColor, Color3.fromRGB(156, 124, 66))
	local style = spec.style
	local panelCol = colorOf(spec.panelColor, col:Lerp(Color3.fromRGB(255, 255, 255), 0.12))
	local model = getOrMakeModel(spec.parent, spec.name or "Wardrobe")
	local openBot, openTop, innerW, frontZ = carcass(model, cx, cyc, cz, W, H, D, wt, col, mat)
	local reveal = 0.06
	local dh, cyo = openTop - openBot - 2 * reveal, (openBot + openTop) / 2
	local dw = (innerW - 3 * reveal) / 2
	local lcx, rcx = cx - reveal / 2 - dw / 2, cx + reveal / 2 + dw / 2
	cabinetDoor(model, lcx, cyo, dw, dh, frontZ, lcx - dw / 2, -100, col, hw, style, panelCol)
	cabinetDoor(model, rcx, cyo, dw, dh, frontZ, rcx + dw / 2, 100, col, hw, style, panelCol)
	makeCyl(model, cx, openTop - 0.8, cz, innerW - 0.6, 0.18, "x", hw, Enum.Material.Metal, "Rail")
	makeBox(model, cx, openTop - 1.3, cz, innerW, 0.3, D - 1.0, col, mat, "ShelfBoard")
	-- cornice cap overhanging the top (procedural-gen: case goods read better with a cap)
	makeBox(model, cx, cyc + H / 2 + 0.2, cz, W + 0.6, 0.4, D + 0.4, col, mat, "Cornice")
	addController(model)
	model.PrimaryPart = model:FindFirstChild("Bottom")
	return model
end

local function buildDesk(spec)
	local cx, cyc, cz = spec.center[1], spec.center[2], spec.center[3]
	local W, H, D = spec.size[1], spec.size[2], spec.size[3]
	local wt = spec.thickness or 0.4
	local col = colorOf(spec.color, Color3.fromRGB(110, 80, 56))
	local mat = matOf(spec.material, Enum.Material.WoodPlanks)
	local hw = colorOf(spec.hardwareColor, Color3.fromRGB(156, 124, 66))
	local inner = colorOf(spec.interiorColor, Color3.fromRGB(64, 48, 38))
	local model = getOrMakeModel(spec.parent, spec.name or "Desk")
	local topThick = 0.4
	local topY = cyc + H / 2 - topThick / 2
	makeBox(model, cx, topY, cz, W, topThick, D, col, mat, "Top")
	local pedW = math.min(W * 0.32, 3)
	local pedCx = cx + W / 2 - pedW / 2 - 0.1
	local pedTopY, pedBotY = topY - topThick / 2, cyc - H / 2
	local pedCyc = (pedTopY + pedBotY) / 2
	local oB, oT, pInner, pFrontZ = carcass(model, pedCx, pedCyc, cz, pedW, pedTopY - pedBotY, D, wt, col, mat)
	local n, reveal = 2, 0.06
	local dh = (oT - oB - reveal * (n + 1)) / n
	for i = 1, n do
		cabinetDrawer(model, pedCx, oB + reveal + dh / 2 + (i - 1) * (dh + reveal), pInner - reveal, dh, pFrontZ, D, col, hw, inner)
	end
	local legW = 0.5
	for _, sz in ipairs({ -1, 1 }) do
		roundLeg(model, cx - W / 2 + 0.6, pedBotY, pedTopY, cz + sz * (D / 2 - 0.6), legW, col, mat)
	end
	addController(model)
	model.PrimaryPart = model:FindFirstChild("Top")
	return model
end

local function buildFridge(spec)
	local cx, cyc, cz = spec.center[1], spec.center[2], spec.center[3]
	local W, H, D = spec.size[1], spec.size[2], spec.size[3]
	local wt = spec.thickness or 0.4
	local col = colorOf(spec.color, Color3.fromRGB(214, 217, 221))
	local mat = matOf(spec.material, Enum.Material.SmoothPlastic)
	local hw = colorOf(spec.hardwareColor, Color3.fromRGB(120, 122, 128))
	local model = getOrMakeModel(spec.parent, spec.name or "Fridge")
	local openBot, openTop, innerW, frontZ = carcass(model, cx, cyc, cz, W, H, D, wt, col, mat)
	local reveal = 0.05
	local splitY = openBot + (openTop - openBot) * 0.62
	local dw = innerW - reveal
	cabinetDoor(model, cx, (openBot + splitY) / 2, dw, splitY - openBot - reveal, frontZ, cx - dw / 2, -100, col, hw, nil, nil)
	cabinetDoor(model, cx, (splitY + openTop) / 2, dw, openTop - splitY - reveal, frontZ, cx - dw / 2, -100, col, hw, nil, nil)
	-- fridge/freezer divider + interior shelves (visible when the doors open)
	local shelfCol = colorOf(spec.shelfColor, Color3.fromRGB(226, 229, 233))
	makeBox(model, cx, splitY, cz, innerW, 0.3, D - 0.4, col, mat, "Divider")
	interiorShelves(model, cx, cz, innerW - 0.4, D, openBot + 0.3, splitY - 0.3, math.floor(spec.shelves or 3), shelfCol, Enum.Material.SmoothPlastic)
	interiorShelves(model, cx, cz, innerW - 0.4, D, splitY + 0.3, openTop - 0.3, 1, shelfCol, Enum.Material.SmoothPlastic)
	addController(model)
	model.PrimaryPart = model:FindFirstChild("Bottom")
	return model
end

local function buildStove(spec)
	local cx, cyc, cz = spec.center[1], spec.center[2], spec.center[3]
	local W, H, D = spec.size[1], spec.size[2], spec.size[3]
	local wt = spec.thickness or 0.4
	local col = colorOf(spec.color, Color3.fromRGB(62, 62, 68))
	local mat = matOf(spec.material, Enum.Material.SmoothPlastic)
	local hw = colorOf(spec.hardwareColor, Color3.fromRGB(150, 152, 158))
	local model = getOrMakeModel(spec.parent, spec.name or "Stove")
	local openBot, openTop, innerW, frontZ = carcass(model, cx, cyc, cz, W, H, D, wt, col, mat)
	local topY = cyc + H / 2
	makeBox(model, cx, topY + 0.15, cz + 0.3, W, 0.3, D - 0.6, colorOf(spec.cooktopColor, Color3.fromRGB(38, 38, 42)), Enum.Material.Metal, "Cooktop")
	for _, sx in ipairs({ -1, 1 }) do
		for _, sz in ipairs({ -1, 1 }) do
			makeCyl(model, cx + sx * W * 0.22, topY + 0.32, cz + 0.3 + sz * (D - 0.6) * 0.22, 0.14, 1.1, "y", Color3.fromRGB(22, 22, 24), Enum.Material.Metal, "Burner")
		end
	end
	-- dark oven cavity liner (reads as a real oven interior when the door opens) — procedural-gen
	makeBox(model, cx, (openBot + openTop) / 2, cz + 0.2, innerW - 0.3, openTop - openBot - 0.3, D - 1.2, Color3.fromRGB(20, 20, 22), Enum.Material.SmoothPlastic, "OvenInterior")
	cabinetDoor(model, cx, (openBot + openTop) / 2, innerW - 0.1, openTop - openBot - 0.1, frontZ, cx - (innerW - 0.1) / 2, -100, col, hw, nil, nil)
	makeBox(model, cx, topY + 1.0, cz - D / 2 + 0.2, W, 1.6, 0.3, col, mat, "Backguard")
	for i = 0, 3 do
		makeCyl(model, cx - W * 0.32 + i * (W * 0.21), topY + 1.0, cz - D / 2 + 0.05, 0.34, 0.42, "z", hw, Enum.Material.Metal, "Knob")
	end
	-- vintage range stands on metal feet
	local botY = cyc - H / 2
	for _, sx in ipairs({ -1, 1 }) do
		for _, sz in ipairs({ -1, 1 }) do
			makeBox(model, cx + sx * (W / 2 - 0.5), botY - 0.3, cz + sz * (D / 2 - 0.5), 0.5, 0.6, 0.5, hw, Enum.Material.Metal, "Foot")
		end
	end
	addController(model)
	model.PrimaryPart = model:FindFirstChild("Bottom")
	return model
end

local function buildToilet(spec)
	local cx, cyc, cz = spec.center[1], spec.center[2], spec.center[3]
	local W, H, D = spec.size[1], spec.size[2], spec.size[3]
	local pcol = colorOf(spec.color, Color3.fromRGB(238, 238, 240))
	local pmat = matOf(spec.material, Enum.Material.SmoothPlastic)
	local model = getOrMakeModel(spec.parent, spec.name or "Toilet")
	local f = cyc - H / 2 -- floor
	makeBox(model, cx, f + 0.7, cz + 0.1, 1.4, 1.4, 1.8, pcol, pmat, "Pedestal")
	makeBox(model, cx, f + 1.8, cz + 0.3, 2.2, 0.8, 2.6, pcol, pmat, "Bowl")
	makeBox(model, cx, f + 2.29, cz + 0.3, 2.3, 0.18, 2.7, pcol, pmat, "Seat")
	makeBox(model, cx, f + 2.7, cz - D / 2 + 0.6, 2.4, 2.0, 1.0, pcol, pmat, "Tank") -- bottom above bowl's, rests on its back (no coplanar z-fight)
	makeBox(model, cx, f + 3.85, cz - D / 2 + 0.6, 2.5, 0.3, 1.1, pcol, pmat, "TankLid")
	model.PrimaryPart = model:FindFirstChild("Bowl")
	return model
end

local function buildBathtub(spec)
	local cx, cyc, cz = spec.center[1], spec.center[2], spec.center[3]
	local W, H, D = spec.size[1], spec.size[2], spec.size[3] -- D = tub length
	local pcol = colorOf(spec.color, Color3.fromRGB(238, 238, 240))
	local pmat = matOf(spec.material, Enum.Material.SmoothPlastic)
	local hw = colorOf(spec.hardwareColor, Color3.fromRGB(150, 152, 158))
	local model = getOrMakeModel(spec.parent, spec.name or "Bathtub")
	local botY = cyc - H / 2
	local t = 0.4
	-- carcass pattern: L/R sides are the frame; ends + floor butt BETWEEN them (no
	-- coplanar outer faces -> kills the 8 self z-fights the naive open-box had).
	local iw, id = W - 2 * t, D - 2 * t
	makeBox(model, cx - W / 2 + t / 2, cyc, cz, t, H, D, pcol, pmat, "TubSideL")
	makeBox(model, cx + W / 2 - t / 2, cyc, cz, t, H, D, pcol, pmat, "TubSideR")
	makeBox(model, cx, cyc, cz - D / 2 + t / 2, iw, H, t, pcol, pmat, "TubEndBack")
	makeBox(model, cx, cyc, cz + D / 2 - t / 2, iw, H, t, pcol, pmat, "TubEndFront")
	makeBox(model, cx, botY + t / 2, cz, iw, t, id, pcol, pmat, "TubFloor")
	-- rounded gooseneck faucet at the back-left corner
	makeCyl(model, cx, cyc + H / 2 + 0.5, cz - D / 2 + 0.6, 1.0, 0.28, "y", hw, Enum.Material.Metal, "FaucetRiser")
	makeCyl(model, cx, cyc + H / 2 + 0.95, cz - D / 2 + 1.05, 1.1, 0.22, "z", hw, Enum.Material.Metal, "FaucetSpout")
	makeBall(model, cx, cyc + H / 2 + 0.95, cz - D / 2 + 0.6, 0.3, hw, Enum.Material.Metal, "FaucetBend")
	-- rolled rim around the top + claw feet (procedural-gen clawfoot style) — the rim
	-- is 4 cylinders along the top edges; each foot = a ball paw on a short metal leg.
	local rimY = cyc + H / 2
	makeCyl(model, cx, rimY, cz - D / 2 + t / 2, W, 0.45, "x", pcol, pmat, "RolledRimBack")
	makeCyl(model, cx, rimY, cz + D / 2 - t / 2, W, 0.45, "x", pcol, pmat, "RolledRimFront")
	makeCyl(model, cx - W / 2 + t / 2, rimY, cz, D, 0.45, "z", pcol, pmat, "RolledRimL")
	makeCyl(model, cx + W / 2 - t / 2, rimY, cz, D, 0.45, "z", pcol, pmat, "RolledRimR")
	for _, sx in ipairs({ -1, 1 }) do
		for _, sz in ipairs({ -1, 1 }) do
			local fx, fz = cx + sx * (W / 2 - 0.5), cz + sz * (D / 2 - 0.9)
			makeBox(model, fx, botY - 0.2, fz, 0.4, 0.7, 0.4, hw, Enum.Material.Metal, "FootLeg")
			makeBall(model, fx, botY - 0.55, fz, 0.6, hw, Enum.Material.Metal, "FootPaw")
		end
	end
	model.PrimaryPart = model:FindFirstChild("TubFloor")
	return model
end

-- kind -> builder, used by handlers.build AND regenBuildKit (in-place rebuild).
BUILDERS = {
	cabinet = buildCabinet, table = buildTable, shelf = buildShelf, bed = buildBed, chair = buildChair,
	sofa = function(s) return buildSeating(s, math.max(2, math.floor(s.seats or 3))) end,
	armchair = function(s) return buildSeating(s, 1) end,
	desk = buildDesk, nightstand = buildNightstand, dresser = buildDresser, wardrobe = buildWardrobe,
	fridge = buildFridge, stove = buildStove, toilet = buildToilet, bathtub = buildBathtub, prop = buildProp,
}

-- Rebuild a tagged piece IN PLACE from its current attributes (size/color/center from
-- live attributes, nested fields from BuildKitSpec). Clears old geometry, builds into
-- the same model so identity/selection + the attributes survive.
regenBuildKit = function(model)
	local kind = model:GetAttribute("BuildKitKind")
	local fn = BUILDERS[kind]
	if not fn or _regenBusy[model] then return end
	local spec = {}
	local json = model:GetAttribute("BuildKitSpec")
	if json then
		local ok, d = pcall(function() return HttpService:JSONDecode(json) end)
		if ok and type(d) == "table" then spec = d end
	end
	local w, h, dp = model:GetAttribute("Width"), model:GetAttribute("Height"), model:GetAttribute("Depth")
	if w and h and dp then spec.size = { w, h, dp } end
	local sc = model:GetAttribute("Scale")
	if type(sc) == "number" then spec.scale = sc end
	local col = model:GetAttribute("Color")
	if typeof(col) == "Color3" then
		spec.color = { math.floor(col.R * 255 + 0.5), math.floor(col.G * 255 + 0.5), math.floor(col.B * 255 + 0.5) }
	end
	local cf = model:GetPivot()
	spec.center = { cf.Position.X, cf.Position.Y, cf.Position.Z }
	spec.parent, spec.name = nil, model.Name
	_regenBusy[model] = true
	recorded("BuildKit regen " .. tostring(kind), function()
		for _, c in ipairs(model:GetChildren()) do
			c:Destroy()
		end
		_regenTarget = model
		pcall(fn, spec)
		_regenTarget = nil
	end)
	_regenBusy[model] = false
end

