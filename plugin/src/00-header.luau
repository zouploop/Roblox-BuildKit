--!nocheck
-- BuildKitPlugin: long-polls the roblox-buildkit MCP server and runs build/camera
-- commands in the Edit datamodel. Pair with the roblox-buildkit-mcp Node server.
-- Drop this file in: %LOCALAPPDATA%\Roblox\Plugins\

local HttpService = game:GetService("HttpService")
local Lighting = game:GetService("Lighting")
local ChangeHistoryService = game:GetService("ChangeHistoryService")

local BASE = "http://127.0.0.1:44760"
local PLACE = tostring(game.Name)
local RUNNING = true

-- Optional shared-secret bridge auth: must match the server's BRIDGE_TOKEN (env) or
-- config "bridgeToken". Blank = legacy trust boundary (localhost, any local process).
-- When set, the plugin sends it on every request AND only auto-pushes config after a
-- poll answers X-BuildKit-Auth: ok — so secrets never go to an unverified listener.
-- Declared here (top of the chunk) because runtime_install, far below, bakes it into
-- the embedded runtime harness.
local BRIDGE_TOKEN = tostring(plugin:GetSetting("bk_bridgeToken") or "")

-- Source for the LAST-RESORT in-game runtime harness (rbx_runtime install drops
-- this as a Script into ServerScriptService so it runs during Play). Polls the
-- bridge with ctx=runtime and runs rbx_run code via loadstring. Prefer the official
-- execute_luau(Server/Client); this only earns its keep as a persistent/parallel
-- in-game channel, and needs ServerScriptService.LoadStringEnabled ticked + HTTP on.
-- Every command is pcall-guarded (incl. the loadstring call) so the poll loop can
-- never die — a disabled loadstring just returns a clear error.
-- __BRIDGE_TOKEN__ is replaced by runtime_install with the plugin's configured token.
local RUNTIME_SOURCE = [==[
-- BuildKitRuntime (installed by rbx_runtime). Runs in the PLAY datamodel.
local HttpService = game:GetService("HttpService")
local BASE = "http://127.0.0.1:44760"
local PLACE = tostring(game.Name)
local BRIDGE_TOKEN = "__BRIDGE_TOKEN__"

local function reqHeaders()
	local h = { ["Content-Type"] = "application/json" }
	if BRIDGE_TOKEN ~= "" and BRIDGE_TOKEN ~= "__BRIDGE_TOKEN__" then
		h["X-BuildKit-Token"] = BRIDGE_TOKEN
	end
	return h
end

local MAXNODES = 500
local function safe(v, depth, budget)
	local t = typeof(v)
	if t == "number" or t == "string" or t == "boolean" or t == "nil" then
		return v
	elseif t == "table" and depth < 5 then
		local o = {}
		for k, val in pairs(v) do
			if budget.n >= MAXNODES then
				o.__truncated = true
				break
			end
			budget.n += 1
			o[tostring(k)] = safe(val, depth + 1, budget)
		end
		return o
	end
	return tostring(v)
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

local function handle(cmd)
	if cmd.action == "ping" then
		return { pong = true, place = game.Name, ctx = "runtime" }, nil
	elseif cmd.action == "eval" then
		local code = (cmd.args or {}).code or ""
		-- loadstring() THROWS (not nil) when LoadStringEnabled is off, so pcall it.
		local ok0, fn, loaderr = pcall(loadstring, code)
		if not ok0 then
			return nil, "loadstring unavailable — tick ServerScriptService.LoadStringEnabled in Properties, then replay (" .. tostring(fn) .. ")"
		elseif not fn then
			return nil, "compile: " .. tostring(loaderr)
		end
		local ok2, r = pcall(fn)
		if not ok2 then
			return nil, tostring(r)
		end
		return safe(r, 0, { n = 0 }), nil
	end
	return nil, "unknown runtime action: " .. tostring(cmd.action)
end

task.spawn(function()
	local backoff = 1.0
	while true do
		local ok, res = pcall(function()
			return HttpService:RequestAsync({
				Url = BASE .. "/poll?place=" .. HttpService:UrlEncode(PLACE) .. "&ctx=runtime",
				Method = "GET",
				Headers = reqHeaders(),
			})
		end)
		if ok and res and res.Success and res.Body and #res.Body > 0 then
			backoff = 1.0
			local okd, cmd = pcall(function()
				return HttpService:JSONDecode(res.Body)
			end)
			if okd and cmd and cmd.id then
				-- pcall handle() too: nothing a command does can kill the loop.
				local okh, result, err = pcall(handle, cmd)
				if not okh then
					post("/result", { id = cmd.id, ok = false, error = "runtime error: " .. tostring(result) })
				else
					post("/result", { id = cmd.id, ok = (err == nil), result = result, error = err })
				end
			elseif not okd then
				post("/result", { ok = false, error = "runtime could not decode command: " .. tostring(res.Body) })
			end
		elseif ok and res and res.Success then
			task.wait(0.1) -- empty long-poll timeout; avoid a hot loop
		else
			task.wait(backoff)
			backoff = math.min(backoff * 2, 10)
		end
	end
end)

print("[BuildKitRuntime] live (last-resort harness), polling " .. BASE)
]==]

-- Wrap a mutating action in a ChangeHistoryService recording so Studio's native
-- Ctrl+Z (and rbx_undo) can revert it as one step. Falls back to running fn
-- directly if a recording can't be opened (e.g. one already in progress).
local function recorded(name, fn)
	local id
	local okBegin = pcall(function()
		id = ChangeHistoryService:TryBeginRecording(name, name)
	end)
	local ok, res = pcall(fn)
	if okBegin and id then
		pcall(function()
			ChangeHistoryService:FinishRecording(
				id,
				ok and Enum.FinishRecordingOperation.Commit or Enum.FinishRecordingOperation.Cancel
			)
		end)
	end
	if not ok then
		error(res)
	end
	return res
end

