--!nocheck
--#region imports (generated — do not hand-edit)
local HttpService = require(script.Parent.Core).HttpService
--#endregion

-- ===== Parametric furniture: self-describing, editable, plugin-regenerated =======
-- Each built piece is TAGGED with its spec (Width/Height/Depth/Color attributes + a
-- BuildKitSpec JSON for nested fields). The plugin WATCHES these models and rebuilds
-- the geometry in place when an attribute changes — tweak a value in the Properties
-- panel and it regenerates. (A real engine ProceduralModel only renders when Roblox's
-- backend created it, so BuildKit acts as the engine here.)
local Parametric = {}
local PARAMETRIC_KINDS = {
	cabinet = true, table = true, shelf = true, bed = true, chair = true, sofa = true,
	armchair = true, desk = true, nightstand = true, dresser = true, wardrobe = true,
	fridge = true, stove = true, toilet = true, bathtub = true, prop = true,
}
local _watched, _pending, _regenBusy = {}, {}, {}
local REGEN_ATTRIBUTES = { Scale = true, Width = true, Height = true, Depth = true, Color = true }

local function markGenerated(instance)
	instance:SetAttribute("BuildKitGenerated", true)
	for _, descendant in ipairs(instance:GetDescendants()) do
		descendant:SetAttribute("BuildKitGenerated", true)
	end
end

local function tagBuildKit(model, spec)
	if not (model and spec and PARAMETRIC_KINDS[spec.kind]) then return end
	model:SetAttribute("BuildKitKind", spec.kind)
	local ok, json = pcall(function() return HttpService:JSONEncode(spec) end)
	if ok then model:SetAttribute("BuildKitSpec", json) end
	if spec.kind == "prop" then
		-- props resize uniformly via one Scale knob (W/H/D don't map to a free-form prop)
		model:SetAttribute("Scale", tonumber(spec.scale) or 1)
	elseif spec.size then
		model:SetAttribute("Width", spec.size[1])
		model:SetAttribute("Height", spec.size[2])
		model:SetAttribute("Depth", spec.size[3])
	end
	if spec.color then
		model:SetAttribute("Color", Color3.fromRGB(spec.color[1], spec.color[2], spec.color[3]))
	end
	for _, child in ipairs(model:GetChildren()) do
		markGenerated(child)
	end
	local center = spec.center or { 0, 0, 0 }
	local root = CFrame.new(center[1], center[2], center[3])
	model:SetAttribute("BuildKitRegenPivotOffset", root:ToObjectSpace(model:GetPivot()))
end

local function watchBuildKit(model)
	if _watched[model] or not model:GetAttribute("BuildKitKind") then return end
	_watched[model] = true
	model.AttributeChanged:Connect(function(attr)
		-- ignore internal tags + ignore changes made BY a regen
		if not REGEN_ATTRIBUTES[attr] or _regenBusy[model] or _pending[model] then return end
		_pending[model] = true
		task.defer(function() -- debounce so multi-attribute edits batch into one rebuild
			_pending[model] = nil
	if model.Parent and Parametric.regenBuildKit then Parametric.regenBuildKit(model) end
		end)
	end)
	model.AncestryChanged:Connect(function()
		if not model.Parent then _watched[model] = nil end
	end)
end

local function scanBuildKit()
	for _, m in ipairs(workspace:GetDescendants()) do
		if m:IsA("Model") and m:GetAttribute("BuildKitKind") then watchBuildKit(m) end
	end
end

--#region exports (generated — do not hand-edit)
Parametric._regenBusy = _regenBusy
Parametric.tagBuildKit = tagBuildKit
Parametric.watchBuildKit = watchBuildKit
Parametric.scanBuildKit = scanBuildKit
return Parametric
--#endregion
