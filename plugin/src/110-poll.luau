--#region imports (generated — do not hand-edit)
local plugin = require(script.Parent.Ctx).plugin
local Core = require(script.Parent.Core)
local HttpService = Core.HttpService
local BASE = Core.BASE
local PLACE = Core.PLACE
local BRIDGE_TOKEN = Core.BRIDGE_TOKEN
local handlers = require(script.Parent.Handlers).handlers
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
	pcall(function()
		HttpService:RequestAsync({
			Url = BASE .. path,
			Method = "POST",
			Headers = reqHeaders(),
			Body = HttpService:JSONEncode(body),
		})
	end)
end

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
return { post = post, CONFIG_DEFAULTS = CONFIG_DEFAULTS }
--#endregion
