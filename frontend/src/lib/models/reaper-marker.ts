export interface ReaperMarker {
	id: number;
	name: string;
	position: number; // in seconds
}

/**
 * Reaper convention (matches the subproject syntax): a marker named exactly
 * `=START` defines where a song begins inside a project, and `=END` where it
 * ends. When absent, the project plays from 0 to the tab's length.
 */
export const SONG_START_MARKER = '=START';
export const SONG_END_MARKER = '=END';

/**
 * Position at which the song should start playing. Falls back to 0 when no
 * `=START` marker exists.
 */
export function getSongStart(markers: readonly ReaperMarker[]): number {
	const marker = markers.find((m) => m.name === SONG_START_MARKER);
	return marker ? marker.position : 0;
}

/**
 * Position at which the song is considered finished. Falls back to the tab's
 * project length when no `=END` marker exists.
 */
export function getSongEnd(markers: readonly ReaperMarker[], tabLength: number): number {
	const marker = markers.find((m) => m.name === SONG_END_MARKER);
	return marker ? marker.position : tabLength;
}
