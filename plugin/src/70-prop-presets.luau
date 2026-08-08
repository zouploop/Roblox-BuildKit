-- Prop preset library: ready-made multi-part props (noir set-dressing) so a caller
-- can `{kind="prop", prop="lamp"}` instead of hand-listing primitives. Each entry
-- returns a parts list (same schema makePart takes); s.color overrides the hero
-- colour where it makes sense. Built base-at-origin (parts offset up from center).
local PROP_PRESETS
do
	local CER = { 222, 218, 208 } -- ceramic offwhite
	local WAX = { 224, 216, 196 }
	local WOOD = { 84, 62, 44 }
	local BRASS = { 132, 104, 56 }
	local BLACK = { 30, 30, 32 }
	local SHADE = { 212, 198, 168 }
	local PAPER = { 210, 202, 182 }
	local AMBER = { 140, 82, 36 }
	local VROT = { rot = { 0, 0, 90 } } -- cylinder upright (length along Y)
	local ZROT = { rot = { 0, 90, 0 } } -- cylinder axis along Z (disc faces +/-Z)
	local function pp(shape, x, y, z, sx, sy, sz, color, mat, extra)
		local t = { shape = shape, pos = { x, y, z }, size = { sx, sy, sz }, color = color, material = mat or "SmoothPlastic" }
		if extra then for k, v in pairs(extra) do t[k] = v end end
		return t
	end
	PROP_PRESETS = {
		mug = function(s)
			local b = s.color or CER
			return {
				pp("cylinder", 0, 0.45, 0, 0.9, 0.72, 0.72, b, "SmoothPlastic", VROT),
				pp("cylinder", 0, 0.88, 0, 0.05, 0.60, 0.60, { 96, 64, 42 }, "SmoothPlastic", VROT), -- coffee surface, inset from rim (reads as a full mug, not a closed cylinder)
				pp("box", 0.39, 0.63, 0, 0.38, 0.10, 0.12, b), -- top arm: inner edge bites body (x0.20 < r0.36) so it seats, not floats
				pp("box", 0.39, 0.30, 0, 0.38, 0.10, 0.12, b), -- bottom arm
				pp("box", 0.56, 0.465, 0, 0.10, 0.43, 0.12, b), -- outer grip bar (joins both arm ends)
			}
		end,
		bottle = function(s)
			local g = s.color or AMBER
			return {
				pp("cylinder", 0, 0.625, 0, 1.25, 0.78, 0.78, g, "Glass", { rot = { 0, 0, 90 }, transparency = 0.18 }), -- body w/ flat shoulder
				pp("cylinder", 0, 1.5, 0, 0.6, 0.32, 0.32, g, "Glass", { rot = { 0, 0, 90 }, transparency = 0.18 }), -- neck rising from the shoulder
				pp("cylinder", 0, 1.85, 0, 0.2, 0.36, 0.36, BLACK, "SmoothPlastic", VROT), -- cap
				pp("box", 0, 0.55, 0.31, 0.42, 0.55, 0.04, PAPER, "SmoothPlastic"), -- label, inset into the curve
			}
		end,
		glass = function(s)
			return {
				pp("cylinder", 0, 0.26, 0, 0.46, 0.54, 0.54, s.color or { 175, 105, 45 }, "SmoothPlastic", VROT), -- liquid (opaque amber, shows a fill line)
				pp("cylinder", 0, 0.36, 0, 0.72, 0.64, 0.64, { 225, 232, 235 }, "SmoothPlastic", { rot = { 0, 0, 90 }, transparency = 0.6 }), -- clear tumbler shell (SmoothPlastic, not Glass — Glass hides the liquid)
				pp("cylinder", 0, 0.72, 0, 0.05, 0.64, 0.64, { 232, 240, 243 }, "SmoothPlastic", { rot = { 0, 0, 90 }, transparency = 0.45 }), -- rim
			}
		end,
		ashtray = function(s)
			return {
				pp("cylinder", 0, 0.1, 0, 0.2, 1.5, 1.5, { 120, 120, 118 }, "Glass", { rot = { 0, 0, 90 }, transparency = 0.25 }),
				pp("cylinder", 0, 0.17, 0, 0.1, 1.05, 1.05, { 70, 70, 70 }, "SmoothPlastic", VROT),
				pp("cylinder", 0.28, 0.24, 0, 0.95, 0.11, 0.11, { 235, 232, 224 }, "SmoothPlastic"),
				pp("cylinder", 0.74, 0.24, 0, 0.09, 0.11, 0.11, { 210, 90, 30 }, "Neon", { light = { color = { 255, 120, 40 }, brightness = 1.2, range = 3 } }),
			}
		end,
		tablelamp = function(s)
			return {
				pp("cylinder", 0, 0.15, 0, 0.3, 1.6, 1.6, BRASS, "Metal", VROT),
				pp("cylinder", 0, 1.5, 0, 2.6, 0.22, 0.22, BRASS, "Metal", VROT),
				pp("box", 0, 2.9, 0, 0.3, 0.3, 0.3, BLACK, "SmoothPlastic"),
				pp("cylinder", 0, 3.55, 0, 1.3, 2.2, 2.2, s.color or SHADE, "SmoothPlastic", { rot = { 0, 0, 90 }, transparency = 0.12, light = { color = { 255, 228, 182 }, brightness = 2.2, range = 18 } }),
			}
		end,
		floorlamp = function(s)
			return {
				pp("cylinder", 0, 0.15, 0, 0.3, 1.9, 1.9, BRASS, "Metal", VROT),
				pp("cylinder", 0, 3.75, 0, 7.2, 0.2, 0.2, BRASS, "Metal", VROT),
				pp("cylinder", 0, 7.85, 0, 1.5, 2.5, 2.5, s.color or SHADE, "SmoothPlastic", { rot = { 0, 0, 90 }, transparency = 0.12, light = { color = { 255, 226, 180 }, brightness = 2.4, range = 22 } }),
			}
		end,
		book = function(s)
			local cov = s.color or { 110, 44, 44 }
			return {
				pp("box", 0, 0.16, 0, 1.5, 0.32, 1.05, cov, "SmoothPlastic"),
				pp("box", 0.06, 0.16, 0, 1.42, 0.22, 0.95, PAPER, "SmoothPlastic"),
				pp("box", -0.72, 0.16, 0, 0.08, 0.3, 1.0, cov, "SmoothPlastic"),
			}
		end,
		bookstack = function(s)
			local cols = { { 110, 44, 44 }, { 48, 66, 92 }, { 70, 88, 60 }, { 150, 120, 60 } }
			local ys = { 0.16, 0.5, 0.84, 1.16 }
			local rots = { 0, 7, -5, 3 }
			local ws = { 1.5, 1.4, 1.55, 1.3 }
			local out = {}
			for i = 1, 4 do
				out[#out + 1] = pp("box", 0, ys[i], 0, ws[i], 0.32, 1.05, cols[i], "SmoothPlastic", { rot = { 0, rots[i], 0 } })
				out[#out + 1] = pp("box", 0.06, ys[i], 0, ws[i] - 0.1, 0.22, 0.95, PAPER, "SmoothPlastic", { rot = { 0, rots[i], 0 } })
			end
			return out
		end,
		plate = function(s)
			local b = s.color or CER
			return {
				pp("cylinder", 0, 0.06, 0, 0.12, 0.85, 0.85, { 206, 200, 188 }, "SmoothPlastic", VROT), -- foot ring (raises the plate off the surface)
				pp("cylinder", 0, 0.20, 0, 0.16, 2.0, 2.0, b, "SmoothPlastic", VROT), -- plate body
			}
		end,
		candle = function(s)
			return {
				pp("cylinder", 0, 0.12, 0, 0.25, 1.0, 1.0, BRASS, "Metal", VROT),
				pp("cylinder", 0, 0.42, 0, 0.35, 0.5, 0.5, BRASS, "Metal", VROT),
				pp("cylinder", 0, 1.2, 0, 1.45, 0.36, 0.36, s.color or WAX, "SmoothPlastic", VROT),
				pp("box", 0, 1.95, 0, 0.04, 0.12, 0.04, { 20, 20, 20 }, "SmoothPlastic"),
				pp("ball", 0, 2.12, 0, 0.3, 0.3, 0.3, { 255, 180, 80 }, "Neon", { light = { color = { 255, 170, 90 }, brightness = 2.4, range = 12 } }),
			}
		end,
		pictureframe = function(s)
			return {
				pp("box", 0, 1.3, 0, 2.0, 2.6, 0.14, WOOD, "Wood"),
				pp("box", 0, 1.4, 0.08, 1.6, 2.0, 0.04, s.color or { 150, 148, 138 }, "SmoothPlastic"),
				pp("box", 0, 0.95, -0.45, 0.18, 1.7, 0.07, WOOD, "Wood", { rot = { 18, 0, 0 } }),
			}
		end,
		clock = function(s)
			local w = s.color or WOOD
			return {
				pp("box", 0, 0.8, 0, 2.0, 1.6, 1.0, w, "Wood"),
				pp("cylinder", 0, 1.6, 0, 1.0, 2.0, 2.0, w, "Wood", ZROT),
				pp("cylinder", 0, 1.0, 0.52, 0.06, 1.35, 1.35, { 236, 230, 216 }, "SmoothPlastic", ZROT),
				pp("box", 0, 1.22, 0.58, 0.05, 0.46, 0.03, { 30, 30, 30 }, "SmoothPlastic"),
				pp("box", 0, 1.05, 0.58, 0.05, 0.62, 0.03, { 30, 30, 30 }, "SmoothPlastic", { rot = { 0, 0, 60 } }),
			}
		end,
		telephone = function(s)
			return {
				pp("box", 0, 0.28, 0, 2.0, 0.56, 1.5, BLACK, "SmoothPlastic"),
				pp("cylinder", 0, 0.62, 0.2, 0.14, 1.1, 1.1, { 44, 44, 46 }, "SmoothPlastic", ZROT), -- dial plate
				pp("cylinder", 0, 0.62, 0.22, 0.06, 0.74, 0.74, { 118, 118, 122 }, "SmoothPlastic", ZROT), -- finger wheel
				pp("cylinder", 0, 0.62, 0.24, 0.05, 0.3, 0.3, { 214, 212, 206 }, "SmoothPlastic", ZROT), -- number card
				pp("box", -0.85, 0.62, -0.35, 0.2, 0.3, 0.3, BLACK, "SmoothPlastic"),
				pp("box", 0.85, 0.62, -0.35, 0.2, 0.3, 0.3, BLACK, "SmoothPlastic"),
				pp("box", 0, 0.9, -0.35, 1.9, 0.24, 0.3, BLACK, "SmoothPlastic"), -- handset bar (rests on cradle)
				pp("cylinder", -0.95, 0.74, -0.35, 0.42, 0.5, 0.5, BLACK, "SmoothPlastic", VROT),
				pp("cylinder", 0.95, 0.74, -0.35, 0.42, 0.5, 0.5, BLACK, "SmoothPlastic", VROT),
			}
		end,
		radio = function(s)
			local w = s.color or { 86, 60, 40 }
			return {
				pp("box", 0, 1.4, 0, 2.4, 2.4, 1.2, w, "Wood"),
				pp("cylinder", 0, 2.6, 0, 1.2, 2.4, 2.4, w, "Wood", ZROT),
				pp("box", 0, 1.7, 0.62, 1.6, 1.3, 0.06, { 52, 44, 38 }, "SmoothPlastic"),
				pp("cylinder", 0, 0.7, 0.62, 0.06, 0.8, 0.8, BRASS, "Metal", ZROT),
				pp("cylinder", -0.7, 0.5, 0.64, 0.2, 0.34, 0.34, BRASS, "Metal", ZROT),
				pp("cylinder", 0.7, 0.5, 0.64, 0.2, 0.34, 0.34, BRASS, "Metal", ZROT),
			}
		end,
		-- modern electronics ----------------------------------------------------
		smartphone = function(s)
			return {
				pp("box", 0, 0.07, 0, 1.05, 0.14, 2.05, { 28, 28, 30 }, "SmoothPlastic"), -- body (lies flat, screen up)
				pp("box", 0, 0.145, 0, 0.92, 0.04, 1.86, s.color or { 34, 44, 70 }, "SmoothPlastic"), -- screen
				pp("cylinder", 0, 0.155, 0.80, 0.04, 0.12, 0.12, { 55, 65, 85 }, "SmoothPlastic", VROT), -- front camera
			}
		end,
		laptop = function(s)
			local body = s.color or { 175, 178, 182 }
			return {
				pp("box", 0, 0.06, 0, 2.4, 0.12, 1.7, body, "Metal"), -- deck
				pp("box", 0, 0.12, 0.25, 2.1, 0.04, 1.0, { 44, 44, 48 }, "SmoothPlastic"), -- keyboard
				pp("box", 0, 0.12, -0.45, 0.7, 0.03, 0.42, { 130, 132, 136 }, "SmoothPlastic"), -- trackpad
				pp("box", 0, 0.9, -0.95, 2.4, 1.6, 0.08, body, "Metal", { rot = { -20, 0, 0 } }), -- lid (leans back)
				pp("box", 0, 0.92, -0.88, 2.2, 1.4, 0.03, { 24, 28, 40 }, "SmoothPlastic", { rot = { -20, 0, 0 } }), -- display
			}
		end,
		tv = function(s)
			local frame = s.color or { 22, 22, 24 }
			return { -- wide 16:9 flatscreen on two end feet + risers (reads as a TV, not a monitor)
				pp("box", 0, 2.5, 0, 6.4, 3.6, 0.18, frame, "SmoothPlastic"), -- bezel
				pp("box", 0, 2.5, 0.1, 6.2, 3.4, 0.04, { 16, 18, 26 }, "SmoothPlastic"), -- display
				pp("box", -2.4, 0.45, 0, 0.25, 0.7, 0.3, { 26, 26, 30 }, "SmoothPlastic"), -- riser L
				pp("box", 2.4, 0.45, 0, 0.25, 0.7, 0.3, { 26, 26, 30 }, "SmoothPlastic"), -- riser R
				pp("box", -2.4, 0.06, 0.1, 1.5, 0.1, 1.1, { 30, 30, 32 }, "SmoothPlastic"), -- foot L
				pp("box", 2.4, 0.06, 0.1, 1.5, 0.1, 1.1, { 30, 30, 32 }, "SmoothPlastic"), -- foot R
			}
		end,
		desklamp = function(s)
			local m = s.color or { 62, 64, 68 }
			return { -- midcentury task lamp: base, post, ball joint, angled arm, glowing globe head
				pp("cylinder", 0, 0.1, 0, 0.2, 1.4, 1.4, m, "Metal", VROT),
				pp("box", 0, 1.0, 0, 0.13, 1.8, 0.13, m, "Metal"),
				pp("ball", 0, 1.9, 0, 0.26, 0.26, 0.26, m, "Metal"),
				pp("box", 0.45, 2.05, 0, 0.13, 1.3, 0.13, m, "Metal", { rot = { 0, 0, 70 } }),
				pp("ball", 1.05, 1.9, 0, 0.85, 0.85, 0.85, { 220, 210, 180 }, "SmoothPlastic", { light = { color = { 255, 228, 182 }, brightness = 2, range = 14 } }),
			}
		end,
		-- kitchen / utility ------------------------------------------------------
		trashcan = function(s)
			local steel = s.color or { 170, 172, 176 }
			return { -- modern stainless step-can: body, rim band, lid, raised lid top, foot pedal
				pp("cylinder", 0, 1.5, 0, 3.0, 2.2, 2.2, steel, "Metal", VROT),
				pp("cylinder", 0, 2.92, 0, 0.12, 2.26, 2.26, { 120, 122, 126 }, "Metal", VROT),
				pp("cylinder", 0, 3.1, 0, 0.28, 2.3, 2.3, { 160, 162, 166 }, "Metal", VROT),
				pp("cylinder", 0, 3.28, 0, 0.16, 1.5, 1.5, { 155, 157, 161 }, "Metal", VROT),
				pp("box", 0, 0.12, 1.05, 0.7, 0.16, 0.45, { 90, 92, 96 }, "Metal"),
			}
		end,
		knifeblock = function(s)
			local wood = s.color or { 120, 82, 50 }
			local h = { rot = { -12, 0, 0 } } -- handles share the block's lean
			return { -- angled wood block with 5 staggered knife handles
				pp("box", 0, 1.1, 0, 1.8, 2.2, 1.4, wood, "Wood", h),
				pp("box", -0.6, 2.55, -0.32, 0.16, 0.95, 0.14, { 30, 28, 26 }, "SmoothPlastic", h),
				pp("box", -0.3, 2.6, -0.3, 0.16, 0.8, 0.14, { 30, 28, 26 }, "SmoothPlastic", h),
				pp("box", 0, 2.62, -0.28, 0.16, 1.05, 0.14, { 30, 28, 26 }, "SmoothPlastic", h),
				pp("box", 0.3, 2.6, -0.3, 0.16, 0.8, 0.14, { 30, 28, 26 }, "SmoothPlastic", h),
				pp("box", 0.6, 2.55, -0.32, 0.16, 0.9, 0.14, { 30, 28, 26 }, "SmoothPlastic", h),
			}
		end,
		-- decor (organic-lite; for HIGH-fidelity flowers/plants prefer the official
		-- generate_procedural_model tool — native ProceduralModel, but part-heavy) ---
		vase = function(s)
			local v = s.color or { 70, 90, 110 }
			local out = {
				pp("cylinder", 0, 0.15, 0, 0.3, 0.8, 0.8, v, "SmoothPlastic", VROT),
				pp("cylinder", 0, 1.05, 0, 1.6, 1.5, 1.5, v, "SmoothPlastic", VROT),
				pp("cylinder", 0, 1.95, 0, 0.5, 0.7, 0.7, v, "SmoothPlastic", VROT),
				pp("cylinder", 0, 2.25, 0, 0.12, 0.92, 0.92, { v[1] - 10, v[2] - 10, v[3] - 10 }, "SmoothPlastic", VROT),
			}
			local GREEN = { 70, 120, 60 }
			local flowers = { -- x, headY, petalColor, centerColor
				{ 0.0, 3.72, { 205, 75, 85 }, { 230, 200, 80 } },
				{ -0.3, 3.57, { 225, 195, 95 }, { 180, 120, 60 } },
				{ 0.3, 3.47, { 185, 135, 215 }, { 150, 90, 170 } },
			}
			local stemH = { 1.4, 1.3, 1.2 }
			for i, f in ipairs(flowers) do
				local x, y, pc, cc = f[1], f[2], f[3], f[4]
				out[#out + 1] = pp("cylinder", x, y - 0.7, 0, stemH[i], 0.05, 0.05, GREEN, "SmoothPlastic", VROT)
				out[#out + 1] = pp("ball", x, y, 0, 0.17, 0.17, 0.17, cc, "SmoothPlastic")
				out[#out + 1] = pp("box", x + 0.2, y + 0.03, 0, 0.32, 0.06, 0.18, pc, "SmoothPlastic", { rot = { 0, 0, -25 } })
				out[#out + 1] = pp("box", x - 0.2, y + 0.03, 0, 0.32, 0.06, 0.18, pc, "SmoothPlastic", { rot = { 0, 0, 25 } })
				out[#out + 1] = pp("box", x, y + 0.03, 0.2, 0.18, 0.06, 0.32, pc, "SmoothPlastic", { rot = { 25, 0, 0 } })
				out[#out + 1] = pp("box", x, y + 0.03, -0.2, 0.18, 0.06, 0.32, pc, "SmoothPlastic", { rot = { -25, 0, 0 } })
			end
			return out
		end,
		teapot = function(s)
			local c = s.color or { 90, 140, 150 }
			return {
				pp("ball", 0, 0.72, 0, 1.7, 1.25, 1.7, c, "SmoothPlastic"), -- body (ellipsoid)
				pp("cylinder", 0, 1.35, 0, 0.18, 0.95, 0.95, c, "SmoothPlastic", VROT), -- lid
				pp("ball", 0, 1.55, 0, 0.32, 0.32, 0.32, c, "SmoothPlastic"), -- knob
				pp("cylinder", 0.9, 0.95, 0, 1.0, 0.3, 0.3, c, "SmoothPlastic", { rot = { 0, 0, 50 } }), -- spout
				pp("box", -0.92, 1.05, 0, 0.5, 0.12, 0.14, c, "SmoothPlastic"), -- handle top
				pp("box", -1.15, 0.7, 0, 0.12, 0.7, 0.14, c, "SmoothPlastic"), -- handle mid
				pp("box", -0.95, 0.4, 0, 0.4, 0.12, 0.14, c, "SmoothPlastic"), -- handle bot
			}
		end,
		desktop = function(s)
			return { -- modern desktop: monitor + tower (drive bay + power LED) + keyboard + mouse
				pp("box", 0, 2.5, 0, 3.4, 2.2, 0.16, { 28, 28, 30 }, "SmoothPlastic"), -- monitor bezel
				pp("box", 0, 2.5, 0.1, 3.2, 2.0, 0.04, { 22, 26, 36 }, "SmoothPlastic"), -- display
				pp("box", 0, 1.4, -0.05, 0.35, 0.6, 0.35, { 34, 34, 38 }, "SmoothPlastic"), -- neck
				pp("box", 0, 0.06, 0, 1.5, 0.1, 0.8, { 40, 40, 44 }, "SmoothPlastic"), -- foot
				pp("box", 2.7, 1.5, 0, 1.1, 3.0, 2.4, s.color or { 36, 36, 42 }, "SmoothPlastic"), -- tower
				pp("box", 2.7, 2.4, 1.21, 0.9, 0.5, 0.05, { 55, 55, 62 }, "SmoothPlastic"), -- drive bay
				pp("cylinder", 2.7, 1.9, 1.22, 0.06, 0.18, 0.18, { 90, 200, 120 }, "Neon", ZROT), -- power LED
				pp("box", 0, 0.08, 1.7, 2.6, 0.16, 0.9, { 44, 44, 48 }, "SmoothPlastic"), -- keyboard
				pp("box", 1.5, 0.11, 1.7, 0.45, 0.22, 0.7, { 50, 50, 54 }, "SmoothPlastic"), -- mouse
			}
		end,
		alarmclock = function(s)
			local b = s.color or { 180, 60, 55 }
			return { -- 1960s twin-bell wind-up alarm clock
				pp("cylinder", 0, 0.95, 0, 0.5, 1.6, 1.6, b, "SmoothPlastic", ZROT), -- body
				pp("cylinder", 0, 0.95, 0.28, 0.06, 1.3, 1.3, { 235, 230, 218 }, "SmoothPlastic", ZROT), -- face
				pp("box", 0, 1.05, 0.32, 0.05, 0.45, 0.03, { 25, 25, 25 }, "SmoothPlastic"), -- hour hand
				pp("box", 0, 0.9, 0.32, 0.05, 0.6, 0.03, { 25, 25, 25 }, "SmoothPlastic", { rot = { 0, 0, 55 } }), -- minute hand
				pp("ball", -0.55, 1.85, 0, 0.6, 0.6, 0.6, { 185, 188, 192 }, "Metal"), -- bell L
				pp("ball", 0.55, 1.85, 0, 0.6, 0.6, 0.6, { 185, 188, 192 }, "Metal"), -- bell R
				pp("box", 0, 2.0, 0, 0.06, 0.3, 0.06, { 120, 122, 126 }, "Metal"), -- hammer
				pp("ball", -0.5, 0.12, 0.25, 0.3, 0.35, 0.3, { 185, 188, 192 }, "Metal"), -- foot L
				pp("ball", 0.5, 0.12, 0.25, 0.3, 0.35, 0.3, { 185, 188, 192 }, "Metal"), -- foot R
			}
		end,
		retropc = function(s)
			local beige = s.color or { 205, 195, 165 }
			return { -- 80s/90s beige CRT computer: case + boxy monitor + greenish screen + floppy + LED + keyboard
				pp("box", 0, 0.42, 0, 3.2, 0.85, 2.2, beige, "SmoothPlastic"), -- desktop case
				pp("box", 0, 2.05, -0.1, 2.6, 2.4, 2.2, beige, "SmoothPlastic"), -- monitor body
				pp("box", 0, 2.25, 1.0, 2.0, 1.7, 0.12, { 45, 48, 45 }, "SmoothPlastic"), -- screen bezel
				pp("box", 0, 2.25, 1.06, 1.7, 1.45, 0.05, { 120, 150, 135 }, "SmoothPlastic"), -- CRT glass
				pp("box", 0.7, 0.6, 1.11, 0.9, 0.1, 0.05, { 60, 60, 58 }, "SmoothPlastic"), -- floppy slot
				pp("cylinder", -1.0, 0.55, 1.11, 0.06, 0.14, 0.14, { 120, 200, 120 }, "Neon", ZROT), -- power LED
				pp("box", 0, 0.09, 2.4, 2.8, 0.18, 1.0, beige, "SmoothPlastic"), -- keyboard
			}
		end,
		digitalclock = function(s)
			local lit = s.color or { 230, 40, 30 }
			return { -- modern LED alarm clock: dark slab + glowing digit blocks + colon + buttons
				pp("box", 0, 0.5, 0, 2.2, 1.0, 1.0, { 30, 30, 34 }, "SmoothPlastic"), -- body
				pp("box", 0, 0.55, 0.51, 1.7, 0.62, 0.04, { 18, 6, 6 }, "SmoothPlastic"), -- display panel
				pp("box", -0.5, 0.55, 0.53, 0.25, 0.4, 0.02, lit, "Neon"),
				pp("box", -0.18, 0.55, 0.53, 0.25, 0.4, 0.02, lit, "Neon"),
				pp("box", 0, 0.55, 0.53, 0.06, 0.28, 0.02, lit, "Neon"), -- colon
				pp("box", 0.2, 0.55, 0.53, 0.25, 0.4, 0.02, lit, "Neon"),
				pp("box", 0.52, 0.55, 0.53, 0.25, 0.4, 0.02, lit, "Neon"),
				pp("box", -0.6, 1.02, 0, 0.22, 0.12, 0.3, { 60, 60, 66 }, "SmoothPlastic"), -- button L
				pp("box", 0.6, 1.02, 0, 0.22, 0.12, 0.3, { 60, 60, 66 }, "SmoothPlastic"), -- button R
			}
		end,
		gamingpc = function(s)
			return { -- modern gaming PC: thin-bezel monitor + glass-panel tower w/ RGB + cyan fan + kbd/mouse
				pp("box", 0, 2.6, 0, 3.6, 2.0, 0.1, { 22, 22, 24 }, "SmoothPlastic"), -- monitor bezel
				pp("box", 0, 2.6, 0.06, 3.5, 1.9, 0.04, { 20, 28, 45 }, "SmoothPlastic"), -- display
				pp("box", 0, 1.5, -0.05, 0.3, 0.6, 0.4, { 28, 28, 30 }, "SmoothPlastic"), -- neck
				pp("box", 0, 0.05, 0, 1.6, 0.08, 0.9, { 30, 30, 32 }, "SmoothPlastic"), -- base
				pp("box", 2.8, 1.7, 0, 1.4, 3.4, 2.6, s.color or { 24, 24, 28 }, "SmoothPlastic"), -- tower
				pp("box", 3.51, 1.7, 0, 0.06, 3.0, 2.2, { 120, 150, 180 }, "SmoothPlastic", { transparency = 0.55 }), -- glass side panel
				pp("box", 3.2, 1.7, 0.9, 0.1, 2.6, 0.1, { 80, 120, 255 }, "Neon"), -- RGB strip
				pp("box", 3.2, 1.7, -0.9, 0.1, 2.6, 0.1, { 255, 60, 160 }, "Neon"), -- RGB strip
				pp("cylinder", 2.8, 2.5, 1.31, 0.06, 0.7, 0.7, { 80, 160, 255 }, "Neon", ZROT), -- front fan glow
				pp("box", 0, 0.08, 1.9, 2.8, 0.16, 0.9, { 26, 26, 30 }, "SmoothPlastic"), -- keyboard
				pp("box", 1.6, 0.11, 1.9, 0.45, 0.22, 0.7, { 30, 30, 34 }, "SmoothPlastic"), -- mouse
			}
		end,
		drone = function(s)
			local body = s.color or { 235, 235, 238 }
			local rotor = { rot = { 0, 0, 90 }, transparency = 0.25 }
			return { -- quadcopter (primitives matched to an AI generate_mesh reference)
				pp("box", 0, 0.6, 0, 1.3, 0.55, 1.5, body, "SmoothPlastic"), -- body
				pp("box", 0, 0.88, -0.2, 0.5, 0.18, 0.45, { 40, 42, 46 }, "SmoothPlastic"), -- camera/top
				pp("box", 0.6, 0.6, 0.6, 0.16, 0.12, 1.5, { 60, 62, 66 }, "SmoothPlastic", { rot = { 0, 45, 0 } }),
				pp("box", -0.6, 0.6, -0.6, 0.16, 0.12, 1.5, { 60, 62, 66 }, "SmoothPlastic", { rot = { 0, 45, 0 } }),
				pp("box", -0.6, 0.6, 0.6, 0.16, 0.12, 1.5, { 60, 62, 66 }, "SmoothPlastic", { rot = { 0, -45, 0 } }),
				pp("box", 0.6, 0.6, -0.6, 0.16, 0.12, 1.5, { 60, 62, 66 }, "SmoothPlastic", { rot = { 0, -45, 0 } }),
				pp("cylinder", 1.2, 0.7, 1.2, 0.05, 1.3, 1.3, { 210, 212, 216 }, "SmoothPlastic", rotor),
				pp("cylinder", -1.2, 0.7, 1.2, 0.05, 1.3, 1.3, { 210, 212, 216 }, "SmoothPlastic", rotor),
				pp("cylinder", 1.2, 0.7, -1.2, 0.05, 1.3, 1.3, { 210, 212, 216 }, "SmoothPlastic", rotor),
				pp("cylinder", -1.2, 0.7, -1.2, 0.05, 1.3, 1.3, { 210, 212, 216 }, "SmoothPlastic", rotor),
				pp("box", 0.5, 0.3, 0, 0.1, 0.5, 1.0, { 45, 47, 50 }, "SmoothPlastic"), -- skid
				pp("box", -0.5, 0.3, 0, 0.1, 0.5, 1.0, { 45, 47, 50 }, "SmoothPlastic"), -- skid
			}
		end,
		-- game-mechanic / medieval ----------------------------------------------
		crate = function(s)
			local w = s.color or { 150, 110, 65 }
			local f = { 110, 78, 45 }
			return { -- wooden shipping crate: body + corner posts + rims + front X-brace
				pp("box", 0, 1.2, 0, 2.3, 2.3, 2.3, w, "Wood"),
				pp("box", -1.1, 1.2, -1.1, 0.25, 2.4, 0.25, f, "Wood"),
				pp("box", 1.1, 1.2, -1.1, 0.25, 2.4, 0.25, f, "Wood"),
				pp("box", -1.1, 1.2, 1.1, 0.25, 2.4, 0.25, f, "Wood"),
				pp("box", 1.1, 1.2, 1.1, 0.25, 2.4, 0.25, f, "Wood"),
				pp("box", 0, 2.35, 0, 2.55, 0.22, 2.55, f, "Wood"),
				pp("box", 0, 0.12, 0, 2.55, 0.22, 2.55, f, "Wood"),
				pp("box", 0, 1.2, 1.18, 0.2, 2.9, 0.08, f, "Wood", { rot = { 0, 0, 45 } }),
				pp("box", 0, 1.2, 1.18, 0.2, 2.9, 0.08, f, "Wood", { rot = { 0, 0, -45 } }),
			}
		end,
		chest = function(s)
			local w = s.color or { 120, 80, 45 }
			local iron = { 70, 72, 76 }
			return { -- treasure chest: body + domed lid + iron bands + brass lock + keyhole
				pp("box", 0, 0.65, 0, 2.6, 1.3, 1.8, w, "Wood"),
				pp("cylinder", 0, 1.35, 0, 2.6, 1.7, 1.7, w, "Wood"), -- domed lid (axis X, half-buried)
				pp("box", -0.8, 0.65, 0, 0.2, 1.3, 1.85, iron, "Metal"),
				pp("box", 0.8, 0.65, 0, 0.2, 1.3, 1.85, iron, "Metal"),
				pp("cylinder", -0.8, 1.35, 0, 0.2, 1.75, 1.75, iron, "Metal"), -- band over lid
				pp("cylinder", 0.8, 1.35, 0, 0.2, 1.75, 1.75, iron, "Metal"),
				pp("box", 0, 0.95, 0.92, 0.45, 0.5, 0.18, { 210, 180, 90 }, "Metal"), -- brass lock
				pp("cylinder", 0, 0.9, 1.0, 0.05, 0.12, 0.12, { 30, 25, 15 }, "SmoothPlastic", ZROT), -- keyhole
			}
		end,
		sword = function(s)
			return { -- medieval longsword: pommel, grip, guard, fullered blade, wedge tip
				pp("ball", 0, 0.2, 0, 0.4, 0.4, 0.4, { 120, 100, 55 }, "Metal"), -- pommel
				pp("cylinder", 0, 0.75, 0, 0.95, 0.22, 0.22, { 70, 50, 35 }, "SmoothPlastic", VROT), -- grip
				pp("box", 0, 1.28, 0, 1.7, 0.24, 0.32, { 120, 100, 55 }, "Metal"), -- crossguard
				pp("box", 0, 2.9, 0, 0.55, 3.0, 0.12, s.color or { 205, 210, 216 }, "Metal"), -- blade
				pp("box", 0, 2.85, 0, 0.12, 2.6, 0.14, { 165, 170, 178 }, "SmoothPlastic"), -- fuller
				-- tip: two mirrored wedges tapering to a point at top-CENTER (front view), seated into blade
				pp("wedge", 0.1375, 4.7, 0, 0.12, 0.7, 0.275, s.color or { 205, 210, 216 }, "Metal", { rot = { 0, -90, 0 } }), -- right half
				pp("wedge", -0.1375, 4.7, 0, 0.12, 0.7, 0.275, s.color or { 205, 210, 216 }, "Metal", { rot = { 0, 90, 0 } }), -- left half
			}
		end,
		shield = function(s)
			return { -- round medieval shield: brass rim, painted face, metal boss, cross emblem
				pp("cylinder", 0, 1.5, -0.05, 0.3, 2.9, 2.9, { 120, 100, 55 }, "Metal", ZROT), -- rim
				pp("cylinder", 0, 1.5, 0.06, 0.22, 2.7, 2.7, s.color or { 150, 45, 45 }, "SmoothPlastic", ZROT), -- face
				pp("ball", 0, 1.5, 0.25, 0.6, 0.6, 0.55, { 185, 188, 192 }, "Metal"), -- boss
				pp("box", 0, 1.5, 0.2, 0.26, 1.9, 0.04, { 225, 225, 230 }, "SmoothPlastic"), -- cross V
				pp("box", 0, 1.5, 0.2, 1.9, 0.26, 0.04, { 225, 225, 230 }, "SmoothPlastic"), -- cross H
			}
		end,
		torch = function(s)
			return { -- wood handle + wrapped head + layered tapered flame (+ light)
				pp("cylinder", 0, 1.2, 0, 2.4, 0.22, 0.22, s.color or { 90, 62, 40 }, "Wood", VROT), -- handle
				pp("cylinder", 0, 2.5, 0, 0.6, 0.5, 0.5, { 60, 45, 32 }, "SmoothPlastic", VROT), -- wrapped head
				pp("ball", 0, 2.8, 0, 0.55, 0.4, 0.55, { 45, 32, 26 }, "SmoothPlastic"), -- coals
				pp("ball", 0, 3.2, 0, 0.72, 0.95, 0.72, { 235, 110, 25 }, "Neon", { light = { color = { 255, 150, 50 }, brightness = 3, range = 16 } }), -- flame base
				pp("ball", 0, 3.5, 0, 0.5, 1.0, 0.5, { 248, 155, 45 }, "Neon"), -- flame mid
				pp("ball", 0, 3.95, 0, 0.28, 0.7, 0.28, { 252, 190, 75 }, "Neon"), -- flame tip
				pp("ball", 0, 3.2, 0, 0.3, 0.6, 0.3, { 255, 235, 150 }, "Neon"), -- bright core
			}
		end,
		coinstack = function(s)
			local g = s.color or { 230, 190, 70 }
			return { -- gold coin pickup: leaning stack + scattered coins
				pp("cylinder", 0, 0.07, 0, 0.13, 0.9, 0.9, g, "Metal", VROT),
				pp("cylinder", 0.03, 0.2, 0.02, 0.13, 0.9, 0.9, g, "Metal", VROT),
				pp("cylinder", -0.02, 0.33, 0, 0.13, 0.9, 0.9, g, "Metal", VROT),
				pp("cylinder", 0.02, 0.46, -0.02, 0.13, 0.9, 0.9, g, "Metal", VROT),
				pp("cylinder", 0, 0.59, 0.01, 0.13, 0.9, 0.9, g, "Metal", VROT),
				pp("cylinder", 1.0, 0.07, 0.3, 0.13, 0.9, 0.9, g, "Metal", VROT),
				pp("cylinder", -0.9, 0.07, -0.3, 0.13, 0.9, 0.9, g, "Metal", VROT),
			}
		end,
		-- futuristic ------------------------------------------------------------
		holoorb = function(s)
			local glow = s.color or { 90, 200, 255 }
			return { -- holo projector: tech base + emitter ring + glowing orb + core + orbital rings
				pp("cylinder", 0, 0.2, 0, 0.4, 1.8, 1.8, { 40, 44, 52 }, "Metal", VROT),
				pp("cylinder", 0, 0.48, 0, 0.16, 1.3, 1.3, { 70, 150, 190 }, "Neon", VROT),
				pp("ball", 0, 2.2, 0, 1.5, 1.5, 1.5, glow, "Neon", { transparency = 0.45, light = { color = glow, brightness = 3, range = 18 } }),
				pp("ball", 0, 2.2, 0, 0.7, 0.7, 0.7, { 190, 240, 255 }, "Neon", { transparency = 0.25 }),
				pp("cylinder", 0, 2.2, 0, 0.05, 2.3, 2.3, { 120, 220, 255 }, "Neon", { rot = { 0, 0, 90 }, transparency = 0.45 }),
				pp("cylinder", 0, 2.2, 0, 0.05, 2.3, 2.3, { 120, 220, 255 }, "Neon", { rot = { 30, 0, 90 }, transparency = 0.45 }),
			}
		end,
		lootbox = function(s)
			local edge = s.color or { 120, 90, 255 }
			return { -- glowing reward crate: dark cube + neon edge frame + gold star icon
				pp("box", 0, 1.3, 0, 2.2, 2.2, 2.2, { 48, 52, 78 }, "SmoothPlastic"),
				pp("box", -1.07, 1.3, -1.07, 0.14, 2.3, 0.14, edge, "Neon"),
				pp("box", 1.07, 1.3, -1.07, 0.14, 2.3, 0.14, edge, "Neon"),
				pp("box", -1.07, 1.3, 1.07, 0.14, 2.3, 0.14, edge, "Neon"),
				pp("box", 1.07, 1.3, 1.07, 0.14, 2.3, 0.14, edge, "Neon"),
				pp("box", 0, 2.46, 0, 2.34, 0.12, 2.34, edge, "Neon"),
				pp("box", 0, 0.14, 0, 2.34, 0.12, 2.34, edge, "Neon"),
				pp("box", 0, 1.3, 1.12, 0.8, 0.8, 0.06, { 255, 215, 90 }, "Neon", { rot = { 0, 0, 45 } }),
				pp("box", 0, 1.3, 1.14, 1.0, 0.28, 0.05, { 255, 228, 130 }, "Neon"),
			}
		end,
		barrel = function(s)
			local w = s.color or { 140, 98, 58 }
			local iron = { 85, 68, 50 }
			return { -- wooden barrel: staved body + lid + 3 iron hoops
				pp("cylinder", 0, 1.5, 0, 3.0, 2.2, 2.2, w, "Wood", VROT),
				pp("cylinder", 0, 3.0, 0, 0.16, 2.0, 2.0, { 115, 80, 46 }, "Wood", VROT),
				pp("cylinder", 0, 0.55, 0, 0.24, 2.32, 2.32, iron, "Metal", VROT),
				pp("cylinder", 0, 1.5, 0, 0.24, 2.32, 2.32, iron, "Metal", VROT),
				pp("cylinder", 0, 2.45, 0, 0.24, 2.32, 2.32, iron, "Metal", VROT),
			}
		end,
		potion = function(s)
			return { -- glowing potion flask: glass round body + glowing liquid + neck + cork
				pp("ball", 0, 0.7, 0, 1.0, 0.9, 1.0, { 200, 225, 230 }, "SmoothPlastic", { transparency = 0.5 }),
				pp("ball", 0, 0.62, 0, 0.78, 0.62, 0.78, s.color or { 140, 60, 210 }, "Neon", { transparency = 0.12, light = { color = { 150, 70, 230 }, brightness = 2, range = 10 } }),
				pp("cylinder", 0, 1.4, 0, 0.7, 0.42, 0.42, { 200, 225, 230 }, "SmoothPlastic", { rot = { 0, 0, 90 }, transparency = 0.5 }),
				pp("cylinder", 0, 1.82, 0, 0.32, 0.36, 0.36, { 150, 110, 70 }, "SmoothPlastic", VROT),
			}
		end,
		-- appliances / dishware -------------------------------------------------
		toaster = function(s)
			return { -- chrome 2-slot toaster: body + slots + lever + dial + feet
				pp("box", 0, 0.85, 0, 2.6, 1.6, 1.4, s.color or { 190, 193, 198 }, "Metal"),
				pp("box", -0.55, 1.6, 0, 0.95, 0.12, 0.34, { 28, 28, 30 }, "SmoothPlastic"),
				pp("box", 0.55, 1.6, 0, 0.95, 0.12, 0.34, { 28, 28, 30 }, "SmoothPlastic"),
				pp("box", 1.36, 1.05, 0.35, 0.22, 0.5, 0.18, { 55, 57, 62 }, "Metal"), -- lever
				pp("cylinder", 0, 0.6, 0.71, 0.08, 0.34, 0.34, { 70, 72, 76 }, "Metal", ZROT), -- dial
				pp("box", -1.0, 0.08, 0, 0.25, 0.18, 1.2, { 60, 62, 66 }, "SmoothPlastic"), -- foot
				pp("box", 1.0, 0.08, 0, 0.25, 0.18, 1.2, { 60, 62, 66 }, "SmoothPlastic"), -- foot
			}
		end,
		bowl = function(s)
			return { -- bowl: rounded body + foot ring + flared interior rim (csg-hollow for a real bowl)
				pp("ball", 0, 0.55, 0, 2.0, 1.2, 2.0, s.color or { 216, 210, 198 }, "SmoothPlastic"),
				pp("cylinder", 0, 0.06, 0, 0.2, 0.85, 0.85, { 200, 194, 182 }, "SmoothPlastic", VROT),
				pp("cylinder", 0, 1.02, 0, 0.1, 1.55, 1.55, { 176, 170, 158 }, "SmoothPlastic", VROT),
			}
		end,
		candlestick = function(s)
			return { -- 1920s candlestick telephone: base, stem, mouthpiece horn, side hook + earpiece
				pp("cylinder", 0, 0.1, 0, 0.2, 1.4, 1.4, { 30, 30, 32 }, "Metal", VROT),
				pp("cylinder", 0, 1.1, 0, 2.0, 0.26, 0.26, { 40, 40, 43 }, "Metal", VROT),
				pp("cylinder", 0, 2.25, 0, 0.35, 0.55, 0.55, { 32, 32, 35 }, "Metal", VROT),
				pp("cylinder", 0, 2.45, 0, 0.18, 0.75, 0.75, { 32, 32, 35 }, "Metal", VROT),
				pp("box", 0.32, 1.65, 0, 0.75, 0.1, 0.12, { 40, 40, 43 }, "Metal"),
				pp("cylinder", 0.68, 1.4, 0, 0.55, 0.34, 0.34, { 30, 30, 32 }, "Metal", VROT),
			}
		end,
		transistor = function(s)
			return { -- 1960s transistor radio: body + grille + dial + knobs + handle + antenna
				pp("box", 0, 1.3, 0, 1.8, 2.6, 0.7, s.color or { 180, 150, 90 }, "SmoothPlastic"),
				pp("box", -0.35, 1.4, 0.37, 1.0, 1.5, 0.06, { 60, 50, 42 }, "SmoothPlastic"),
				pp("box", 0.45, 1.85, 0.37, 0.55, 0.5, 0.06, { 225, 215, 185 }, "SmoothPlastic"),
				pp("cylinder", 0.45, 0.95, 0.37, 0.14, 0.24, 0.24, { 150, 120, 60 }, "Metal", ZROT),
				pp("cylinder", 0.45, 1.3, 0.37, 0.14, 0.24, 0.24, { 150, 120, 60 }, "Metal", ZROT),
				pp("box", 0, 2.74, 0, 1.3, 0.1, 0.12, { 40, 40, 42 }, "SmoothPlastic"),
				pp("box", -0.6, 2.64, 0, 0.08, 0.2, 0.08, { 40, 40, 42 }, "SmoothPlastic"),
				pp("box", 0.6, 2.64, 0, 0.08, 0.2, 0.08, { 40, 40, 42 }, "SmoothPlastic"),
				pp("cylinder", 0.7, 3.4, 0, 1.6, 0.04, 0.04, { 150, 150, 155 }, "Metal", VROT),
			}
		end,
		crttv = function(s)
			return { -- 1960s console TV: wood cabinet + green CRT + grille + knobs + peg legs + rabbit ears
				pp("box", 0, 1.85, 0, 3.4, 2.4, 2.4, s.color or { 112, 76, 48 }, "Wood"),
				pp("box", -0.35, 1.95, 1.21, 2.3, 1.8, 0.2, { 40, 40, 42 }, "SmoothPlastic"),
				pp("box", -0.35, 1.95, 1.3, 2.0, 1.5, 0.06, { 120, 150, 135 }, "SmoothPlastic"),
				pp("box", 1.25, 1.95, 1.21, 0.7, 1.8, 0.06, { 72, 56, 42 }, "SmoothPlastic"),
				pp("cylinder", 1.25, 1.1, 1.22, 0.1, 0.28, 0.28, { 30, 30, 32 }, "SmoothPlastic", ZROT),
				pp("cylinder", 1.25, 1.5, 1.22, 0.1, 0.28, 0.28, { 30, 30, 32 }, "SmoothPlastic", ZROT),
				pp("box", -1.4, 0.35, 1.0, 0.18, 0.7, 0.18, { 80, 55, 35 }, "Wood"),
				pp("box", 1.4, 0.35, 1.0, 0.18, 0.7, 0.18, { 80, 55, 35 }, "Wood"),
				pp("box", -1.4, 0.35, -1.0, 0.18, 0.7, 0.18, { 80, 55, 35 }, "Wood"),
				pp("box", 1.4, 0.35, -1.0, 0.18, 0.7, 0.18, { 80, 55, 35 }, "Wood"),
				pp("cylinder", -0.5, 3.2, -0.4, 2.2, 0.05, 0.05, { 150, 150, 155 }, "Metal", { rot = { 0, 0, 72 } }),
				pp("cylinder", 0.5, 3.2, -0.4, 2.2, 0.05, 0.05, { 150, 150, 155 }, "Metal", { rot = { 0, 0, 108 } }),
			}
		end,
		speaker = function(s)
			return { -- modern speaker: body + woofer + dome + tweeter + cyan glow strip + top control
				pp("box", 0, 1.3, 0, 1.6, 2.6, 1.4, s.color or { 35, 35, 40 }, "SmoothPlastic"),
				pp("cylinder", 0, 0.95, 0.71, 0.1, 1.05, 1.05, { 22, 22, 25 }, "SmoothPlastic", ZROT),
				pp("cylinder", 0, 0.95, 0.74, 0.12, 0.35, 0.35, { 45, 45, 50 }, "SmoothPlastic", ZROT),
				pp("cylinder", 0, 1.95, 0.71, 0.08, 0.5, 0.5, { 22, 22, 25 }, "SmoothPlastic", ZROT),
				pp("box", 0, 0.25, 0.71, 1.42, 0.08, 0.05, { 80, 160, 255 }, "Neon"),
				pp("cylinder", 0, 2.62, 0, 0.06, 0.55, 0.55, { 60, 62, 68 }, "Metal", VROT),
			}
		end,
		axe = function(s)
			return { -- battle axe: wood haft + butt cap + steel head (socket + blade + wedge edge)
				pp("cylinder", 0, 1.5, 0, 3.0, 0.18, 0.18, { 95, 65, 42 }, "Wood", VROT),
				pp("box", 0, 2.85, 0, 0.5, 0.85, 0.34, { 105, 108, 112 }, "Metal"),
				pp("box", 0.65, 2.85, 0, 1.1, 1.05, 0.13, s.color or { 160, 163, 168 }, "Metal"),
				pp("wedge", 1.32, 2.85, 0, 0.45, 1.05, 0.13, { 175, 178, 184 }, "Metal", { rot = { 0, 90, 0 } }),
				pp("cylinder", 0, 0.08, 0, 0.16, 0.24, 0.24, { 70, 55, 40 }, "SmoothPlastic", VROT),
			}
		end,
		microwave = function(s)
			return { -- microwave: body + door + tinted window + handle + control panel + LED display
				pp("box", 0, 1.0, 0, 3.0, 2.0, 2.4, s.color or { 62, 64, 70 }, "SmoothPlastic"),
				pp("box", -0.45, 1.0, 1.21, 2.0, 1.7, 0.1, { 42, 44, 50 }, "SmoothPlastic"),
				pp("box", -0.45, 1.0, 1.27, 1.5, 1.25, 0.05, { 26, 30, 36 }, "SmoothPlastic"),
				pp("box", -0.45, 1.0, 1.29, 1.35, 1.1, 0.02, { 55, 60, 68 }, "SmoothPlastic"),
				pp("box", 0.62, 1.0, 1.3, 0.12, 1.45, 0.13, { 180, 182, 186 }, "Metal"), -- handle
				pp("box", 1.15, 1.0, 1.22, 0.8, 1.7, 0.06, { 45, 47, 52 }, "SmoothPlastic"), -- panel
				pp("box", 1.15, 1.62, 1.25, 0.6, 0.28, 0.04, { 60, 230, 120 }, "Neon"), -- LED display
			}
		end,
		wineglass = function(s)
			return { -- stemware: foot + stem + bowl + wine
				pp("cylinder", 0, 0.04, 0, 0.08, 1.0, 1.0, { 225, 232, 235 }, "SmoothPlastic", { rot = { 0, 0, 90 }, transparency = 0.4 }),
				pp("cylinder", 0, 0.65, 0, 1.2, 0.12, 0.12, { 225, 232, 235 }, "SmoothPlastic", { rot = { 0, 0, 90 }, transparency = 0.4 }),
				pp("ball", 0, 1.7, 0, 1.1, 1.4, 1.1, { 225, 232, 235 }, "SmoothPlastic", { transparency = 0.5 }),
				pp("ball", 0, 1.45, 0, 0.88, 0.75, 0.88, s.color or { 110, 28, 38 }, "SmoothPlastic", { transparency = 0.05 }),
			}
		end,
		kettle = function(s)
			return { -- electric kettle: power base + steel body + lid + knob + spout + handle
				pp("cylinder", 0, 0.12, 0, 0.25, 1.9, 1.9, { 60, 62, 68 }, "SmoothPlastic", VROT),
				pp("cylinder", 0, 1.25, 0, 2.0, 1.7, 1.7, s.color or { 200, 203, 208 }, "Metal", VROT),
				pp("cylinder", 0, 2.3, 0, 0.3, 1.45, 1.45, { 190, 193, 198 }, "Metal", VROT),
				pp("ball", 0, 2.5, 0, 0.3, 0.3, 0.3, { 55, 57, 62 }, "SmoothPlastic"),
				pp("box", 0, 1.95, 0.92, 0.45, 0.6, 0.35, { 200, 203, 208 }, "Metal", { rot = { -35, 0, 0 } }), -- spout
				pp("box", 0, 2.45, -0.9, 0.16, 0.16, 0.5, { 42, 44, 48 }, "SmoothPlastic"),
				pp("box", 0, 1.85, -1.15, 0.16, 1.1, 0.16, { 42, 44, 48 }, "SmoothPlastic"),
				pp("box", 0, 1.3, -0.95, 0.16, 0.16, 0.4, { 42, 44, 48 }, "SmoothPlastic"),
			}
		end,
		pottedplant = function(s)
			-- DETAILED leafy plant (~38 parts; favour detail over part-optimization).
			-- 13 two-segment fronds fan 360deg, rise upright then arc/taper out, + tall center
			-- blades + inner sprouts. Built with a loop (sin/cos around the pot).
			local pot = s.color or { 150, 90, 60 }
			local out = {
				pp("cylinder", 0, 0.6, 0, 1.2, 1.6, 1.6, pot, "SmoothPlastic", VROT),
				pp("cylinder", 0, 1.25, 0, 0.2, 1.85, 1.85, { 165, 100, 68 }, "SmoothPlastic", VROT),
				pp("cylinder", 0, 1.3, 0, 0.1, 1.55, 1.55, { 60, 45, 35 }, "SmoothPlastic", VROT),
			}
			local greens = { { 60, 120, 52 }, { 72, 138, 62 }, { 52, 108, 46 }, { 66, 128, 58 }, { 84, 150, 70 } }
			local N = 13
			for i = 1, N do
				local ang = (i / N) * 360
				local r = math.rad(ang)
				local g = greens[(i % #greens) + 1]
				local tilt1 = 18 + (i % 3) * 7
				out[#out + 1] = pp("box", math.sin(r) * 0.28, 1.95, math.cos(r) * 0.28, 0.34, 1.8, 0.09, g, "Grass", { rot = { tilt1, ang, 0 } })
				out[#out + 1] = pp("box", math.sin(r) * 1.13, 2.95, math.cos(r) * 1.13, 0.22, 1.4, 0.07, g, "Grass", { rot = { tilt1 + 36, ang, 0 } })
			end
			for i = 1, 4 do
				local ang = (i / 4) * 360 + 45
				local r = math.rad(ang)
				out[#out + 1] = pp("box", math.sin(r) * 0.12, 2.2, math.cos(r) * 0.12, 0.26, 2.0, 0.08, { 70, 132, 60 }, "Grass", { rot = { 8, ang, 0 } })
			end
			for i = 1, 5 do
				local ang = (i / 5) * 360 + 25
				local r = math.rad(ang)
				out[#out + 1] = pp("box", math.sin(r) * 0.22, 1.75, math.cos(r) * 0.22, 0.18, 1.0, 0.07, { 88, 152, 72 }, "Grass", { rot = { 22, ang, 0 } })
			end
			return out
		end,
		lantern = function(s)
			local m = s.color or { 72, 56, 40 }
			return { -- oil lantern: base + fuel font + glass globe + flame + cap + bail handle
				pp("cylinder", 0, 0.1, 0, 0.2, 0.9, 0.9, m, "Metal", VROT),
				pp("cylinder", 0, 0.45, 0, 0.5, 0.72, 0.72, { 92, 72, 46 }, "Metal", VROT),
				pp("cylinder", 0, 1.3, 0, 1.2, 0.88, 0.88, { 228, 234, 238 }, "SmoothPlastic", { rot = { 0, 0, 90 }, transparency = 0.55 }),
				pp("ball", 0, 1.25, 0, 0.36, 0.62, 0.36, { 255, 180, 80 }, "Neon", { light = { color = { 255, 160, 60 }, brightness = 2.5, range = 12 } }),
				pp("cylinder", 0, 2.0, 0, 0.28, 0.72, 0.72, m, "Metal", VROT),
				pp("box", 0.32, 2.35, 0, 0.06, 0.55, 0.06, m, "Metal"),
				pp("box", -0.32, 2.35, 0, 0.06, 0.55, 0.06, m, "Metal"),
				pp("box", 0, 2.62, 0, 0.7, 0.06, 0.06, m, "Metal"),
			}
		end,
		ereader = function(s)
			return { -- e-reader tablet: dark frame + e-ink screen + text lines
				pp("box", 0, 0.06, 0, 1.6, 0.12, 2.2, s.color or { 58, 60, 64 }, "SmoothPlastic"),
				pp("box", 0, 0.13, 0, 1.3, 0.04, 1.9, { 222, 220, 212 }, "SmoothPlastic"),
				pp("box", 0, 0.155, 0.65, 1.0, 0.02, 0.07, { 95, 95, 98 }, "SmoothPlastic"),
				pp("box", 0, 0.155, 0.33, 1.0, 0.02, 0.07, { 95, 95, 98 }, "SmoothPlastic"),
				pp("box", 0, 0.155, 0, 1.0, 0.02, 0.07, { 95, 95, 98 }, "SmoothPlastic"),
				pp("box", 0, 0.155, -0.33, 1.0, 0.02, 0.07, { 95, 95, 98 }, "SmoothPlastic"),
				pp("box", -0.15, 0.155, -0.65, 0.7, 0.02, 0.07, { 95, 95, 98 }, "SmoothPlastic"),
			}
		end,
		travelmug = function(s)
			return { -- insulated tumbler: body + grip band + lid + dome + sip spout (official showed: taper body)
				pp("cylinder", 0, 1.2, 0, 2.4, 1.25, 1.25, s.color or { 185, 187, 191 }, "Metal", VROT),
				pp("cylinder", 0, 0.9, 0, 0.5, 1.28, 1.28, { 80, 140, 180 }, "SmoothPlastic", VROT),
				pp("cylinder", 0, 2.55, 0, 0.4, 1.3, 1.3, { 42, 44, 48 }, "SmoothPlastic", VROT),
				pp("cylinder", 0, 2.8, 0, 0.22, 0.95, 0.95, { 42, 44, 48 }, "SmoothPlastic", VROT),
				pp("box", 0, 2.86, 0.35, 0.35, 0.16, 0.55, { 62, 64, 68 }, "SmoothPlastic"),
			}
		end,
		futurecup = function(s)
			return { -- sci-fi energy cup: dark body + glowing energy band + glow rim + lid + straw
				pp("cylinder", 0, 0.6, 0, 1.2, 0.72, 0.72, { 42, 44, 52 }, "SmoothPlastic", VROT),
				pp("cylinder", 0, 0.55, 0, 0.45, 0.74, 0.74, s.color or { 80, 255, 200 }, "Neon", VROT),
				pp("cylinder", 0, 0.96, 0, 0.08, 0.72, 0.72, { 120, 255, 220 }, "Neon", VROT),
				pp("cylinder", 0, 1.05, 0, 0.18, 0.7, 0.7, { 30, 32, 40 }, "SmoothPlastic", VROT),
				pp("cylinder", 0.18, 1.4, 0, 0.9, 0.09, 0.09, { 180, 230, 255 }, "SmoothPlastic", { rot = { 0, 0, 90 }, transparency = 0.3 }),
			}
		end,
		winebottle = function(s)
			local g = s.color or { 48, 88, 54 }
			return { -- tall green wine bottle: body + sloped shoulder + long neck + foil + label
				pp("cylinder", 0, 0.85, 0, 1.7, 0.72, 0.72, g, "Glass", { rot = { 0, 0, 90 }, transparency = 0.2 }),
				pp("cylinder", 0, 1.85, 0, 0.45, 0.5, 0.5, g, "Glass", { rot = { 0, 0, 90 }, transparency = 0.2 }),
				pp("cylinder", 0, 2.6, 0, 1.3, 0.28, 0.28, g, "Glass", { rot = { 0, 0, 90 }, transparency = 0.2 }),
				pp("cylinder", 0, 3.1, 0, 0.45, 0.32, 0.32, { 130, 35, 45 }, "SmoothPlastic", VROT),
				pp("box", 0, 0.85, 0.36, 0.58, 0.7, 0.04, { 232, 226, 210 }, "SmoothPlastic"),
			}
		end,
		holotv = function(s)
			local glow = s.color or { 100, 200, 255 }
			return { -- holographic display: tech base + emitter + floating glowing panel + UI + beams
				pp("cylinder", 0, 0.2, 0, 0.4, 2.4, 2.4, { 35, 38, 46 }, "Metal", VROT),
				pp("cylinder", 0, 0.45, 0, 0.16, 1.9, 1.9, { 80, 200, 255 }, "Neon", VROT),
				pp("cylinder", 0, 0.55, 0, 0.25, 1.4, 1.4, { 45, 48, 56 }, "Metal", VROT),
				pp("cylinder", 0, 0.78, 0, 0.3, 0.5, 0.5, { 140, 235, 255 }, "Neon", { rot = { 0, 0, 90 }, light = { color = { 120, 220, 255 }, brightness = 3, range = 20 } }),
				pp("box", 0, 4.0, 0, 6.0, 3.4, 0.08, glow, "Neon", { transparency = 0.62 }),
				pp("box", 0, 5.72, 0, 6.15, 0.12, 0.12, { 150, 235, 255 }, "Neon"),
				pp("box", 0, 2.28, 0, 6.15, 0.12, 0.12, { 150, 235, 255 }, "Neon"),
				pp("box", 3.04, 4.0, 0, 0.12, 3.5, 0.12, { 150, 235, 255 }, "Neon"),
				pp("box", -3.04, 4.0, 0, 0.12, 3.5, 0.12, { 150, 235, 255 }, "Neon"),
				pp("box", -1.0, 4.9, 0.06, 3.5, 0.22, 0.04, { 190, 245, 255 }, "Neon", { transparency = 0.35 }),
				pp("box", -1.5, 4.4, 0.06, 2.4, 0.18, 0.04, { 190, 245, 255 }, "Neon", { transparency = 0.4 }),
				pp("box", -1.8, 4.0, 0.06, 1.8, 0.18, 0.04, { 190, 245, 255 }, "Neon", { transparency = 0.4 }),
				pp("box", 1.5, 3.4, 0.06, 2.0, 0.7, 0.04, { 170, 240, 255 }, "Neon", { transparency = 0.5 }),
				pp("box", 1.4, 2.3, 0, 0.1, 3.6, 0.1, { 120, 210, 255 }, "Neon", { rot = { 0, 0, 22 }, transparency = 0.82 }),
				pp("box", -1.4, 2.3, 0, 0.1, 3.6, 0.1, { 120, 210, 255 }, "Neon", { rot = { 0, 0, -22 }, transparency = 0.82 }),
			}
		end,
		candelabra = function(s)
			local b = s.color or { 130, 108, 60 }
			local wax, fo, fy = { 226, 218, 198 }, { 240, 140, 40 }, { 255, 220, 110 }
			local out = {
				pp("cylinder", 0, 0.17, 0, 0.35, 1.5, 1.5, b, "Metal", VROT),
				pp("cylinder", 0, 0.45, 0, 0.22, 1.05, 1.05, b, "Metal", VROT),
				pp("cylinder", 0, 1.45, 0, 2.6, 0.24, 0.24, b, "Metal", VROT),
				pp("ball", 0, 0.95, 0, 0.46, 0.52, 0.46, b, "Metal"),
				pp("ball", 0, 1.7, 0, 0.36, 0.4, 0.36, b, "Metal"),
				pp("ball", 0, 2.55, 0, 0.3, 0.3, 0.3, b, "Metal"),
			}
			for _, a in ipairs({ 90, 210, 330 }) do
				local r = math.rad(a)
				out[#out + 1] = pp("ball", math.sin(r) * 0.5, 0.18, math.cos(r) * 0.5, 0.34, 0.28, 0.5, b, "Metal")
			end
			-- CONNECTED scroll arms: polyline, each segment spans exact endpoints (+0.08 overlap
			-- to seal joints) so arms are continuous, not floating segments.
			local function arm(sgn)
				local P = { { 0.16 * sgn, 1.95 }, { 0.7 * sgn, 1.78 }, { 1.15 * sgn, 2.2 }, { 1.2 * sgn, 2.9 } }
				for i = 1, #P - 1 do
					local x1, y1, x2, y2 = P[i][1], P[i][2], P[i + 1][1], P[i + 1][2]
					local dx, dy = x2 - x1, y2 - y1
					local len = math.sqrt(dx * dx + dy * dy)
					local w = 0.16 - (i - 1) * 0.015
					out[#out + 1] = pp("cylinder", (x1 + x2) / 2, (y1 + y2) / 2, 0, len + 0.08, w, w, b, "Metal", { rot = { 0, 0, math.deg(math.atan2(dy, dx)) } })
				end
			end
			arm(-1)
			arm(1)
			-- 3 candle stations (center higher): bobeche plate + cup + candle + layered flame
			for _, st in ipairs({ { 0, 2.65, true }, { -1.2, 2.9, false }, { 1.2, 2.9, false } }) do
				local x, by, lit = st[1], st[2], st[3]
				out[#out + 1] = pp("cylinder", x, by, 0, 0.08, 0.85, 0.85, { 134, 112, 64 }, "Metal", VROT)
				out[#out + 1] = pp("cylinder", x, by + 0.18, 0, 0.3, 0.4, 0.4, b, "Metal", VROT)
				out[#out + 1] = pp("cylinder", x, by + 0.75, 0, 1.0, 0.3, 0.3, wax, "SmoothPlastic", VROT)
				out[#out + 1] = pp("ball", x, by + 1.35, 0, 0.26, 0.5, 0.26, fo, "Neon", lit and { light = { color = { 255, 160, 60 }, brightness = 2, range = 15 } } or nil)
				out[#out + 1] = pp("ball", x, by + 1.4, 0, 0.14, 0.32, 0.14, fy, "Neon")
			end
			return out
		end,
		tankard = function(s)
			local glass = { 218, 228, 230 }
			local out = {
				pp("cylinder", 0, 0.12, 0, 0.22, 1.65, 1.65, { 205, 210, 214 }, "SmoothPlastic", { rot = { 0, 0, 90 }, transparency = 0.4 }),
				pp("cylinder", 0, 1.05, 0, 1.85, 1.34, 1.34, s.color or { 205, 150, 38 }, "SmoothPlastic", { rot = { 0, 0, 90 }, transparency = 0.05 }), -- beer
				pp("cylinder", 0, 1.15, 0, 2.0, 1.5, 1.5, glass, "SmoothPlastic", { rot = { 0, 0, 90 }, transparency = 0.5 }), -- glass
				pp("cylinder", 0, 2.0, 0, 0.45, 1.42, 1.42, { 245, 240, 226 }, "SmoothPlastic", VROT), -- foam head
				pp("ball", 0, 2.25, 0, 0.5, 0.34, 0.5, { 249, 245, 232 }, "SmoothPlastic"),
				pp("box", 0.9, 1.75, 0, 0.4, 0.18, 0.2, glass, "SmoothPlastic", { transparency = 0.45 }), -- handle
				pp("box", 1.12, 1.15, 0, 0.18, 1.15, 0.2, glass, "SmoothPlastic", { transparency = 0.45 }),
				pp("box", 0.9, 0.6, 0, 0.4, 0.18, 0.2, glass, "SmoothPlastic", { transparency = 0.45 }),
			}
			for i = 1, 6 do
				local a = math.rad((i / 6) * 360)
				out[#out + 1] = pp("ball", math.sin(a) * 0.5, 2.18, math.cos(a) * 0.5, 0.42, 0.34, 0.42, { 248, 244, 230 }, "SmoothPlastic") -- froth
			end
			return out
		end,
		mace = function(s)
			local steel = s.color or { 150, 152, 158 }
			local out = {
				pp("cylinder", 0, 1.5, 0, 3.0, 0.2, 0.2, { 82, 56, 38 }, "Wood", VROT), -- haft
				pp("ball", 0, 0.1, 0, 0.34, 0.34, 0.34, { 120, 100, 55 }, "Metal"), -- pommel
				pp("ball", 0, 3.35, 0, 1.0, 1.0, 1.0, { 120, 122, 128 }, "Metal"), -- head
				pp("cylinder", 0, 4.3, 0, 0.7, 0.2, 0.2, steel, "Metal", VROT), -- top spike
			}
			for _, gy in ipairs({ 0.6, 1.0, 1.4 }) do
				out[#out + 1] = pp("cylinder", 0, gy, 0, 0.12, 0.22, 0.22, { 48, 38, 28 }, "SmoothPlastic", VROT) -- grip bands
			end
			local function ring(cy, n, r, len, off)
				for i = 1, n do
					local a = (i / n) * 360 + off
					local rr = math.rad(a)
					out[#out + 1] = pp("cylinder", math.sin(rr) * r, cy, math.cos(rr) * r, len, 0.2, 0.2, steel, "Metal", { rot = { 0, a, 0 } }) -- spike
				end
			end
			ring(3.35, 8, 0.6, 0.7, 0)
			ring(3.78, 5, 0.45, 0.55, 30)
			ring(2.92, 5, 0.45, 0.55, 30)
			return out
		end,
	}
end

-- Scale a part spec's pos/size (+ light range) by k for uniform prop resizing.
local function scaleP(ps, k)
	if k == 1 then return ps end
	local s, p = ps.size or { 1, 1, 1 }, ps.pos or { 0, 0, 0 }
	local t = {}
	for key, v in pairs(ps) do t[key] = v end
	t.size = { s[1] * k, s[2] * k, s[3] * k }
	t.pos = { p[1] * k, p[2] * k, p[3] * k }
	if ps.light and ps.light.range then
		t.light = { color = ps.light.color, brightness = ps.light.brightness, range = ps.light.range * k }
	end
	return t
end

-- Opt-in CSG for props: SUBTRACT parts flagged `negate` (real hollow vessels), then
-- UNION the remaining solids into one smooth operation. Guarded — any failure leaves
-- the parts as-is and returns false. Returns true if a union replaced the parts.
local function csgProp(model)
	local solids, negs = {}, {}
	for _, p in ipairs(model:GetChildren()) do
		if p:IsA("BasePart") then
			if p:GetAttribute("__negate") then table.insert(negs, p) else table.insert(solids, p) end
		end
	end
	if #solids == 0 then return false end
	-- tri-budget guard: a CSG union simplifies/errors past Roblox's ~20k-tri cap, so skip CSG
	-- on very part-heavy props (keep them as separate parts) rather than risk a degenerate union.
	if (#solids + #negs) > 48 then return false end
	-- (BasePart:Union/SubtractAsync used here for reliability — they consume inputs and return
	-- the operation directly. GeometryService:UnionAsync is the recommended future path but
	-- returns an array + doesn't consume inputs; migrate once it can be verified post-restart.)
	local primary = table.remove(solids, 1)
	if #negs > 0 then
		local ok, res = pcall(function() return primary:SubtractAsync(negs) end)
		if not ok or typeof(res) ~= "Instance" or not res:IsA("BasePart") then return false end
		res.Parent = model
		primary = res
	end
	if #solids > 0 then
		local ok, res = pcall(function() return primary:UnionAsync(solids) end)
		if not ok or typeof(res) ~= "Instance" or not res:IsA("BasePart") then return false end
		res.Parent = model
		primary = res
	end
	primary.Name = model.Name .. "Union"
	primary.Anchored = true
	pcall(function() primary.UsePartColor = true end) -- keep the source parts' colours
	pcall(function() primary.CollisionFidelity = Enum.CollisionFidelity.Box end) -- cheap collision for small props
	pcall(function() primary.RenderFidelity = Enum.RenderFidelity.Precise end) -- crisp up-close render
		-- BasePart Union/SubtractAsync do NOT consume their inputs: the source parts and the
		-- intermediate subtract-union survive as orphan children. Destroy everything but the
		-- final union so the prop is ONE clean solid (not union + leftover raw parts).
		for _, p in ipairs(model:GetChildren()) do
			if p:IsA("BasePart") and p ~= primary then pcall(function() p:Destroy() end) end
		end
	model.PrimaryPart = primary
	return true
end

-- prop: a multi-part prop from either a named preset (spec.prop) or an explicit
-- `parts` list (relative to spec.center). Lets rbx_build make ANY prop (cigarette,
-- mug, lamp...) without a dedicated kind or execute_luau. Tagged parametric so the
-- Scale attribute (and spec edits) rebuild it in place like the furniture kinds.
-- With spec.csg it's instead unioned into one smooth solid (final bake, not parametric).
