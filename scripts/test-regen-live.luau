--!nocheck
-- Live Studio acceptance harness for the isolated regen/StageCommit module copies.
-- Parent setup must provide ServerStorage.BuildKitRegenTestModules with:
--   Ctx, Core, Geometry, Detail, Parametric, Quality, FxParts, PropRegen,
--   PropPresets, Builders, StageCommit, and TestWorkspace.
-- Workspace-using source copies must locally alias:
--   local workspace = script.Parent:WaitForChild("TestWorkspace")
-- This script never loads the installed plugin, Poll, Toolbar, or Handlers.

local ServerStorage = game:GetService("ServerStorage")
local HttpService = game:GetService("HttpService")
local moduleFolder = ServerStorage:WaitForChild("BuildKitRegenTestModules")
local workspace = moduleFolder:WaitForChild("TestWorkspace")

local Ctx = require(moduleFolder:WaitForChild("Ctx"))
if Ctx.plugin == nil then
	Ctx.plugin = { GetSetting = function() return nil end }
end

local Parametric = require(moduleFolder:WaitForChild("Parametric"))
local Builders = require(moduleFolder:WaitForChild("Builders"))
local StageCommit = require(moduleFolder:WaitForChild("StageCommit"))
local PropRegen = require(moduleFolder:WaitForChild("PropRegen"))

local id = string.gsub(HttpService:GenerateGUID(false), "-", "")
local buildId = "regen_" .. id
local rootName = "BuildKitRegenTest_" .. id
local center = Vector3.new(12, 7, -9)
local authoredRoot = CFrame.new(center)
local anchorPos = { 0.123456, 0.234567, 0.345678 }
local anchorRot = { 20, 35, 60 }
local eastPos = { 2.5, 0, 0 }
local tests = {}
local root
local model

local function bounded(value)
	local text = tostring(value)
	return #text <= 240 and text or string.sub(text, 1, 237) .. "..."
end

local function record(name, fn)
	local ok, err = pcall(fn)
	tests[#tests + 1] = { name = name, ok = ok, error = ok and nil or bounded(err) }
	return ok
end

local function vecClose(a, b, epsilon)
	return (a - b).Magnitude <= (epsilon or 0.001)
end

local function cfClose(a, b, epsilon)
	return vecClose(a.Position, b.Position, epsilon)
		and vecClose(a.RightVector, b.RightVector, epsilon)
		and vecClose(a.UpVector, b.UpVector, epsilon)
		and vecClose(a.LookVector, b.LookVector, epsilon)
end

local function waitUntil(predicate, timeout)
	local deadline = os.clock() + (timeout or 3)
	while os.clock() < deadline do
		local ok, result = pcall(predicate)
		if ok and result then return true end
		task.wait()
	end
	return false
end

local function partsSpec(scale)
	return {
		kind = "prop",
		name = "RegenProp",
		center = { center.X, center.Y, center.Z },
		scale = scale,
		parts = {
			{ id = "anchor", name = "Anchor", shape = "box", size = { 2, 1, 2 }, pos = anchorPos, rot = anchorRot, fx = { preset = "sparkle", rate = 3 }, light = { brightness = 2, range = 4 } },
			{ id = "east", name = "East", shape = "box", size = { 1, 1, 1 }, pos = eastPos },
			{ id = "north", name = "North", shape = "cylinder", size = { 1, 2, 1 }, pos = { 0, 1.5, -1 } },
		},
	}
end

local function request(mode, scale)
	return {
		mode = mode,
		buildId = buildId,
		rootName = rootName,
		ops = { { action = "build", args = partsSpec(scale) } },
	}
end

local function buildOne(spec)
	local built = Builders.buildProp(spec)
	Parametric.tagBuildKit(built, spec)
	Parametric.watchBuildKit(built)
	return built
end

local function findPart(name, targetModel)
	local found = (targetModel or model) and (targetModel or model):FindFirstChild(name, true)
	assert(found and found:IsA("BasePart"), "missing generated part: " .. name)
	return found
end

local function assertOwnedSubtree(instance, except, expectedBuildId)
	expectedBuildId = expectedBuildId or buildId
	assert(instance:GetAttribute("BuildKitBuildId") == expectedBuildId, "missing BuildKitBuildId on " .. instance.Name)
	assert(instance:GetAttribute("BuildKitOwned") == true, "missing BuildKitOwned on " .. instance.Name)
	for _, descendant in ipairs(instance:GetDescendants()) do
		local isExcept = except and (descendant == except or descendant:IsDescendantOf(except))
		if not isExcept then
			assert(descendant:GetAttribute("BuildKitBuildId") == expectedBuildId, "unowned generated descendant: " .. descendant.Name)
			assert(descendant:GetAttribute("BuildKitOwned") == true, "untagged generated descendant: " .. descendant.Name)
		end
	end
end

local function expectedPartCFrame(rootFrame, position, rotation, scale)
	local localFrame = CFrame.new(position[1] * scale, position[2] * scale, position[3] * scale)
	if rotation then
		localFrame *= CFrame.Angles(math.rad(rotation[1]), math.rad(rotation[2]), math.rad(rotation[3]))
	end
	return rootFrame * localFrame
end

local function expectedLocalCFrame(position, rotation, scale)
	local localFrame = CFrame.new(position[1] * scale, position[2] * scale, position[3] * scale)
	if rotation then
		localFrame *= CFrame.Angles(math.rad(rotation[1]), math.rad(rotation[2]), math.rad(rotation[3]))
	end
	return localFrame
end

local function observedRoot(targetModel, scale)
	local anchor = findPart("Anchor", targetModel)
	return anchor.CFrame * expectedLocalCFrame(anchorPos, anchorRot, scale):Inverse()
end

local function assertRootRelativePart(name, rootFrame, position, rotation, scale, targetModel)
	local part = findPart(name, targetModel)
	assert(cfClose(part.CFrame, expectedPartCFrame(rootFrame, position, rotation, scale)), name .. " drifted from the authored root/local transform")
end

record("stage append creates an isolated root", function()
	assert(not workspace:FindFirstChild(rootName), "unique test root already exists")
	local result = StageCommit.commit(request("append", 1), buildOne)
	assert(result.root.created == true and result.buildId == buildId, "append result did not create the requested root")
	root = workspace:FindFirstChild(rootName)
	assert(root and root:IsA("Model"), "stage root was not created in TestWorkspace")
	model = root:FindFirstChild("RegenProp")
	assert(model and model:IsA("Model"), "prop was not created under the stage root")
	assert(root.Parent == workspace, "stage root escaped TestWorkspace")
end)

if root and model then
	record("stage root uses management tags, not descendant ownership", function()
		assert(root:GetAttribute("BuildKitBuildId") == buildId, "stage root BuildKitBuildId is wrong")
		assert(root:GetAttribute("BuildKitBuildRoot") == true, "stage root BuildKitBuildRoot is missing")
		assert(root:GetAttribute("BuildKitManaged") == true, "stage root BuildKitManaged is missing")
		assert(root:GetAttribute("BuildKitOwned") == nil, "stage root incorrectly claims descendant ownership")
	end)
	record("nonzero first primitive establishes authored root separately from model pivot", function()
		assert(not cfClose(model:GetPivot(), authoredRoot), "fixture did not make model pivot differ from authored root")
		assert(cfClose(observedRoot(model, 1), authoredRoot), "initial geometry does not resolve to the authored root")
		assertRootRelativePart("Anchor", authoredRoot, anchorPos, anchorRot, 1)
	end)
	record("built model descendants are owned", function()
		assertOwnedSubtree(model)
	end)

	local scale2Ready = false
	local rootAfterScale2 = authoredRoot
	record("Scale=2 watcher regen completes", function()
		local oldAnchor = findPart("Anchor")
		model:SetAttribute("Scale", 2)
		scale2Ready = waitUntil(function()
			local anchor = model:FindFirstChild("Anchor", true)
			return anchor and anchor ~= oldAnchor and vecClose(anchor.Size, Vector3.new(4, 2, 4))
		end)
		assert(scale2Ready, "Scale=2 watcher regen did not complete")
	end)
	record("Scale=2 preserves authored root origin with nonzero first offset", function()
		assert(scale2Ready, "Scale=2 rebuild prerequisite failed")
		local regenRoot = observedRoot(model, 2)
		assert(cfClose(regenRoot, rootAfterScale2), "Scale=2 used model pivot as the root origin")
		assert(vecClose(regenRoot.Position, center), "Scale=2 changed the authored root center")
	end)
	record("Scale=2 preserves/scales nonzero local offsets and rotation", function()
		assert(scale2Ready, "Scale=2 rebuild prerequisite failed")
		assertRootRelativePart("Anchor", rootAfterScale2, anchorPos, anchorRot, 2)
		assertRootRelativePart("East", rootAfterScale2, eastPos, nil, 2)
	end)
	record("Scale=2 generated descendants retain ownership", function()
		assert(scale2Ready, "Scale=2 rebuild prerequisite failed")
		assertOwnedSubtree(model)
	end)

	local userPivot
	local rootAfterUserPivot = rootAfterScale2
	record("user PivotTo rotation is accepted at the nonzero-offset model pivot", function()
		assert(scale2Ready, "Scale=2 rebuild prerequisite failed")
		local beforePivot = model:GetPivot()
		userPivot = beforePivot * CFrame.Angles(math.rad(17), math.rad(41), math.rad(-23))
		model:PivotTo(userPivot)
		assert(cfClose(model:GetPivot(), userPivot), "user PivotTo did not set the model pivot")
		rootAfterUserPivot = userPivot * beforePivot:Inverse() * rootAfterScale2
	end)
	local scale075AfterUserPivotReady = false
	record("Scale=0.75 watcher regen after user PivotTo completes", function()
		assert(userPivot, "user PivotTo prerequisite failed")
		local oldAnchor = findPart("Anchor")
		model:SetAttribute("Scale", 0.75)
		scale075AfterUserPivotReady = waitUntil(function()
			local anchor = model:FindFirstChild("Anchor", true)
			return anchor and anchor ~= oldAnchor and vecClose(anchor.Size, Vector3.new(1.5, 0.75, 1.5))
		end)
		assert(scale075AfterUserPivotReady, "Scale=0.75 post-PivotTo watcher regen did not complete")
	end)
	record("Scale=0.75 preserves the transformed root origin", function()
		assert(scale075AfterUserPivotReady, "post-PivotTo rebuild prerequisite failed")
		assert(cfClose(observedRoot(model, 0.75), rootAfterUserPivot), "post-PivotTo regen changed the root origin")
	end)
	record("Scale=0.75 preserves local offsets and rotation after PivotTo", function()
		assert(scale075AfterUserPivotReady, "post-PivotTo rebuild prerequisite failed")
		assertRootRelativePart("Anchor", rootAfterUserPivot, anchorPos, anchorRot, 0.75)
		assertRootRelativePart("East", rootAfterUserPivot, eastPos, nil, 0.75)
	end)
	record("Scale=0.75 generated descendants retain ownership", function()
		assert(scale075AfterUserPivotReady, "post-PivotTo rebuild prerequisite failed")
		assertOwnedSubtree(model)
	end)

	record("update-existing preserves an unowned root sibling", function()
		local userSibling = Instance.new("Folder")
		userSibling.Name = "UserRootSibling"
		userSibling.Parent = root
		local oldModel = model
		local result = StageCommit.commit(request("update-existing", 1), buildOne)
		assert(result.root.updated == true and result.mode == "update-existing", "update-existing result is incorrect")
		assert(userSibling.Parent == root, "unowned root sibling was deleted")
		assert(userSibling:GetAttribute("BuildKitOwned") == nil, "user sibling was claimed")
		model = root:FindFirstChild("RegenProp")
		assert(model and model ~= oldModel, "update-existing did not replace the owned model")
		assertOwnedSubtree(model)
	end)

	local runtimeId = "runtime_" .. id
	local runtimeModel
	local runtimeSource
	local runtimeReady = false
	record("embedded PropRegen ModuleScript builds from the exact source", function()
		local runtimeSpec = partsSpec(1)
		runtimeSpec.name = "RuntimeProp"
		runtimeSpec.parent = rootName
		runtimeModel = Builders.buildProp(runtimeSpec)
		Parametric.tagBuildKit(runtimeModel, runtimeSpec)
		runtimeModel:SetAttribute("BuildKitBuildId", runtimeId)
		runtimeModel:SetAttribute("BuildKitOwned", true)
		for _, descendant in ipairs(runtimeModel:GetDescendants()) do
			descendant:SetAttribute("BuildKitBuildId", runtimeId)
			descendant:SetAttribute("BuildKitOwned", true)
		end
		assert(cfClose(observedRoot(runtimeModel, 1), authoredRoot), "runtime geometry does not resolve to the authored root")
		for _, child in ipairs(runtimeModel:GetChildren()) do
			if child:IsA("BasePart") then child:Destroy() end
		end
		runtimeSource = Instance.new("ModuleScript")
		runtimeSource.Name = "RuntimeRegenTest"
		runtimeSource.Source = PropRegen.PROP_REGEN_SOURCE .. "\nreturn true"
		runtimeSource.Parent = runtimeModel
		assert(require(runtimeSource) == true, "embedded runtime source did not return true")
		runtimeReady = true
	end)
	record("embedded PropRegen preserves the initial authored root/local transform", function()
		assert(runtimeReady, "embedded source prerequisite failed")
		assertRootRelativePart("Anchor", authoredRoot, anchorPos, anchorRot, 1, runtimeModel)
	end)
	local runtimeScaleReady = false
	record("embedded PropRegen responds to a live Scale event", function()
		assert(runtimeReady, "embedded source prerequisite failed")
		local oldAnchor = findPart("Anchor", runtimeModel)
		runtimeModel:SetAttribute("Scale", 1.5)
		runtimeScaleReady = waitUntil(function()
			local anchor = runtimeModel:FindFirstChild("Anchor", true)
			return anchor and anchor ~= oldAnchor and vecClose(anchor.Size, Vector3.new(3, 1.5, 3))
		end)
		assert(runtimeScaleReady, "embedded runtime Scale=1.5 regen did not complete")
	end)
	record("embedded PropRegen preserves root/local transforms after Scale", function()
		assert(runtimeScaleReady, "embedded Scale prerequisite failed")
		assert(cfClose(observedRoot(runtimeModel, 1.5), authoredRoot), "embedded runtime regen changed the authored root")
		assertRootRelativePart("Anchor", authoredRoot, anchorPos, anchorRot, 1.5, runtimeModel)
		assertRootRelativePart("East", authoredRoot, eastPos, nil, 1.5, runtimeModel)
	end)
	record("embedded PropRegen retains generated ownership", function()
		assert(runtimeScaleReady, "embedded Scale prerequisite failed")
		assertOwnedSubtree(runtimeModel, runtimeSource, runtimeId)
	end)

	local userChild
	local userChildAfterPivot
	record("regen preserves a foreign-tagged injected user Part", function()
		userChild = Instance.new("Part")
		userChild.Name = "UserInjectedChild"
		userChild.Anchored = true
		userChild.Size = Vector3.new(0.7, 0.8, 0.9)
		userChild.CFrame = CFrame.new(33, 44, 55) * CFrame.Angles(math.rad(11), math.rad(22), math.rad(33))
		userChild:SetAttribute("BuildKitGenerated", true)
		userChild:SetAttribute("BuildKitOwned", true)
		userChild:SetAttribute("BuildKitBuildId", "foreign-build")
		userChild.Parent = model
		local userPivot = model:GetPivot() * CFrame.Angles(math.rad(-13), math.rad(27), math.rad(9))
		model:PivotTo(userPivot)
		userChildAfterPivot = userChild.CFrame
		assert(not cfClose(userChildAfterPivot, CFrame.new(33, 44, 55)), "user Part did not follow the intentional model PivotTo")
		local oldAnchor = findPart("Anchor")
		model:SetAttribute("Scale", 1.5)
		assert(waitUntil(function()
			local anchor = model:FindFirstChild("Anchor", true)
			return anchor and anchor ~= oldAnchor and vecClose(anchor.Size, Vector3.new(3, 1.5, 3))
		end), "Scale=1.5 watcher regen did not complete")
		assert(userChild.Parent == model, "regen deleted the foreign-tagged user Part")
		assert(cfClose(userChild.CFrame, userChildAfterPivot), "regen moved the preserved user Part")
		assert(userChild:GetAttribute("BuildKitGenerated") == true, "regen changed the user Generated tag")
		assert(userChild:GetAttribute("BuildKitOwned") == true, "regen changed the user Owned tag")
		assert(userChild:GetAttribute("BuildKitBuildId") == "foreign-build", "regen claimed the foreign user Part")
	end)
	record("regen generated descendants retain ownership beside the user child", function()
		assert(userChild and userChild.Parent == model, "user-child preservation prerequisite failed")
		assertOwnedSubtree(model, userChild)
	end)
	record("update-existing refuses a mixed owned/unowned descendant subtree", function()
		assert(userChild and userChild.Parent == model, "mixed-subtree prerequisite failed")
		local beforeModel = model
		local ok, err = pcall(function()
			StageCommit.commit(request("update-existing", 1), buildOne)
		end)
		assert(not ok, "update-existing accepted a mixed owned/unowned subtree")
		assert(string.find(tostring(err), "mixed owned/unowned", 1, true), "unexpected refusal: " .. bounded(err))
		assert(root:FindFirstChild("RegenProp") == beforeModel, "failed update mutated the existing model")
		assert(userChild.Parent == beforeModel, "failed update removed the user child")
		assert(root:FindFirstChild("UserRootSibling") ~= nil, "failed update removed the root sibling")
	end)
end

local passed = true
local passedCount = 0
local failedCount = 0
for _, test in ipairs(tests) do
	if test.ok then
		passedCount += 1
	else
		passed = false
		failedCount += 1
	end
end

local output = {
	version = 1,
	ok = passed,
	passed = passedCount,
	failed = failedCount,
	buildId = buildId,
	rootName = rootName,
	tests = tests,
}
print("[test-regen-live] " .. HttpService:JSONEncode(output))

for _, child in ipairs(workspace:GetChildren()) do
	if child:IsA("Model") and child.Name == rootName and child:GetAttribute("BuildKitBuildId") == buildId then
		child:Destroy()
	end
end

return HttpService:JSONEncode(output)
