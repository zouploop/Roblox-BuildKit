-- ---------- GUI builder ------------------------------------------------------
-- Builds a styled ScreenGui from a component tree. Theme tokens (sent fully
-- resolved by the Node side) drive corner/stroke/gradient/padding/font/color so
-- output is never bare. Components: panel, label, button, bar, list, grid, icon,
-- input, divider, spacer. ponytail: drop shadows skipped (layout tangle) — palette
-- + stroke + gradient carry depth; add via outer/inner frame pattern if needed.
local GUI_DEFAULT_THEME = {
	palette = {
		bg = { 18, 18, 22 }, surface = { 30, 30, 38 }, surfaceAlt = { 42, 42, 52 },
		accent = { 212, 175, 55 }, accentText = { 18, 18, 22 },
		text = { 235, 235, 240 }, textMuted = { 150, 150, 165 }, stroke = { 90, 90, 105 },
		success = { 120, 190, 120 }, danger = { 200, 90, 80 }, warning = { 220, 180, 90 },
	},
	font = {
		title = "Oswald", titleSize = 30, heading = "GothamBold", headingSize = 22,
		body = "Gotham", bodySize = 16, caption = "Gotham", captionSize = 13,
	},
	shape = { corner = 4, stroke = 1, strokeTransparency = 0.2, padding = 14, gap = 10 },
	effects = { gradient = 0.1, gradientRotation = 90, shadow = true },
}

local function gmerge(base, over)
	over = over or {}
	local out = {}
	for k, v in pairs(base) do
		local ov = over[k]
		if type(v) == "table" and type(ov) == "table" then
			out[k] = gmerge(v, ov)
		elseif ov ~= nil then
			out[k] = ov
		else
			out[k] = v
		end
	end
	for k, v in pairs(over) do
		if out[k] == nil then
			out[k] = v
		end
	end
	return out
end

local function col(c, fallback)
	if type(c) == "table" and #c == 3 then
		return Color3.fromRGB(c[1], c[2], c[3])
	end
	return fallback
end
local function pcol(theme, key)
	return col(theme.palette[key], Color3.fromRGB(255, 0, 255))
end
local function fontOf(name, fallback)
	if name then
		local ok, f = pcall(function()
			return Enum.Font[name]
		end)
		if ok and f then
			return f
		end
	end
	return fallback or Enum.Font.Gotham
end

local function addCorner(inst, r)
	local c = Instance.new("UICorner")
	c.CornerRadius = UDim.new(0, r or 0)
	c.Parent = inst
end
local function addStroke(inst, color, thickness, transparency)
	local s = Instance.new("UIStroke")
	s.Color = color
	s.Thickness = thickness or 1
	s.Transparency = transparency or 0
	s.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
	s.Parent = inst
end
local function addPadding(inst, p)
	local u = Instance.new("UIPadding")
	local d = UDim.new(0, p)
	u.PaddingTop, u.PaddingBottom, u.PaddingLeft, u.PaddingRight = d, d, d, d
	u.Parent = inst
end
local function addGradient(inst, intensity, rotation)
	if not intensity or intensity <= 0 then
		return
	end
	local lo = 1 - intensity
	local g = Instance.new("UIGradient")
	g.Color = ColorSequence.new({
		ColorSequenceKeypoint.new(0, Color3.new(1, 1, 1)),
		ColorSequenceKeypoint.new(1, Color3.new(lo, lo, lo)),
	})
	g.Rotation = rotation or 90
	g.Parent = inst
end
local function addList(container, dir, gap, align)
	local l = Instance.new("UIListLayout")
	l.FillDirection = (dir == "horizontal") and Enum.FillDirection.Horizontal or Enum.FillDirection.Vertical
	l.Padding = UDim.new(0, gap or 0)
	l.SortOrder = Enum.SortOrder.LayoutOrder
	l.HorizontalAlignment = (align == "center" and Enum.HorizontalAlignment.Center)
		or (align == "right" and Enum.HorizontalAlignment.Right)
		or Enum.HorizontalAlignment.Left
	l.VerticalAlignment = Enum.VerticalAlignment.Top
	l.Parent = container
end

local function axisDim(tok, default)
	if not tok then
		return default
	end
	tok = tostring(tok)
	if tok == "auto" then
		return UDim.new(0, 0)
	end
	local pct = string.match(tok, "^(%-?%d+%.?%d*)%%$")
	if pct then
		return UDim.new(tonumber(pct) / 100, 0)
	end
	local n = tonumber(tok)
	if n then
		return UDim.new(0, n)
	end
	return default
end
local function parseSize(size)
	if not size then
		return nil, false, false
	end
	size = tostring(size)
	if size == "fill" then
		return UDim2.new(1, 0, 1, 0), false, false
	end
	local w, h = string.match(size, "^%s*([^,]+)%s*,%s*([^,]+)%s*$")
	if not w then
		return nil, false, false
	end
	local autoX, autoY = (w == "auto"), (h == "auto")
	local wd = axisDim(w, UDim.new(0, 100))
	local hd = axisDim(h, UDim.new(0, 100))
	return UDim2.new(wd.Scale, wd.Offset, hd.Scale, hd.Offset), autoX, autoY
end

local ANCHORS = {
	center = { 0.5, 0.5 }, top = { 0.5, 0 }, bottom = { 0.5, 1 },
	left = { 0, 0.5 }, right = { 1, 0.5 },
	topleft = { 0, 0 }, topright = { 1, 0 }, bottomleft = { 0, 1 }, bottomright = { 1, 1 },
}
local function xy(str)
	local x, y = string.match(tostring(str or ""), "^%s*(%-?%d+%.?%d*)%s*,%s*(%-?%d+%.?%d*)%s*$")
	if x then
		return tonumber(x), tonumber(y)
	end
	return nil
end
local function applyPlacement(inst, node, inLayout)
	if inLayout then
		return
	end
	local px, py = xy(node.position)
	if px then
		inst.AnchorPoint = Vector2.new(0, 0)
		inst.Position = UDim2.fromOffset(px, py)
		return
	end
	local a = ANCHORS[node.anchor or "center"]
	if a then
		inst.AnchorPoint = Vector2.new(a[1], a[2])
		local ox, oy = xy(node.offset)
		inst.Position = UDim2.new(a[1], ox or 0, a[2], oy or 0)
	end
end

local buildNode

local function applyChildren(container, node, theme)
	local layoutDir = node.fill
	if node.title and not layoutDir then
		layoutDir = "vertical"
	end
	if layoutDir then
		addList(container, layoutDir, node.gap or theme.shape.gap, node.align)
	end
	if node.title then
		local t = Instance.new("TextLabel")
		t.Name = "Title"
		t.BackgroundTransparency = 1
		t.Size = UDim2.new(1, 0, 0, theme.font.headingSize + 6)
		t.Font = fontOf(theme.font.heading)
		t.TextSize = theme.font.headingSize
		t.TextColor3 = pcol(theme, "text")
		t.Text = node.title
		t.TextXAlignment = Enum.TextXAlignment.Left
		t.LayoutOrder = -1
		t.Parent = container
	end
	if node.children then
		local order = 0
		for _, child in ipairs(node.children) do
			local inst = buildNode(child, theme, layoutDir)
			if inst then
				order += 1
				inst.LayoutOrder = order
				inst.Parent = container
			end
		end
	end
end

function buildNode(node, theme, layoutDir)
	local inLayout = (layoutDir ~= nil and layoutDir ~= false)
	local t = node.type
	local inst

	if t == "label" then
		inst = Instance.new("TextLabel")
		inst.BackgroundTransparency = 1
		local variant = node.variant or "body"
		local fsize = node.textSize or theme.font[variant .. "Size"] or theme.font.bodySize
		inst.Font = fontOf(theme.font[variant] or theme.font.body)
		inst.TextSize = fsize
		inst.TextWrapped = true
		inst.RichText = true
		inst.Text = node.text or ""
		inst.TextColor3 = col(node.color, (variant == "caption") and pcol(theme, "textMuted") or pcol(theme, "text"))
		inst.TextXAlignment = (node.align == "center" and Enum.TextXAlignment.Center)
			or (node.align == "right" and Enum.TextXAlignment.Right)
			or Enum.TextXAlignment.Left
		inst.AutomaticSize = Enum.AutomaticSize.Y
		inst.Size = UDim2.new(1, 0, 0, fsize + 4)
	elseif t == "button" then
		inst = Instance.new("TextButton")
		inst.AutoButtonColor = true
		local variant = node.variant or "primary"
		local bg, txt, strokeC
		if variant == "secondary" then
			bg, txt, strokeC = pcol(theme, "surfaceAlt"), pcol(theme, "text"), pcol(theme, "stroke")
		elseif variant == "danger" then
			bg, txt, strokeC = pcol(theme, "danger"), Color3.fromRGB(255, 255, 255), pcol(theme, "danger")
		elseif variant == "ghost" then
			bg, txt, strokeC = nil, pcol(theme, "accent"), pcol(theme, "accent")
		else
			bg, txt, strokeC = pcol(theme, "accent"), pcol(theme, "accentText"), pcol(theme, "accent")
		end
		if variant == "ghost" then
			inst.BackgroundTransparency = 1
		else
			inst.BackgroundColor3 = col(node.bg, bg)
			addGradient(inst, theme.effects.gradient, theme.effects.gradientRotation)
		end
		inst.Text = node.text or "Button"
		inst.Font = fontOf(theme.font.heading)
		inst.TextSize = node.textSize or theme.font.bodySize
		inst.TextColor3 = col(node.color, txt)
		addCorner(inst, node.cornerRadius or theme.shape.corner)
		addStroke(inst, col(node.strokeColor, strokeC), node.strokeThickness or theme.shape.stroke, theme.shape.strokeTransparency)
		addPadding(inst, math.floor((node.padding or theme.shape.padding) * 0.5))
		inst.Size = UDim2.new(1, 0, 0, 40)
	elseif t == "bar" then
		inst = Instance.new("Frame")
		inst.BackgroundColor3 = col(node.bg, pcol(theme, "surfaceAlt"))
		inst.ClipsDescendants = true
		addCorner(inst, node.cornerRadius or theme.shape.corner)
		addStroke(inst, pcol(theme, "stroke"), theme.shape.stroke, theme.shape.strokeTransparency)
		inst.Size = UDim2.new(1, 0, 0, 20)
		local v = math.clamp(node.value or 0, 0, 1)
		local fillF = Instance.new("Frame")
		fillF.Name = "Fill"
		fillF.BorderSizePixel = 0
		fillF.BackgroundColor3 = col(node.color, pcol(theme, "accent"))
		fillF.Size = UDim2.new(v, 0, 1, 0)
		addCorner(fillF, node.cornerRadius or theme.shape.corner)
		addGradient(fillF, theme.effects.gradient, theme.effects.gradientRotation)
		fillF.Parent = inst
		if node.label or node.showValue then
			local lab = Instance.new("TextLabel")
			lab.BackgroundTransparency = 1
			lab.Size = UDim2.new(1, 0, 1, 0)
			lab.Font = fontOf(theme.font.caption)
			lab.TextSize = theme.font.captionSize
			lab.TextColor3 = pcol(theme, "text")
			local txt = node.label or ""
			if node.showValue then
				txt = (txt ~= "" and (txt .. "  ") or "") .. tostring(math.floor(v * 100)) .. "%"
			end
			lab.Text = txt
			lab.ZIndex = 2
			lab.Parent = inst
		end
	elseif t == "icon" then
		inst = Instance.new(node.button and "ImageButton" or "ImageLabel")
		if node.bg then
			inst.BackgroundColor3 = col(node.bg, pcol(theme, "surface"))
			addCorner(inst, node.cornerRadius or theme.shape.corner)
		else
			inst.BackgroundTransparency = 1
		end
		local img = tostring(node.image or "")
		if string.match(img, "^%d+$") then
			img = "rbxassetid://" .. img
		end
		inst.Image = img
		inst.Size = UDim2.new(0, 48, 0, 48)
	elseif t == "input" then
		inst = Instance.new("TextBox")
		inst.BackgroundColor3 = col(node.bg, pcol(theme, "surfaceAlt"))
		inst.Text = node.text or ""
		inst.PlaceholderText = node.placeholder or ""
		inst.PlaceholderColor3 = pcol(theme, "textMuted")
		inst.Font = fontOf(theme.font.body)
		inst.TextSize = node.textSize or theme.font.bodySize
		inst.TextColor3 = col(node.color, pcol(theme, "text"))
		inst.TextXAlignment = Enum.TextXAlignment.Left
		inst.ClearTextOnFocus = false
		addCorner(inst, node.cornerRadius or theme.shape.corner)
		addStroke(inst, col(node.strokeColor, pcol(theme, "stroke")), node.strokeThickness or theme.shape.stroke, theme.shape.strokeTransparency)
		addPadding(inst, math.floor((node.padding or theme.shape.padding) * 0.6))
		inst.Size = UDim2.new(1, 0, 0, 40)
	elseif t == "divider" then
		inst = Instance.new("Frame")
		inst.BackgroundColor3 = col(node.color, pcol(theme, "stroke"))
		inst.BackgroundTransparency = node.transparency or 0.3
		inst.BorderSizePixel = 0
		inst.Size = UDim2.new(1, 0, 0, node.strokeThickness or 1)
	elseif t == "spacer" then
		inst = Instance.new("Frame")
		inst.BackgroundTransparency = 1
		inst.Size = UDim2.new(1, 0, 0, node.gap or theme.shape.gap)
	else
		-- container: panel / list / grid
		inst = Instance.new("Frame")
		if t == "list" then
			if node.bg then
				inst.BackgroundColor3 = col(node.bg, pcol(theme, "surface"))
			else
				inst.BackgroundTransparency = 1
			end
		else
			inst.BackgroundColor3 = col(node.bg, pcol(theme, "surface"))
			addCorner(inst, node.cornerRadius or theme.shape.corner)
			addStroke(inst, col(node.strokeColor, pcol(theme, "stroke")), node.strokeThickness or theme.shape.stroke, theme.shape.strokeTransparency)
			addGradient(inst, theme.effects.gradient, theme.effects.gradientRotation)
		end
		addPadding(inst, node.padding or theme.shape.padding)
		inst.Size = UDim2.new(0, 300, 0, 200)
		if t == "grid" then
			local cell = UDim2.fromOffset(100, 100)
			local cw, ch = xy(node.cellSize)
			if cw then
				cell = UDim2.fromOffset(cw, ch)
			end
			local g = Instance.new("UIGridLayout")
			g.CellSize = cell
			g.CellPadding = UDim2.fromOffset(node.gap or theme.shape.gap, node.gap or theme.shape.gap)
			g.SortOrder = Enum.SortOrder.LayoutOrder
			g.Parent = inst
			if node.children then
				local order = 0
				for _, child in ipairs(node.children) do
					local ci = buildNode(child, theme, "grid")
					if ci then
						order += 1
						ci.LayoutOrder = order
						ci.Parent = inst
					end
				end
			end
		else
			applyChildren(inst, node, theme)
		end
	end

	-- common props
	inst.Name = node.name or (t:sub(1, 1):upper() .. t:sub(2))
	if inst:IsA("GuiObject") then
		inst.BorderSizePixel = 0
	end
	if node.transparency ~= nil and t ~= "divider" and t ~= "label" then
		inst.BackgroundTransparency = node.transparency
	end
	local sz, autoX, autoY = parseSize(node.size)
	if sz then
		inst.Size = sz
		inst.AutomaticSize = Enum.AutomaticSize.None
	end
	if autoX or autoY then
		inst.AutomaticSize = (autoX and autoY and Enum.AutomaticSize.XY)
			or (autoX and Enum.AutomaticSize.X)
			or Enum.AutomaticSize.Y
	end
	if node.zindex then
		inst.ZIndex = node.zindex
	end
	if node.visible == false then
		inst.Visible = false
	end
	-- vertical layout: default cross-axis width to fill unless sized explicitly
	if layoutDir == "vertical" and not node.size then
		inst.Size = UDim2.new(1, 0, inst.Size.Y.Scale, inst.Size.Y.Offset)
	end
	applyPlacement(inst, node, inLayout)
	return inst
end

