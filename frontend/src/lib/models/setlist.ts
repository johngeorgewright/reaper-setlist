/**
 * Per-item playback configuration. Determines what happens when the setlist
 * advances to this item — see also `PlayConfigMode` for the union of modes.
 *
 * Note: the first item in a setlist may only use `pause` or `timer`, since
 * `play` and `crossover` are defined relative to the previous item which
 * does not exist for index 0.
 */
export type PlayConfig =
	| { mode: 'pause' }
	| { mode: 'play' }
	| { mode: 'timer'; delaySeconds: number }
	| { mode: 'crossover'; leadSeconds: number };

export type PlayConfigMode = PlayConfig['mode'];

export interface SetlistItem {
	songId: string;
	playConfig: PlayConfig;
}

export interface Setlist extends SetlistCommon {
	id: string;
}

export interface NewSetlist extends SetlistCommon {
	id?: undefined; // explicitly undefined
}

interface SetlistCommon {
	date: string;
	venue: string;
	items: SetlistItem[];
}

/**
 * Legacy shape used before per-item playback config was introduced. Kept here
 * for the on-read migration in `ReaperSetlistStoreImpl`.
 */
export interface LegacySetlist {
	id: string;
	date: string;
	venue: string;
	songs: string[];
}

/**
 * Migrate a stored setlist record into the current shape, leaving already
 * migrated records untouched. Migration writes are deferred until the user
 * edits a setlist, so this function is safe to call on every read.
 */
export function migrateSetlist(raw: Setlist | LegacySetlist | Record<string, unknown>): Setlist {
	if (raw && typeof raw === 'object' && Array.isArray((raw as Setlist).items)) {
		return raw as Setlist;
	}
	const legacy = raw as LegacySetlist;
	const songs = Array.isArray(legacy.songs) ? legacy.songs : [];
	return {
		id: legacy.id,
		date: legacy.date,
		venue: legacy.venue,
		items: songs.map((songId) => ({ songId, playConfig: { mode: 'pause' } }))
	};
}
