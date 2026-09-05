--!nocheck
--#region imports (generated — do not hand-edit)
local Core = require(script.Parent.Core)
local Detail = require(script.Parent.Detail)
local recorded = Core.recorded
--#endregion

-- A Stage commit is deliberately narrower than batch. It owns one stable root and
-- only accepts build operations, so an update can be constructed privately and
-- swapped without guessing which user object a name refers to.
local MAX_STAGE_ITEMS = 5000
local BUILD_KINDS = {
	slab = true, room = true, stairs = true, cabinet = true, table = true, shelf = true,
	bed = true, chair = true, sofa = true, armchair = true, desk = true, nightstand = true,
	dresser = true, wardrobe = true, fridge = true, stove = true, toilet = true,
	bathtub = true, prop = true,
}
local activeToken = nil

-- Builders can yield while CSG completes. Keep the private Detail context and the
-- target snapshot exclusive across that yield; a second build fails closed instead
-- of accidentally writing into another transaction's candidate.
local function enter(context)
	if context ~= nil then
		if activeToken ~= context then error("BuildKit build transaction is busy") end
		return context
	end
	if activeToken then error("BuildKit build transaction is busy") end
	local token = {}
	activeToken = token
	return token
end

local function leave(token)
	if activeToken == token then activeToken = nil end
end

local function finite(value)
	return type(value) == "number" and value == value and value < math.huge and value > -math.huge
end

local function arrayCount(value, label)
	if type(value) ~= "table" then error(label .. " must be an array") end
	local count = #value
	for key in pairs(value) do
		if type(key) ~= "number" or key < 1 or key ~= math.floor(key) or key > count then
			error(label .. " must be a dense array")
		end
	end
	return count
end

local function vector(value, label, positive)
	if arrayCount(value, label) ~= 3 then error(label .. " must be [x,y,z]") end
	for i = 1, 3 do
		if not finite(value[i]) or (positive and value[i] <= 0) then
			error(label .. " must contain finite " .. (positive and "positive " or "") .. "numbers")
		end
	end
end

local function validateBuildSpec(spec, index)
	if type(spec) ~= "table" then error("stage commit op " .. index .. ": build args must be an object") end
	if not BUILD_KINDS[spec.kind] then error("stage commit op " .. index .. ": unknown build kind: " .. tostring(spec.kind)) end
	vector(spec.center, "stage commit op " .. index .. " center")
	if spec.kind ~= "prop" then
		vector(spec.size, "stage commit op " .. index .. " size", true)
	elseif spec.parts ~= nil then
		arrayCount(spec.parts, "stage commit op " .. index .. ": prop parts")
		for partIndex, part in ipairs(spec.parts) do
			if type(part) ~= "table" then error("stage commit op " .. index .. " part " .. partIndex .. " must be an object") end
			vector(part.size, "stage commit op " .. index .. " part " .. partIndex .. " size", true)
			if part.pos ~= nil then vector(part.pos, "stage commit op " .. index .. " part " .. partIndex .. " pos") end
		end
	end
	if spec.parent ~= nil and type(spec.parent) ~= "string" then error("stage commit op " .. index .. ": parent must be a string") end
	if spec.name ~= nil and type(spec.name) ~= "string" then error("stage commit op " .. index .. ": name must be a string") end
end

local function validateRequest(args)
	if type(args) ~= "table" then error("stage commit request must be an object") end
	if args.mode ~= "append" and args.mode ~= "update-existing" then
		error("stage commit mode must be 'append' or 'update-existing'")
	end
	if type(args.buildId) ~= "string" or #args.buildId < 1 or #args.buildId > 64
		or not string.match(args.buildId, "^[A-Za-z0-9][A-Za-z0-9_-]*$") then
		error("stage commit buildId must be 1-64 letters, numbers, underscores, or hyphens")
	end
	if args.rootName ~= nil then
		if type(args.rootName) ~= "string" or #args.rootName < 1 or #args.rootName > 100
			or string.find(args.rootName, "[%c]") then
			error("stage commit rootName must be 1-100 printable characters")
		end
	end
	if arrayCount(args.ops, "stage commit ops") == 0 then error("stage commit needs a non-empty ops array") end
	local items = #args.ops
	for index, op in ipairs(args.ops) do
		if type(op) ~= "table" or op.action ~= "build" then
			error("stage commit op " .. index .. ": only build operations are supported")
		end
		validateBuildSpec(op.args, index)
		if type(op.args.parts) == "table" then items = items + #op.args.parts end
		if items > MAX_STAGE_ITEMS then error("stage commit exceeds the " .. MAX_STAGE_ITEMS .. "-item cap") end
	end
	return args
end


local function withBuildParent(parent, token, fn)
	if Detail._buildParent ~= nil then error("private Stage commit build context is already active") end
	if token == nil then error("private Stage commit build context has no transaction token") end
	if activeToken ~= token then error("private Stage commit transaction token is not active") end
	local previous = Detail._buildParent
	local previousCreated = Detail._buildCreated
	local previousThread = Detail._buildThread
	local created = {}
	Detail._buildParent = parent
	Detail._buildCreated = created
	Detail._buildThread = coroutine.running()
	local ok, result = pcall(fn)
	Detail._buildParent = previous
	Detail._buildCreated = previousCreated
	Detail._buildThread = previousThread
	if not ok then error(result) end
	return result, created
end

local function markOwned(instance, buildId)
	instance:SetAttribute("BuildKitBuildId", buildId)
	instance:SetAttribute("BuildKitOwned", true)
	for _, descendant in ipairs(instance:GetDescendants()) do
		descendant:SetAttribute("BuildKitBuildId", buildId)
		descendant:SetAttribute("BuildKitOwned", true)
	end
end

local function findRoot(buildId)
	local found = nil
	for _, child in ipairs(workspace:GetChildren()) do
		if child:GetAttribute("BuildKitBuildId") == buildId then
			if not child:IsA("Model") or child:GetAttribute("BuildKitBuildRoot") ~= true then
				error("stage commit buildId is attached to a non-managed root: " .. buildId)
			end
			if found then error("stage commit buildId has multiple managed roots: " .. buildId) end
			found = child
		end
	end
	return found
end

local function ensureNameAvailable(name, existing)
	for _, child in ipairs(workspace:GetChildren()) do
		if child ~= existing and child.Name == name then
			error("stage commit root name is already used by another object: " .. name)
		end
	end
end

local function assertOwnedSubtree(instance, buildId)
	if instance:GetAttribute("BuildKitBuildId") ~= buildId or instance:GetAttribute("BuildKitOwned") ~= true then
		error("stage commit found an unowned child with buildId: " .. buildId)
	end
	for _, descendant in ipairs(instance:GetDescendants()) do
		if descendant:GetAttribute("BuildKitBuildId") ~= buildId or descendant:GetAttribute("BuildKitOwned") ~= true then
			error("stage commit refuses a mixed owned/unowned subtree for buildId: " .. buildId)
		end
	end
end

local function collectOwned(root, buildId)
	local owned = {}
	for _, child in ipairs(root:GetChildren()) do
		if child:GetAttribute("BuildKitBuildId") == buildId then
			assertOwnedSubtree(child, buildId)
			table.insert(owned, child)
		else
			for _, descendant in ipairs(child:GetDescendants()) do
				if descendant:GetAttribute("BuildKitBuildId") == buildId then
					error("stage commit found buildId nested under an unrelated child: " .. buildId)
				end
			end
		end
	end
	return owned
end

local function sameInstances(a, b)
	if #a ~= #b then return false end
	local seen = {}
	for _, instance in ipairs(a) do seen[instance] = true end
	for _, instance in ipairs(b) do
		if not seen[instance] then return false end
	end
	return true
end

local function buildCandidate(request, buildOne, token)
	local candidate = Instance.new("Model")
	candidate.Name = "__BuildKitStageCandidate_" .. request.buildId
	local results = {}
	local ok, failure = pcall(function()
		for index, op in ipairs(request.ops) do
			local result, created = withBuildParent(candidate, token, function()
				return buildOne(op.args, token)
			end)
			if #created ~= 1 then error("stage commit op " .. index .. " did not create exactly one build root") end
			local model = created[1]
			if not model:IsDescendantOf(candidate) then error("stage commit op " .. index .. " escaped its private candidate") end
			results[index] = result
			markOwned(model, request.buildId)
		end
	end)
	if not ok then
		candidate:Destroy()
		error(failure)
	end
	return candidate, results
end

local function rollback(root, rootCreated, candidate, backup, moved, added)
	for index = #added, 1, -1 do
		local child = added[index]
		if child.Parent == root then child.Parent = candidate end
	end
	for index = #moved, 1, -1 do
		local child = moved[index]
		if child.Parent == backup then child.Parent = root end
	end
	if rootCreated and root then
		root.Parent = nil
		root:Destroy()
	end
	if candidate then candidate:Destroy() end
	if backup then backup:Destroy() end
end

local function revalidateTarget(existing, request, initialName, initialOwned, rootName)
	local current = findRoot(request.buildId)
	if current ~= existing then error("stage commit target changed while building; retry the same buildId") end
	if existing then
		if existing.Parent ~= workspace then error("stage commit target is no longer a direct Workspace root") end
		if existing.Name ~= initialName then error("stage commit target name changed while building; retry") end
		if request.rootName and request.rootName ~= existing.Name then error("stage commit rootName does not match the existing buildId root") end
		local currentOwned = collectOwned(existing, request.buildId)
		if not sameInstances(initialOwned, currentOwned) then
			error("stage commit target children changed while building; retry the same buildId")
		end
		return currentOwned
	end
	ensureNameAvailable(rootName, nil)
	return {}
end

local function apply(request, buildOne, token)
	local existing = findRoot(request.buildId)
	if request.mode == "append" and existing then
		error("stage commit buildId already exists; use update-existing: " .. request.buildId)
	end
	if existing and request.rootName and request.rootName ~= existing.Name then
		error("stage commit rootName does not match the existing buildId root")
	end

	local initialName = existing and existing.Name or nil
	local initialOwned = existing and collectOwned(existing, request.buildId) or {}
	local rootName = request.rootName or ("BuildKit_" .. request.buildId)
	if not existing then ensureNameAvailable(rootName, nil) end

	local candidate, results = buildCandidate(request, buildOne, token)
	local revalidateOk, oldOwnedOrFailure = pcall(function()
		return revalidateTarget(existing, request, initialName, initialOwned, rootName)
	end)
	if not revalidateOk then
		local cleanupOk, cleanupFailure = pcall(function() candidate:Destroy() end)
		if not cleanupOk then error(tostring(oldOwnedOrFailure) .. " (candidate cleanup failed: " .. tostring(cleanupFailure) .. ")") end
		error(oldOwnedOrFailure)
	end
	local oldOwned = oldOwnedOrFailure
	local root = existing
	local rootCreated = false
	local backup = nil
	local moved, added = {}, {}
	local swapOk, swapFailure = pcall(function()
		if not root then
			ensureNameAvailable(rootName, nil)
			root = Instance.new("Model")
			rootCreated = true
			root.Name = rootName
			root:SetAttribute("BuildKitBuildId", request.buildId)
			root:SetAttribute("BuildKitBuildRoot", true)
			root:SetAttribute("BuildKitManaged", true)
		end
		backup = Instance.new("Folder")
		if rootCreated then
			root.Parent = workspace
		else
			for _, child in ipairs(oldOwned) do
				child.Parent = backup
				table.insert(moved, child)
			end
		end
		for _, child in ipairs(candidate:GetChildren()) do
			child.Parent = root
			table.insert(added, child)
		end
	end)
	if not swapOk then
		local rollbackOk, rollbackFailure = pcall(function()
			rollback(root, rootCreated, candidate, backup, moved, added)
		end)
		if not rollbackOk then error(tostring(swapFailure) .. " (stage commit rollback failed: " .. tostring(rollbackFailure) .. ")") end
		error(swapFailure)
	end

	-- The reversible swap is complete. Destruction is deliberately outside that
	-- boundary: if Studio ever reports a cleanup error after one old child is
	-- destroyed, restoring the old subtree would be false and unsafe.
	local warnings = {}
	local backupOk, backupFailure = pcall(function() backup:Destroy() end)
	if not backupOk then
		table.insert(warnings, "old BuildKit geometry cleanup failed: " .. tostring(backupFailure))
		local recoveryName = "__BuildKitStageRecovery_" .. request.buildId
		local keepOk = pcall(function()
			ensureNameAvailable(recoveryName, nil)
			backup.Name = recoveryName
			backup.Parent = workspace
		end)
		if not keepOk then table.insert(warnings, "old geometry was retained in an unparented recovery buffer") end
	end
	local candidateOk, candidateFailure = pcall(function() candidate:Destroy() end)
	if not candidateOk then table.insert(warnings, "private candidate cleanup failed: " .. tostring(candidateFailure)) end
	return {
		mode = request.mode,
		buildId = request.buildId,
		root = { name = root.Name, path = root:GetFullName(), created = rootCreated, updated = not rootCreated },
		count = #request.ops,
		results = results,
		warnings = #warnings > 0 and warnings or nil,
	}
end

local function commit(args, buildOne)
	local request = validateRequest(args)
	if type(buildOne) ~= "function" then error("stage commit build callback is unavailable") end
	local token = enter()
	local ok, result = pcall(function()
		return recorded("BuildKit stage commit " .. request.buildId, function()
			return apply(request, buildOne, token)
		end)
	end)
	leave(token)
	if not ok then error(result) end
	return result
end

--#region exports (generated — do not hand-edit)
return { commit = commit, enter = enter, leave = leave }
--#endregion
