--- Compute the playable length of a song using its `=START`/`=END` markers.
---
--- The length is the distance between the `=START` and `=END` markers. When a
--- marker is missing we fall back to sensible defaults so a project without
--- markers still reports a usable length:
---   * `=START` missing -> song starts at 0
---   * `=END`   missing -> song ends at the project length
---
--- This mirrors the frontend helpers `getSongStart` / `getSongEnd` so the value
--- discovered here matches the boundaries the player uses for transitions.
---
---@param project ReaProject
---@return number song_length
local function GetSongLength(project)
    local start_pos = 0
    local end_pos = nil

    local _, num_markers, num_regions = reaper.CountProjectMarkers(project)
    local total = num_markers + num_regions
    for i = 0, total - 1 do
        local _, is_region, pos, _, name = reaper.EnumProjectMarkers2(project, i)
        if not is_region then
            if name == "=START" then
                start_pos = pos
            elseif name == "=END" then
                end_pos = pos
            end
        end
    end

    if end_pos == nil then
        end_pos = reaper.GetProjectLength(project)
    end

    local length = end_pos - start_pos
    if length < 0 then
        length = 0
    end
    return length
end

return GetSongLength
