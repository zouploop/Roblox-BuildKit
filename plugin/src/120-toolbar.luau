-- ---------- toolbar toggle ---------------------------------------------------
local toolbar = plugin:CreateToolbar("BuildKit")
local btn = toolbar:CreateButton("BuildKit", "Toggle BuildKit polling", "")
btn:SetActive(Core.RUNNING)
btn.Click:Connect(function()
	Core.RUNNING = not Core.RUNNING
	btn:SetActive(Core.RUNNING)
	print("[BuildKit] polling " .. (Core.RUNNING and "ON" or "OFF"))
end)

print("[BuildKit] plugin loaded, polling " .. BASE)

-- Self-heal on load: if a previous session died mid-capture (or a tool call failed
-- between hiding parts and restoring them), the parts are still invisible/recolored and
-- their tokens are gone. The attribute stash survives, so sweep it clean now — otherwise
-- the user finds geometry missing with no way to get it back, and saving bakes it in.
do
	local ok, res = pcall(handlers.restore_all)
	if ok and res and (res.shown > 0 or res.recolored > 0) then
		print(("[BuildKit] recovered %d hidden and %d recolored part(s) from a previous session")
			:format(res.shown, res.recolored))
	end
end

