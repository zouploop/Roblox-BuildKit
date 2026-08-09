--#region imports (generated — do not hand-edit)
local plugin = require(script.Parent.Ctx).plugin
local watchBuildKit = require(script.Parent.Parametric).watchBuildKit
local scanBuildKit = require(script.Parent.Parametric).scanBuildKit
local toolbar = require(script.Parent.Toolbar).toolbar
local CHEST_LID_SOURCE = require(script.Parent.Handlers).CHEST_LID_SOURCE
--#endregion

-- ---------- Mesh Cutter (EditableMesh) --------------------------------------
-- Interactive in-Studio mesh editor: drop a draggable plane on a MeshPart, click Cut, and it
-- splits into two CAPPED MeshParts (clean plane-bisect that splits crossing triangles + a flat
-- fill at the cut so the piece has an interior, not a see-through shell). Each cut is one undo
-- step (Ctrl+Z). "Make Openable" turns a two-piece cut into a hinged chest. No Blender, no
-- re-upload — all via AssetService EditableMesh on the mesh already in the place.
do -- own scope so these locals don't count against the main chunk's local budget
local AssetService = game:GetService("AssetService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local Selection = game:GetService("Selection")

-- Split mp by a world plane (point + unit normal) into two capped MeshParts. pA = +normal side,
-- pB = -normal side. Each half is re-placed at its own world bbox-centre so the two pieces
-- reassemble exactly where the original sat (Roblox keeps a part's geometry centred on its origin).
local function bisectMeshPart(mp, planePos, planeNormal)
	local src = AssetService:CreateEditableMeshAsync(Content.fromUri(mp.MeshId))
	local emA, emB = AssetService:CreateEditableMesh(), AssetService:CreateEditableMesh()
	local cf = mp.CFrame
	local cap = {}
	local loA, hiA, loB, hiB
	local function acc(p, isA)
		if isA then
			loA = loA and Vector3.new(math.min(loA.X, p.X), math.min(loA.Y, p.Y), math.min(loA.Z, p.Z)) or p
			hiA = hiA and Vector3.new(math.max(hiA.X, p.X), math.max(hiA.Y, p.Y), math.max(hiA.Z, p.Z)) or p
		else
			loB = loB and Vector3.new(math.min(loB.X, p.X), math.min(loB.Y, p.Y), math.min(loB.Z, p.Z)) or p
			hiB = hiB and Vector3.new(math.max(hiB.X, p.X), math.max(hiB.Y, p.Y), math.max(hiB.Z, p.Z)) or p
		end
	end
	local function addTri(em, a, b, c, isA)
		em:AddTriangle(em:AddVertex(a), em:AddVertex(b), em:AddVertex(c))
		acc(a, isA); acc(b, isA); acc(c, isA)
	end
	local function sd(localPos) return (cf:PointToWorldSpace(localPos) - planePos):Dot(planeNormal) end
	for _, f in ipairs(src:GetFaces()) do
		local fv = src:GetFaceVertices(f)
		local p = { src:GetPosition(fv[1]), src:GetPosition(fv[2]), src:GetPosition(fv[3]) }
		local d = { sd(p[1]), sd(p[2]), sd(p[3]) }
		local ab, be = {}, {}
		for i = 1, 3 do if d[i] >= 0 then ab[#ab + 1] = i else be[#be + 1] = i end end
		if #ab == 3 then addTri(emA, p[1], p[2], p[3], true)
		elseif #be == 3 then addTri(emB, p[1], p[2], p[3], false)
		else
			local oneA = (#ab == 1)
			local lone = oneA and ab[1] or be[1]
			local many = oneA and be or ab
			local function it(ia, ib) local t = d[ia] / (d[ia] - d[ib]); return p[ia] + (p[ib] - p[ia]) * t end
			local i1, i2 = it(lone, many[1]), it(lone, many[2])
			cap[#cap + 1] = i1; cap[#cap + 1] = i2
			addTri(oneA and emA or emB, p[lone], i1, i2, oneA)
			addTri(oneA and emB or emA, p[many[1]], p[many[2]], i2, not oneA)
			addTri(oneA and emB or emA, p[many[1]], i2, i1, not oneA)
		end
	end
	if #cap >= 3 then -- flat cap: fan the cut boundary from its centroid (angle-sorted in-plane)
		local cen = Vector3.zero
		for _, q in ipairs(cap) do cen = cen + q end
		cen = cen / #cap
		local nL = cf:VectorToObjectSpace(planeNormal).Unit
		local up = math.abs(nL.Y) < 0.9 and Vector3.yAxis or Vector3.xAxis
		local a1 = up:Cross(nL).Unit
		local a2 = nL:Cross(a1).Unit
		table.sort(cap, function(x, y)
			local dx, dy = x - cen, y - cen
			return math.atan2(dx:Dot(a2), dx:Dot(a1)) < math.atan2(dy:Dot(a2), dy:Dot(a1))
		end)
		for i = 1, #cap do
			local a, b = cap[i], cap[(i % #cap) + 1]
			addTri(emA, cen, a, b, true)
			addTri(emB, cen, b, a, false)
		end
	end
	local pA = AssetService:CreateMeshPartAsync(Content.fromObject(emA))
	local pB = AssetService:CreateMeshPartAsync(Content.fromObject(emB))
	for _, pr in ipairs({ pA, pB }) do
		pr.Anchored = true; pr.Color = mp.Color; pr.Material = mp.Material
		pcall(function() pr.DoubleSided = true end) -- inner shell visible -> reads solid, not see-through
	end
	if loA then pA.CFrame = cf * CFrame.new((loA + hiA) / 2) end
	if loB then pB.CFrame = cf * CFrame.new((loB + hiB) / 2) end
	return pA, pB
end

-- cutter state + helpers
local cutTarget, cutterPart = nil, nil
local function clearCutter() if cutterPart then cutterPart:Destroy() end; cutterPart = nil end
local function spawnCutter(mp)
	clearCutter()
	cutTarget = mp
	local s = mp.Size
	local c = Instance.new("Part")
	c.Name = "MeshCutterPlane"; c.Anchored = true; c.CanCollide = false; c.CanQuery = false
	c.Size = Vector3.new(math.max(s.X, s.Z) * 1.5, 0.05, math.max(s.X, s.Z) * 1.5)
	c.CFrame = CFrame.new(mp.Position) -- horizontal at mesh centre; normal = UpVector (+Y)
	c.Color = Color3.fromRGB(70, 160, 255); c.Material = Enum.Material.Neon; c.Transparency = 0.5
	c.Parent = workspace
	cutterPart = c
	Selection:Set({ c }) -- ready to move/rotate with Studio's tools
end
local function doCut()
	if not (cutTarget and cutTarget.Parent and cutterPart) then return "Select a MeshPart, then Add Cutter, then Cut." end
	local mp, planePos, planeNormal = cutTarget, cutterPart.Position, cutterPart.CFrame.UpVector
	local rec = ChangeHistoryService:TryBeginRecording("BuildKit cut mesh")
	local ok, pA, pB = pcall(bisectMeshPart, mp, planePos, planeNormal)
	if not ok or not (pA and pB) then
		if rec then ChangeHistoryService:FinishRecording(rec, Enum.FinishRecordingOperation.Cancel) end
		return "Cut failed: " .. tostring(pA)
	end
	local model = Instance.new("Model")
	model.Name = mp.Name .. "_Cut"; model.Parent = mp.Parent
	if pA.Position.Y >= pB.Position.Y then pA.Name = "Lid"; pB.Name = "Base" else pA.Name = "Base"; pB.Name = "Lid" end
	pA.Parent = model; pB.Parent = model
	model.PrimaryPart = model:FindFirstChild("Base")
	mp:Destroy(); clearCutter(); cutTarget = nil
	Selection:Set({ model })
	if rec then ChangeHistoryService:FinishRecording(rec, Enum.FinishRecordingOperation.Commit) end
	return "Cut into Base + Lid. (Ctrl+Z to undo.)"
end
local function makeOpenable()
	local sel = Selection:Get()[1]
	local model = sel and (sel:IsA("Model") and sel or sel.Parent)
	if not (model and model:IsA("Model")) then return "Select a cut Model (Base+Lid) first." end
	local lid, base = model:FindFirstChild("Lid"), model:FindFirstChild("Base")
	if not (lid and base) then return "Model needs a Base + Lid — cut it first." end
	if model:FindFirstChild("ChestController") then return "Already openable." end
	local rec = ChangeHistoryService:TryBeginRecording("BuildKit make openable")
	local s = Instance.new("Script"); s.Name = "ChestController"; s.Source = CHEST_LID_SOURCE; s.Parent = model
	if rec then ChangeHistoryService:FinishRecording(rec, Enum.FinishRecordingOperation.Commit) end
	return "Added open/close controller. Press Play, walk up, use the prompt."
end

local cutBtn = toolbar:CreateButton("Mesh Cutter", "Cut a mesh into openable parts", "")
local okCW, cutWidget = pcall(function()
	return plugin:CreateDockWidgetPluginGui("BuildKitMeshCutter",
		DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Right, false, false, 300, 360, 260, 320))
end)
if okCW and cutWidget then
	cutWidget.Title = "BuildKit Mesh Cutter"
	local cr = Instance.new("Frame")
	cr.Size = UDim2.fromScale(1, 1); cr.BackgroundColor3 = Color3.fromRGB(34, 36, 42); cr.BorderSizePixel = 0; cr.Parent = cutWidget
	local cl = Instance.new("UIListLayout"); cl.Padding = UDim.new(0, 8); cl.SortOrder = Enum.SortOrder.LayoutOrder
	cl.HorizontalAlignment = Enum.HorizontalAlignment.Center; cl.Parent = cr
	local cpad = Instance.new("UIPadding"); cpad.PaddingTop = UDim.new(0, 10); cpad.PaddingLeft = UDim.new(0, 10); cpad.PaddingRight = UDim.new(0, 10); cpad.Parent = cr
	local function clbl(text, color, h, sz)
		local t = Instance.new("TextLabel"); t.Size = UDim2.new(1, 0, 0, h or 16); t.BackgroundTransparency = 1
		t.Text = text; t.TextColor3 = color or Color3.fromRGB(205, 207, 214); t.TextWrapped = true
		t.TextXAlignment = Enum.TextXAlignment.Left; t.Font = Enum.Font.Gotham; t.TextSize = sz or 13; t.Parent = cr
		return t
	end
	clbl("MESH CUTTER", Color3.fromRGB(70, 160, 255), 22, 16)
	clbl("Split a generated mesh into openable parts — caps the cut so it isn't see-through.", Color3.fromRGB(160, 162, 170), 34)
	clbl("1  ·  Select a MeshPart in the viewport", Color3.fromRGB(205, 207, 214), 18)
	clbl("2  ·  Add Cutter, then drag / rotate the blue plane to where the cut goes", Color3.fromRGB(205, 207, 214), 34)
	clbl("3  ·  Cut  ·  (optional) Make Openable", Color3.fromRGB(205, 207, 214), 18)
	local cstatus = clbl("ready", Color3.fromRGB(150, 200, 140), 32)
	local function cbtn(text, color)
		local b = Instance.new("TextButton"); b.Size = UDim2.new(1, 0, 0, 34); b.BackgroundColor3 = color
		b.TextColor3 = Color3.fromRGB(255, 255, 255); b.Font = Enum.Font.GothamBold; b.TextSize = 14; b.Text = text
		b.AutoButtonColor = true; b.Parent = cr
		local cc = Instance.new("UICorner"); cc.CornerRadius = UDim.new(0, 6); cc.Parent = b
		return b
	end
	local function run(fn)
		local ok, msg = pcall(fn)
		cstatus.Text = ok and tostring(msg) or ("error: " .. tostring(msg))
		cstatus.TextColor3 = ok and Color3.fromRGB(150, 200, 140) or Color3.fromRGB(230, 130, 120)
	end
	cbtn("Add Cutter to Selected", Color3.fromRGB(60, 110, 180)).MouseButton1Click:Connect(function()
		local sel = Selection:Get()[1]
		if sel and sel:IsA("MeshPart") then spawnCutter(sel); cstatus.Text = "Cutter added — move/rotate it, then Cut."; cstatus.TextColor3 = Color3.fromRGB(150, 200, 140)
		else cstatus.Text = "Select a MeshPart first."; cstatus.TextColor3 = Color3.fromRGB(230, 130, 120) end
	end)
	cbtn("Cut", Color3.fromRGB(70, 150, 235)).MouseButton1Click:Connect(function() run(doCut) end)
	cbtn("Make Openable", Color3.fromRGB(60, 64, 72)).MouseButton1Click:Connect(function() run(makeOpenable) end)
	cbtn("Cancel / Remove Cutter", Color3.fromRGB(60, 64, 72)).MouseButton1Click:Connect(function() clearCutter(); cutTarget = nil; cstatus.Text = "cutter removed" end)
	cutBtn.Click:Connect(function() cutWidget.Enabled = not cutWidget.Enabled end)
end
end -- mesh cutter scope

-- Parametric furniture: watch existing tagged pieces + any added/duplicated later, so
-- editing their attributes (Width/Height/Depth/Color...) rebuilds them in place.
scanBuildKit()
workspace.DescendantAdded:Connect(function(d)
	if d:IsA("Model") then
		task.defer(function()
			if d.Parent and d:GetAttribute("BuildKitKind") then
				watchBuildKit(d)
			end
		end)
	end
end)
--#region exports (generated — do not hand-edit)
return {}
--#endregion
