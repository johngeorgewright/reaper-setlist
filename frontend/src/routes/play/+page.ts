import { getApi } from '$lib/api/api';
import type { Setlist } from '$lib/models/setlist';
import type { Song } from '$lib/models/song';
import type { Database } from '$lib/models/database';
import type { PageLoad } from './$types';

/**
 * Extract the `set` query parameter from the hash portion of the URL.
 *
 * SvelteKit's hash router treats the path after `#` as the active route, but
 * it does **not** lift any query string from that hash into `url.searchParams`.
 * `#/play?set=abc` arrives here as `url.pathname === '/'`, `url.hash === '#/play?set=abc'`,
 * so we parse it ourselves.
 */
function readSetIdFromHash(hash: string | undefined | null): string | undefined {
	if (!hash) return undefined;
	const qIndex = hash.indexOf('?');
	if (qIndex < 0) return undefined;
	const params = new URLSearchParams(hash.slice(qIndex + 1));
	return params.get('set') ?? undefined;
}

/**
 * Loads the playback context. When `?set=<id>` is present in the hash route
 * (e.g. `#/play?set=abc`) the matching setlist and the songs database it
 * references are fetched so the page can drive auto-advance via the playback
 * engine. Without the param the page falls back to its pre-existing
 * manual-only behaviour.
 */
export const load: PageLoad = async ({ fetch, url }) => {
	const setId = readSetIdFromHash(url.hash);
	if (!setId) {
		return { set: undefined, songs: {} as Database<Song> };
	}

	try {
		const api = getApi(fetch);
		const [set, songs] = await Promise.all([api.sets.get(setId), api.songs.list()]);
		return { set: set ?? undefined, songs } satisfies {
			set: Setlist | undefined;
			songs: Database<Song>;
		};
	} catch (error) {
		console.error('Failed to load setlist for /play:', error);
		return { set: undefined, songs: {} as Database<Song> };
	}
};
