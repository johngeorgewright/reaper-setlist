local GetSongLength = require "song_length"

---@return number project_length
local function GetLength()
    -- Report the song length derived from the `=START`/`=END` markers of the
    -- current project (falling back to the full project length when markers are
    -- absent). This is what the song editor stores as a song's duration.
    local project = reaper.EnumProjects(-1)
    return GetSongLength(project)
end

return GetLength
