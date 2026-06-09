/**
 * Per-item playback configuration. Determines what happens when the setlist
 * advances *into* this item from the previous one — see also `PlayConfigMode`
 * for the union of modes.
 *
 * The first item's `playConfig` is unused, since there is no previous item
 * to transition from. The user always starts the first song manually.
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

/**
 * Default values used when the editor switches an item's play config from one
 * mode to another. Centralised so the same defaults apply everywhere.
 */
export const DEFAULT_TIMER_DELAY_SECONDS = 3;
export const DEFAULT_CROSSOVER_LEAD_SECONDS = 2;

/**
 * Build a fresh `PlayConfig` for the given mode using the default numeric
 * values. Used by the editor when the user picks a different mode from the
 * dropdown — the discriminated union changes shape, so we need a constructor.
 */
export function defaultPlayConfig(mode: PlayConfigMode): PlayConfig {
	switch (mode) {
		case 'pause':
			return { mode: 'pause' };
		case 'play':
			return { mode: 'play' };
		case 'timer':
			return { mode: 'timer', delaySeconds: DEFAULT_TIMER_DELAY_SECONDS };
		case 'crossover':
			return { mode: 'crossover', leadSeconds: DEFAULT_CROSSOVER_LEAD_SECONDS };
	}
}
