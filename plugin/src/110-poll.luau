--!nocheck
--#region imports (generated — do not hand-edit)
local plugin = require(script.Parent.Ctx).plugin
local Core = require(script.Parent.Core)
local HttpService = Core.HttpService
local BASE = Core.BASE
local PLACE = Core.PLACE
local BRIDGE_TOKEN = Core.BRIDGE_TOKEN
local handlers = require(script.Parent.Handlers).handlers
local sceneDump = require(script.Parent.Geometry).sceneDump
local findInst = require(script.Parent.Geometry).findInst
local bboxOf = require(script.Parent.Geometry).bboxOf
local partsOf = require(script.Parent.Geometry).partsOf
local r1 = require(script.Parent.Geometry).r1
--#endregion

-- ---------- long-poll loop ---------------------------------------------------
-- Optional shared-secret bridge auth: must match the server's BRIDGE_TOKEN (env) or
-- config "bridgeToken". Blank = legacy trust boundary (localhost, any local process).
-- When set, the plugin sends it on every request AND only auto-pushes config after a
-- poll answers X-BuildKit-Auth: ok — so secrets never go to an unverified listener.
-- (BRIDGE_TOKEN itself is declared at the top of the chunk; reqHeaders is scoped here
-- because only the poll loop + settings panel need it.)
local function reqHeaders()
	local h = { ["Content-Type"] = "application/json" }
	if BRIDGE_TOKEN ~= "" then
		h["X-BuildKit-Token"] = BRIDGE_TOKEN
	end
	return h
end

local function post(path, body)
	local ok, res = pcall(function()
		HttpService:RequestAsync({
			Url = BASE .. path,
			Method = "POST",
			Headers = reqHeaders(),
			Body = HttpService:JSONEncode(body),
		})
	end)
	return ok and res and res.Success == true
end

-- Keep the live-sync contract at the plugin boundary too. Node validates the same
-- shape, but the bridge is a local trust boundary and callers can still send commands
-- directly. A missing scoped target is an empty scene, not a stale mirror.
local MAX_SYNC_PARTS = 800
local function finiteNumber(value)
	return type(value) == "number" and value == value and value < math.huge and value > -math.huge
end

local function vector3Table(value, label)
	if type(value) ~= "table" or #value ~= 3 or not finiteNumber(value[1]) or not finiteNumber(value[2]) or not finiteNumber(value[3]) then
		error(label .. " must be [x,y,z] finite numbers")
	end
	return { value[1], value[2], value[3] }
end

local function clampParts(value, fallback)
	if value == nil then return fallback end
	local n = tonumber(value)
	if not n or n ~= n then error("sync maxParts must be a positive integer") end
	return math.min(MAX_SYNC_PARTS, math.max(1, math.floor(n)))
end

local function normalizeScope(args, previous)
	args = args or {}
	local nextScope = {
		target = previous.target,
		region = previous.region,
		lod = previous.lod,
		maxParts = previous.maxParts,
	}
	if args.target ~= nil and args.region ~= nil then
		error("sync scope accepts target or region, not both")
	elseif args.target ~= nil then
		if type(args.target) ~= "string" or args.target == "" then error("sync target must be a non-empty string") end
		nextScope.target = args.target
		nextScope.region = nil
	elseif args.region ~= nil then
		if type(args.region) ~= "table" then error("sync region must be an object") end
		local raw = args.region
		if raw.center ~= nil or raw.radius ~= nil then
			if raw.radius == nil or not finiteNumber(raw.radius) or raw.radius <= 0 then error("sync region radius must be positive") end
			nextScope.region = { center = vector3Table(raw.center, "sync region center"), radius = raw.radius }
		elseif raw.min ~= nil or raw.max ~= nil then
			local min = vector3Table(raw.min, "sync region min")
			local max = vector3Table(raw.max, "sync region max")
			for i = 1, 3 do if min[i] > max[i] then error("sync region min must not exceed max") end end
			nextScope.region = { min = min, max = max }
		else
			error("sync region must be center/radius or min/max")
		end
		nextScope.target = nil
	end
	if args.lod ~= nil then
		if args.lod ~= "parts" and args.lod ~= "bbox" then error("sync lod must be parts or bbox") end
		nextScope.lod = args.lod
	end
	nextScope.maxParts = clampParts(args.maxParts, nextScope.maxParts)
	return nextScope
end

local savedTarget = plugin:GetSetting("bk_liveSyncTarget")
local savedLod = plugin:GetSetting("bk_liveSyncLod")
local savedMaxParts = plugin:GetSetting("bk_liveSyncMaxParts")
local liveSyncScope = normalizeScope({
	target = (type(savedTarget) == "string" and savedTarget ~= "") and savedTarget or "workspace",
	lod = savedLod == "bbox" and "bbox" or "parts",
	maxParts = savedMaxParts,
}, { target = "workspace", lod = "parts", maxParts = MAX_SYNC_PARTS })

local function emptyDump(scope, coverage)
	return {
		parts = {},
		totalParts = 0,
		dumped = 0,
		truncated = false,
		coverage = coverage or "missing",
		lod = scope.lod,
		scope = scope,
	}
end

local function inRegion(pos, region)
	if not region then return true end
	if region.radius then
		local dx, dy, dz = pos[1] - region.center[1], pos[2] - region.center[2], pos[3] - region.center[3]
		return dx * dx + dy * dy + dz * dz <= region.radius * region.radius
	end
	return pos[1] >= region.min[1] and pos[1] <= region.max[1]
		and pos[2] >= region.min[2] and pos[2] <= region.max[2]
		and pos[3] >= region.min[3] and pos[3] <= region.max[3]
end

local function bboxOfRegion(inst, region)
	local min, max
	local count = 0
	for _, part in ipairs(partsOf(inst)) do
		local position = part.Position
		if inRegion({ position.X, position.Y, position.Z }, region) then
			count += 1
			local half = part.Size / 2
			local right, up, look = part.CFrame.RightVector, part.CFrame.UpVector, part.CFrame.LookVector
			local extent = Vector3.new(
				math.abs(right.X) * half.X + math.abs(up.X) * half.Y + math.abs(look.X) * half.Z,
				math.abs(right.Y) * half.X + math.abs(up.Y) * half.Y + math.abs(look.Y) * half.Z,
				math.abs(right.Z) * half.X + math.abs(up.Z) * half.Y + math.abs(look.Z) * half.Z
			)
			local low, high = position - extent, position + extent
			if not min then
				min, max = low, high
			else
				min = Vector3.new(math.min(min.X, low.X), math.min(min.Y, low.Y), math.min(min.Z, low.Z))
				max = Vector3.new(math.max(max.X, high.X), math.max(max.Y, high.Y), math.max(max.Z, high.Z))
			end
		end
	end
	if not min then return nil, nil, count end
	return (min + max) / 2, max - min, count
end

local function bboxDump(inst, scope)
	local center, size, totalParts
	if scope.region then
		center, size, totalParts = bboxOfRegion(inst, scope.region)
		if not center then return emptyDump(scope, "complete") end
	else
		center, size = bboxOf(inst)
		totalParts = #partsOf(inst)
	end
	local path = inst:GetFullName()
	return {
		parts = {{
			name = inst.Name,
			class = inst.ClassName,
			shape = "box",
			pos = { r1(center.X), r1(center.Y), r1(center.Z) },
			rot = { 0, 0, 0 },
			size = { r1(size.X), r1(size.Y), r1(size.Z) },
			color = { 128, 128, 128 },
			material = "SmoothPlastic",
			anchored = true,
			path = path,
			fullPath = path,
			relativePath = "",
		}},
		totalParts = totalParts,
		dumped = 1,
		truncated = false,
		coverage = "complete",
		lod = "bbox",
		scope = scope,
	}
end

local function scopedSceneDump(args, allowMissing)
	local scope = normalizeScope(args or {}, { target = "workspace", lod = "parts", maxParts = MAX_SYNC_PARTS })
	local inst
	if args and (args.selection == true or args.target == "selection") then
		local selected = game:GetService("Selection"):Get()
		inst = selected[1]
		scope.target = "selection"
		scope.region = nil
	else
		inst = findInst(scope.target or "workspace") or (scope.region and workspace)
	end
	if not inst then
		if allowMissing then return emptyDump(scope) end
		error("target not found: " .. tostring(scope.target))
	end
	if scope.lod == "bbox" then return bboxDump(inst, scope) end
	local dump = sceneDump(inst, scope.maxParts, scope.region and function(part)
		local position = part.Position
		return inRegion({ position.X, position.Y, position.Z }, scope.region)
	end or nil)
	if scope.region then
		-- The hierarchy was built before the region filter; omit it rather than expose
		-- a tree that contains nodes outside the requested scope.
		dump.tree = nil
	end
	dump.lod = scope.lod
	dump.scope = scope
	return dump
end

-- Extend the existing command without changing the generated handler module. This
-- keeps scene_dump's normal error semantics while giving live sync the missing-target
-- behavior above.
handlers.scene_dump = function(args)
	return scopedSceneDump(args, false)
end

-- The plugin owns the autosync timer. It reads the Edit datamodel directly, then pushes
-- changed snapshots to the MCP bridge; the Node side only persists/fans them out to SSE.
local LIVE_SYNC_DEFAULT_INTERVAL_MS = 1500
local LIVE_SYNC_MIN_INTERVAL_MS = 100
local LIVE_SYNC_MAX_INTERVAL_MS = 60000
local function clampLiveSyncInterval(value)
	return math.clamp(math.floor((tonumber(value) or LIVE_SYNC_DEFAULT_INTERVAL_MS) + 0.5), LIVE_SYNC_MIN_INTERVAL_MS, LIVE_SYNC_MAX_INTERVAL_MS)
end
local liveSyncEnabled = plugin:GetSetting("bk_liveSync") ~= false
local liveSyncIntervalMs = clampLiveSyncInterval(plugin:GetSetting("bk_liveSyncIntervalMs"))
local mirrorJson = nil

local function configureLiveSync(args)
	args = args or {}
	if args.enabled ~= nil then liveSyncEnabled = args.enabled == true end
	if args.intervalMs ~= nil then liveSyncIntervalMs = clampLiveSyncInterval(args.intervalMs) end
	if args.target ~= nil or args.region ~= nil or args.lod ~= nil or args.maxParts ~= nil then
		liveSyncScope = normalizeScope(args, liveSyncScope)
		plugin:SetSetting("bk_liveSyncTarget", liveSyncScope.target or "")
		plugin:SetSetting("bk_liveSyncLod", liveSyncScope.lod)
		plugin:SetSetting("bk_liveSyncMaxParts", liveSyncScope.maxParts)
	end
	plugin:SetSetting("bk_liveSync", liveSyncEnabled)
	plugin:SetSetting("bk_liveSyncIntervalMs", liveSyncIntervalMs)
	-- Re-enable/reconfigure sends a fresh snapshot, including after a bridge restart.
	mirrorJson = nil
	local result = { enabled = liveSyncEnabled, intervalMs = liveSyncIntervalMs, lod = liveSyncScope.lod, maxParts = liveSyncScope.maxParts }
	if liveSyncScope.target then result.target = liveSyncScope.target else result.region = liveSyncScope.region end
	return result
end

-- rbx_live_sync_start/stop use the normal command path to control this plugin-side loop.
handlers.live_sync = configureLiveSync

local function pushMirror()
	local ok, dump = pcall(function() return scopedSceneDump(liveSyncScope, true) end)
	if not ok then return false end
	local okJson, json = pcall(function() return HttpService:JSONEncode(dump) end)
	if not okJson then return false end
	if json == mirrorJson then return true end
	if post("/mirror", { place = PLACE, dump = dump }) then
		mirrorJson = json
		return true
	end
	return false
end

task.spawn(function()
	local backoff = 1.0
	while true do
		if not Core.RUNNING or not liveSyncEnabled then
			task.wait(0.5)
		else
			local ok = pushMirror()
			local waitFor = liveSyncIntervalMs / 1000
			if ok then
				backoff = 1.0
			else
				waitFor = math.max(waitFor, backoff)
				backoff = math.min(backoff * 2, 10)
			end
			task.wait(waitFor)
		end
	end
end)

-- Config defaults so the Settings panel is pre-filled and the bridge gets seeded AUTOMATICALLY
-- on first connect — no manual Save needed. plugin:GetSetting overrides these once the user edits.
-- SECURITY: openCloudKey is intentionally BLANK here — never hardcode it. Paste it into the
-- BuildKit Settings panel (it lives only in plugin:SetSetting + the in-memory /config bridge,
-- never in this source, the .rbxmx artifact, or any place/game file).
local CONFIG_FIELDS = { "openCloudKey", "creatorId", "creatorType", "comfyUrl", "hunyuanUrl" }
local CONFIG_DEFAULTS = {
	openCloudKey = "",
	creatorId = "0",
	creatorType = "User",
	comfyUrl = "http://127.0.0.1:8000",
	hunyuanUrl = "",
}
local CONFIG_MODES = { "primitives", "officialGen", "meshRef", "localImport", "autoQA" }
local function cfgGet(k, d)
	local v = plugin:GetSetting("bk_" .. k)
	if v == nil or v == "" then return d end
	return v
end
local function readSavedConfig()
	local cfg = { modes = {} }
	for _, k in ipairs(CONFIG_FIELDS) do
		local v = cfgGet(k, CONFIG_DEFAULTS[k])
		if v ~= nil then cfg[k] = v end
	end
	for _, m in ipairs(CONFIG_MODES) do
		cfg.modes[m] = (plugin:GetSetting("bk_" .. m) ~= false)
	end
	return cfg
end
local configPushed = false
local function pushSavedConfig()
	configPushed = true
	post("/config", readSavedConfig())
end

task.spawn(function()
	local backoff = 1.0
	while true do
	if not Core.RUNNING then
			task.wait(0.5)
			continue
		end
		local ok, res = pcall(function()
			return HttpService:RequestAsync({
				Url = BASE .. "/poll?place=" .. HttpService:UrlEncode(PLACE),
				Method = "GET",
				Headers = reqHeaders(),
			})
		end)
		if ok and res and res.Success then
			backoff = 1.0 -- server answered; reset the failure backoff
			local authed = BRIDGE_TOKEN == "" or tostring(res.Headers and res.Headers["x-buildkit-auth"]) == "ok"
			if authed and not configPushed then
				pushSavedConfig() -- seed the MCP bridge with saved/default creds once it's reachable
			end
			if res.Body and #res.Body > 0 then
				local okd, cmd = pcall(function()
					return HttpService:JSONDecode(res.Body)
				end)
				if okd and cmd and cmd.id then
					local handler = handlers[cmd.action]
					local result, err
					if handler then
						local ok2, r = pcall(handler, cmd.args or {})
						if ok2 then
							result = r
						else
							err = tostring(r) .. "\n" .. tostring(debug.traceback("", 2))
						end
					else
						err = "unknown action: " .. tostring(cmd.action)
					end
					post("/result", { id = cmd.id, ok = (err == nil), result = result, error = err })
				elseif not okd then
					-- A command we can't decode still needs an answer, else the server
					-- waits on it forever. Report it so the tool gets a real error.
					post("/result", { ok = false, error = "plugin could not decode command: " .. tostring(res.Body) })
				end
			else
				-- Empty long-poll timeout: nothing to do, loop immediately for the next poll.
				-- (Tiny yield so a server that answers instantly with "" can't make a hot loop.)
				task.wait(0.1)
			end
		else
			-- Server down: re-seed config the next time it answers (its in-memory config
			-- died with the process), then back off exponentially to avoid hammering.
			configPushed = false
			task.wait(backoff)
			backoff = math.min(backoff * 2, 10)
		end
	end
end)

--#region exports (generated — do not hand-edit)
return { post = post, configureLiveSync = configureLiveSync, CONFIG_DEFAULTS = CONFIG_DEFAULTS }
--#endregion
