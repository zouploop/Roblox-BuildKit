--!nocheck
--#region imports (generated — do not hand-edit)
local plugin = require(script.Parent.Ctx).plugin
local post = require(script.Parent.Poll).post
local CONFIG_DEFAULTS = require(script.Parent.Poll).CONFIG_DEFAULTS
local configureLiveSync = require(script.Parent.Poll).configureLiveSync
local toolbar = require(script.Parent.Toolbar).toolbar
--#endregion

-- ---------- settings dock widget --------------------------------------------
-- A dockable panel for connection creds (Open Cloud key, Creator ID, ComfyUI URL,
-- Hunyuan endpoint) + build-mode toggles. Persists locally via plugin:SetSetting and
-- pushes config to the MCP server over the bridge (POST /config) so the server can do
-- Open Cloud mesh uploads + reach ComfyUI. The key never lands in a place file.
local function getS(k, d) local v = plugin:GetSetting("bk_" .. k); if v == nil then return d end return v end
local function setS(k, v) plugin:SetSetting("bk_" .. k, v) end

local okWidget, widget = pcall(function()
	return plugin:CreateDockWidgetPluginGui("BuildKitSettings",
		DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Right, false, false, 340, 580, 300, 460))
end)
if okWidget and widget then
	widget.Title = "BuildKit Settings"
	local root = Instance.new("Frame")
	root.Size = UDim2.fromScale(1, 1); root.BackgroundColor3 = Color3.fromRGB(34, 36, 42); root.BorderSizePixel = 0; root.Parent = widget
	local scroll = Instance.new("ScrollingFrame")
	scroll.Size = UDim2.new(1, -12, 1, -52); scroll.Position = UDim2.fromOffset(6, 6); scroll.BackgroundTransparency = 1
	scroll.BorderSizePixel = 0; scroll.ScrollBarThickness = 6; scroll.CanvasSize = UDim2.new(0, 0, 0, 990); scroll.Parent = root
	local layout = Instance.new("UIListLayout"); layout.Padding = UDim.new(0, 5); layout.SortOrder = Enum.SortOrder.LayoutOrder; layout.Parent = scroll
	local ord = 0
	local function lbl(text, color, h)
		local t = Instance.new("TextLabel")
		t.Size = UDim2.new(1, 0, 0, h or 18); t.BackgroundTransparency = 1; t.Text = text
		t.TextColor3 = color or Color3.fromRGB(210, 212, 218); t.TextXAlignment = Enum.TextXAlignment.Left
		t.Font = Enum.Font.Gotham; t.TextSize = 13; ord = ord + 1; t.LayoutOrder = ord; t.Parent = scroll
		return t
	end
	local boxes = {}
	local function field(key, placeholder, default)
		lbl(placeholder, Color3.fromRGB(150, 152, 160), 15)
		local b = Instance.new("TextBox")
		b.Size = UDim2.new(1, 0, 0, 26); b.BackgroundColor3 = Color3.fromRGB(24, 26, 30); b.TextColor3 = Color3.fromRGB(230, 232, 238)
		b.Text = tostring(getS(key, default or CONFIG_DEFAULTS[key] or "")); b.ClearTextOnFocus = false; b.Font = Enum.Font.Code; b.TextSize = 13
		b.TextXAlignment = Enum.TextXAlignment.Left; b.PlaceholderText = placeholder; ord = ord + 1; b.LayoutOrder = ord; b.Parent = scroll
		local pad = Instance.new("UIPadding"); pad.PaddingLeft = UDim.new(0, 6); pad.Parent = b
		boxes[key] = b
	end
	local toggles = {}
	local function toggleBtn(key, label, default)
		local on = getS(key, default)
		local btn2 = Instance.new("TextButton")
		btn2.Size = UDim2.new(1, 0, 0, 26); btn2.Font = Enum.Font.GothamMedium; btn2.TextSize = 13; btn2.AutoButtonColor = false
		btn2.TextXAlignment = Enum.TextXAlignment.Left; ord = ord + 1; btn2.LayoutOrder = ord; btn2.Parent = scroll
		local pad = Instance.new("UIPadding"); pad.PaddingLeft = UDim.new(0, 8); pad.Parent = btn2
		local function paint()
			btn2.BackgroundColor3 = on and Color3.fromRGB(56, 132, 86) or Color3.fromRGB(46, 48, 54)
			btn2.TextColor3 = Color3.fromRGB(235, 237, 242); btn2.Text = (on and "[x]  " or "[  ]  ") .. label
		end
		paint()
		btn2.MouseButton1Click:Connect(function() on = not on; paint() end)
		toggles[key] = function() return on end
	end

	lbl("CONNECTIONS", Color3.fromRGB(120, 200, 255), 22)
	field("openCloudKey", "Open Cloud API key")
	field("creatorId", "Creator ID")
	field("creatorType", "Creator type (User/Group)")
	field("comfyUrl", "ComfyUI server URL (http://ip:8188)")
	field("hunyuanUrl", "Hunyuan3D endpoint (optional)")
	field("bridgeToken", "Bridge token (match server BRIDGE_TOKEN)")
	lbl("BUILD MODES", Color3.fromRGB(120, 200, 255), 22)
	toggleBtn("primitives", "Primitives (lightweight)", true)
	toggleBtn("officialGen", "Official AI gen (mesh/proc)", true)
	toggleBtn("meshRef", "Use meshes as reference", true)
	toggleBtn("localImport", "Local-gen import (ComfyUI+Hunyuan)", false)
	toggleBtn("autoQA", "Auto-QA every build", true)
	lbl("VIEWER SYNC", Color3.fromRGB(120, 200, 255), 22)
	field("liveSyncIntervalMs", "Viewer poll interval (ms)", 1500)
	toggleBtn("liveSync", "Auto-sync viewer", true)
	lbl("STATUS", Color3.fromRGB(120, 200, 255), 22)
	local statusLbl = lbl("not saved yet", Color3.fromRGB(180, 182, 190), 18)

	local bar = Instance.new("Frame")
	bar.Size = UDim2.new(1, -12, 0, 40); bar.Position = UDim2.new(0, 6, 1, -46); bar.BackgroundTransparency = 1; bar.Parent = root
	local function mkBtn(txt, col, xs)
		local b = Instance.new("TextButton"); b.Size = UDim2.new(0.5, -4, 1, 0); b.Position = UDim2.new(xs, xs > 0 and 4 or 0, 0, 0)
		b.BackgroundColor3 = col; b.TextColor3 = Color3.fromRGB(255, 255, 255); b.Font = Enum.Font.GothamBold; b.TextSize = 14; b.Text = txt; b.Parent = bar
		return b
	end
	local saveBtn = mkBtn("Save", Color3.fromRGB(70, 150, 235), 0)
	local testBtn = mkBtn("Test", Color3.fromRGB(60, 64, 72), 0.5)
	-- bridgeToken is bridge AUTH, matched between server + plugin — it must NOT be pushed
	-- to /config (that would send the secret over the very channel it protects). It lives
	-- only in plugin:SetSetting on each side.
	local LOCAL_ONLY = { bridgeToken = true, liveSync = true, liveSyncIntervalMs = true }
	local function gather()
		local cfg = { modes = {} }
		for k, b in pairs(boxes) do
			if not LOCAL_ONLY[k] then cfg[k] = b.Text end
		end
		for k, getter in pairs(toggles) do
			if not LOCAL_ONLY[k] then cfg.modes[k] = getter() end
		end
		return cfg
	end
	saveBtn.MouseButton1Click:Connect(function()
		for k, b in pairs(boxes) do setS(k, b.Text) end
		for k, getter in pairs(toggles) do setS(k, getter()) end
		local sync = configureLiveSync({ enabled = toggles.liveSync(), intervalMs = boxes.liveSyncIntervalMs.Text })
		boxes.liveSyncIntervalMs.Text = tostring(sync.intervalMs)
		post("/config", gather())
		statusLbl.Text = ("saved -> local config file; viewer autosync %s (%dms)"):format(sync.enabled and "on" or "off", sync.intervalMs)
		statusLbl.TextColor3 = Color3.fromRGB(120, 220, 140)
	end)
	testBtn.MouseButton1Click:Connect(function()
		post("/config", gather())
		statusLbl.Text = "config sent (check server / Test endpoints)"
		statusLbl.TextColor3 = Color3.fromRGB(220, 200, 120)
	end)

	local setBtn = toolbar:CreateButton("Settings", "BuildKit settings panel", "")
	setBtn.Click:Connect(function() widget.Enabled = not widget.Enabled end)
end

--#region exports (generated — do not hand-edit)
return {}
--#endregion
