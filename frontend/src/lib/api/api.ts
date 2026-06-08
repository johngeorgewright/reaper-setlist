import type { Setlist } from '../models/setlist';
import type { Song } from '../models/song';
import type { KeyValueStore } from './key-value-store';
import { MockReaperFetch } from './mock-backend/mock-reaper-fetch';
import type { ReaperApiClient } from './reaper-backend/reaper-api';
import { ReaperBackend } from './reaper-backend/reaper-backend';
import type { ReaperRpcClient } from './reaper-backend/reaper-rpc-client.svelte';
import type { ReaperScriptSettingsClient } from './reaper-backend/reaper-script-settings';

// Re-export for backward compatibility
export type { CommandResults, ReaperCommand } from './reaper-backend/commands';

export type SongsStore = KeyValueStore<string, Song>;

export interface SetlistsStore extends KeyValueStore<string, Setlist> {
	deleteSongFromSets(id: string): Promise<void>;
}

export interface Api {
	reaper: ReaperApiClient;
	songs: SongsStore;
	sets: SetlistsStore;
	script: ReaperRpcClient;
	scriptSettings: ReaperScriptSettingsClient;
}

/**
 * Singleton mock-fetch — created lazily on first use so SSR / tests that don't
 * touch it never pay the cost. Reused across `getApi` calls so its in-memory
 * state (open tabs, transport, ExtState cache) is consistent across the app.
 */
let mockFetch: MockReaperFetch | undefined;

function getMockFetch(): typeof globalThis.fetch {
	if (!mockFetch) {
		mockFetch = new MockReaperFetch();
	}
	return mockFetch.fetch as typeof globalThis.fetch;
}

function isMockEnabled(): boolean {
	// `import.meta.env.VITE_USE_MOCK` is statically replaced at build time.
	return import.meta.env?.VITE_USE_MOCK === 'true';
}

export function getApi(fetch?: typeof globalThis.fetch): Api {
	if (isMockEnabled()) {
		return new ReaperBackend(getMockFetch());
	}
	return new ReaperBackend(fetch);
}
