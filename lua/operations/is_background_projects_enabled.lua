-- Action ID for "Project tabs: Run background projects (process audio when not active)"
local BACKGROUND_PROJECTS_ACTION_ID = 41816

---@return boolean enabled
local function IsBackgroundProjectsEnabled()
    -- GetToggleCommandState returns 1 when the toggle is on, 0 when off,
    -- and -1 if the command is not a toggle (shouldn't happen for 41816).
    return reaper.GetToggleCommandState(BACKGROUND_PROJECTS_ACTION_ID) == 1
end

return IsBackgroundProjectsEnabled
