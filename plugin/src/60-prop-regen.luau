local PROP_REGEN_SOURCE = [==[
local model = script.Parent
local Http = game:GetService("HttpService")
local SHAPES = { box = Enum.PartType.Block, cylinder = Enum.PartType.Cylinder, ball = Enum.PartType.Ball }
local function col(a, d) if type(a) == "table" and #a == 3 then return Color3.fromRGB(a[1], a[2], a[3]) end return d end
local function matOf(n) if n then local ok, m = pcall(function() return Enum.Material[n] end) if ok and m then return m end end return Enum.Material.SmoothPlastic end
local FXT = { fire = "rbxasset://textures/particles/fire_main.dds", smoke = "rbxasset://textures/particles/smoke_main.dds", sparkles = "rbxasset://textures/particles/sparkles_main.dds" }
local function nseq(a, b, c) return NumberSequence.new({ NumberSequenceKeypoint.new(0, a), NumberSequenceKeypoint.new(0.5, b), NumberSequenceKeypoint.new(1, c) }) end
local function fx(part, f)
	if not f then return end
	if type(f) == "string" then f = { preset = f } end
	if type(f) ~= "table" then return end
	local pr = tostring(f.preset or "fire"):lower()
	local e = Instance.new("ParticleEmitter")
	if pr == "smoke" then
		e.Texture = FXT.smoke; e.Color = ColorSequence.new(Color3.fromRGB(95, 95, 95), Color3.fromRGB(40, 40, 40))
		e.Size = nseq(0.4, 1.3, 2.2); e.Transparency = nseq(0.6, 0.75, 1); e.Lifetime = NumberRange.new(1.2, 2.2)
		e.Rate = 12; e.Speed = NumberRange.new(1, 2); e.Acceleration = Vector3.new(0, 3, 0)
	elseif pr == "magic" or pr == "energy" or pr == "sparkle" then
		e.Texture = FXT.sparkles; e.Color = ColorSequence.new(Color3.fromRGB(150, 120, 255), Color3.fromRGB(80, 200, 255))
		e.Size = nseq(0.12, 0.4, 0); e.Transparency = nseq(0.1, 0.3, 1); e.Lifetime = NumberRange.new(0.5, 1.1)
		e.Rate = 30; e.Speed = NumberRange.new(0.5, 2.5); e.SpreadAngle = Vector2.new(25, 25); e.LightEmission = 1; e.LightInfluence = 0
	else
		e.Texture = FXT.fire; e.Color = ColorSequence.new(Color3.fromRGB(255, 200, 70), Color3.fromRGB(160, 40, 10))
		e.Size = nseq(0.2, 0.9, 0.1); e.Transparency = nseq(0.25, 0.4, 1); e.Lifetime = NumberRange.new(0.4, 0.8)
		e.Rate = 32; e.Speed = NumberRange.new(1.5, 3); e.Acceleration = Vector3.new(0, 6, 0); e.LightEmission = 0.85; e.LightInfluence = 0
	end
	if type(f.color) == "table" and #f.color == 3 then e.Color = ColorSequence.new(Color3.fromRGB(f.color[1], f.color[2], f.color[3])) end
	if tonumber(f.rate) then e.Rate = tonumber(f.rate) end
	e.Parent = part
end
local function getParts()
	local j = model:GetAttribute("BuildKitParts")
	if type(j) ~= "string" then return {} end
	local ok, d = pcall(function() return Http:JSONDecode(j) end)
	return (ok and type(d) == "table") and d or {}
end
local building = false
local function build()
	if building then return end
	building = true
	local scale = tonumber(model:GetAttribute("Scale")) or 1
	local c = model:GetPivot().Position
	for _, ch in ipairs(model:GetChildren()) do if ch:IsA("BasePart") then ch:Destroy() end end
	for _, ps in ipairs(getParts()) do
		local sz, pos = ps.size or { 1, 1, 1 }, ps.pos or { 0, 0, 0 }
		local p
		if tostring(ps.shape):lower() == "wedge" then
			p = Instance.new("WedgePart")
		else
			p = Instance.new("Part"); p.Shape = SHAPES[tostring(ps.shape or "box"):lower()] or Enum.PartType.Block
		end
		p.Anchored = true
		p.Size = Vector3.new(sz[1] * scale, sz[2] * scale, sz[3] * scale)
		local cf = CFrame.new(c.X + pos[1] * scale, c.Y + pos[2] * scale, c.Z + pos[3] * scale)
		if ps.rot then cf = cf * CFrame.Angles(math.rad(ps.rot[1]), math.rad(ps.rot[2]), math.rad(ps.rot[3])) end
		p.CFrame = cf
		p.Color = col(ps.color, Color3.fromRGB(160, 160, 160))
		p.Material = ps.neon and Enum.Material.Neon or matOf(ps.material)
		p.Transparency = ps.transparency or 0
		if ps.canCollide ~= nil then p.CanCollide = ps.canCollide end
		p.TopSurface = Enum.SurfaceType.Smooth; p.BottomSurface = Enum.SurfaceType.Smooth
		p.Parent = model
		if ps.fx then fx(p, ps.fx) end
		if ps.light then
			local l = Instance.new("PointLight"); l.Color = col(ps.light.color, p.Color)
			l.Brightness = ps.light.brightness or 1; l.Range = ps.light.range or 8; l.Parent = p
		end
	end
	if not model.PrimaryPart then model.PrimaryPart = model:FindFirstChildWhichIsA("BasePart") end
	building = false
end
local hasGeom = false
for _, ch in ipairs(model:GetChildren()) do if ch:IsA("BasePart") then hasGeom = true break end end
if not hasGeom then build() end
model:GetAttributeChangedSignal("Scale"):Connect(build)
]==]

