--!nocheck
-- Carries the `plugin` handle from the entry Script to the modules. The `plugin` global
-- is only guaranteed inside the plugin's main Script, so it is passed explicitly rather
-- than assumed. Required first, before any module that touches plugin settings.
local Ctx = {}
Ctx.plugin = nil
return Ctx
