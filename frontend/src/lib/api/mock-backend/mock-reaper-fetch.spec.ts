import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SetStateCommand } from '../reaper-backend/commands';
import { ReaperBackend } from '../reaper-backend/reaper-backend';
import { SectionKeys } from '../reaper-backend/reaper-state';
import { PlaybackEngine } from '$lib/playback/playback-engine';
import {
	PLAYSTATE_PAUSED,
	PLAYSTATE_PLAYING,
	PLAYSTATE_STOPPED
} from '$lib/models/reaper-transport';
import type { Setlist, SetlistItem } from '$lib/models/setlist';
import type { ReaperTransport } from '$lib/models/reaper-transport';
import type { Song } from '$lib/models/song';
import { configuration } from '$lib/stores/configuration.svelte';
import { MockReaperFetch } from './mock-reaper-fetch';

/**
 * These tests exercise the real ReaperBackend -> ReaperApiClient ->
 * MockReaperFetch path. They prove the mock speaks Reaper's wire protocol
 * well enough for the production code paths to drive it.
 *
 * Runs in the node-side vitest project (no DOM): no window, so the mock's
 * 100ms ticker is suppressed; no localStorage, so each test starts with a
 * clean ExtState. Both behaviours are guarded inside MockReaperFetch.
 */

let mock: MockReaperFetch;
let backend: ReaperBackend;

beforeEach(async () => {
	mock = new MockReaperFetch();
	const fetchFn = mock.fetch as typeof globalThis.fetch;
	backend = new ReaperBackend(fetchFn);
	// Configuration is a singleton; prime it via the mock so RunScriptCommand
	// can resolve a script action ID. The mock pre-seeds `_RS_MOCK` for us.
	await configuration.ensureInitialized(fetchFn);
});

afterEach(() => {
	mock.dispose();
});

describe('MockReaperFetch via ReaperBackend', () => {
	it('reports an idle transport before any tab is open', async () => {
		const transport = await backend.reaper.getTransport();
		expect(transport.playState).toBe(PLAYSTATE_STOPPED);
		expect(transport.positionSeconds).toBe(0);
	});

	it('opens a project and surfaces it through getOpenTabs', async () => {
		await backend.reaper.newTab();
		await backend.script.openProject('/mock/projects/SongA.rpp');

		const { tabs } = await backend.script.getOpenTabs();
		expect(tabs).toHaveLength(1);
		expect(tabs[0].name).toBe('SongA.rpp');
		expect(tabs[0].length).toBeGreaterThan(0);
	});

	it('exposes simulated =START and =END markers on every project', async () => {
		await backend.reaper.newTab();
		await backend.script.openProject('/mock/projects/Song.rpp');

		const markers = await backend.reaper.getMarkers();
		const names = markers.map((m) => m.name);
		expect(names).toContain('=START');
		expect(names).toContain('=END');
		const end = markers.find((m) => m.name === '=END')!;
		expect(end.position).toBeGreaterThan(0);
	});

	it('toggles transport state via play/pause', async () => {
		await backend.reaper.newTab();
		await backend.script.openProject('/mock/projects/SongA.rpp');

		const playing = await backend.reaper.play();
		expect(playing.playState).toBe(PLAYSTATE_PLAYING);

		const paused = await backend.reaper.pause();
		expect(paused.playState).toBe(PLAYSTATE_PAUSED);
	});

	it('seeks to an arbitrary position via SET/POS_STR/<seconds>', async () => {
		await backend.reaper.newTab();
		await backend.script.openProject('/mock/projects/SongA.rpp');

		await mock.fetch('http://x/_/SET/POS_STR/42.5');
		const transport = await backend.reaper.getTransport();
		expect(transport.positionSeconds).toBeCloseTo(42.5, 3);
	});

	it('reports the simulated background-projects toggle state', async () => {
		// Defaults to off; the mock exposes a test hook for flipping it.
		expect(await backend.script.isBackgroundProjectsEnabled()).toBe(false);
		mock.setBackgroundProjectsEnabled(true);
		expect(await backend.script.isBackgroundProjectsEnabled()).toBe(true);
		mock.setBackgroundProjectsEnabled(false);
		expect(await backend.script.isBackgroundProjectsEnabled()).toBe(false);
	});

	it('treats action 41816 as a toggle for background-projects', async () => {
		expect(await backend.script.isBackgroundProjectsEnabled()).toBe(false);
		await backend.reaper.sendCommand('41816');
		expect(await backend.script.isBackgroundProjectsEnabled()).toBe(true);
		await backend.reaper.sendCommand('41816');
		expect(await backend.script.isBackgroundProjectsEnabled()).toBe(false);
	});

	it('round-trips songs through the KVS', async () => {
		const song: Omit<Song, 'id'> = {
			name: 'Test Song',
			length: 120,
			path: '/mock/projects/Test.rpp'
		};
		const saved = await backend.songs.add(song);
		expect(saved.id).toBeTruthy();

		const fetched = await backend.songs.get(saved.id);
		expect(fetched).toEqual(saved);

		const all = await backend.songs.list();
		expect(Object.keys(all)).toEqual([saved.id]);
		expect(all[saved.id]).toEqual(saved);
	});

	it('migrates legacy setlists transparently on read', async () => {
		// Inject a legacy-shaped setlist directly into ExtState bypassing the
		// store layer, simulating data persisted by an older app version.
		const legacy = {
			id: 'legacy-1',
			venue: 'Old Hall',
			date: '2024-01-01T00:00:00.000Z',
			songs: ['s1', 's2', 's3']
		};
		await backend.reaper.executeCommand(
			new SetStateCommand(SectionKeys.Sets, '__index__', JSON.stringify(['legacy-1']), true)
		);
		await backend.reaper.executeCommand(
			new SetStateCommand(SectionKeys.Sets, 'legacy-1', JSON.stringify(legacy), true)
		);

		const got = (await backend.sets.get('legacy-1')) as Setlist;
		expect(got.items).toHaveLength(3);
		expect(got.items.map((i) => i.songId)).toEqual(['s1', 's2', 's3']);
		expect(got.items.every((i) => i.playConfig.mode === 'pause')).toBe(true);
	});
});

describe('PlaybackEngine + MockReaperFetch end-to-end', () => {
	const playItems: SetlistItem[] = [
		{ songId: 'a', playConfig: { mode: 'pause' } },
		{ songId: 'b', playConfig: { mode: 'play' } }
	];

	const crossoverItems: SetlistItem[] = [
		{ songId: 'a', playConfig: { mode: 'pause' } },
		{ songId: 'b', playConfig: { mode: 'crossover', leadSeconds: 5 } }
	];

	async function openTwoTabs(): Promise<void> {
		await backend.reaper.newTab();
		await backend.script.openProject('/mock/projects/SongA.rpp');
		await backend.reaper.newTab();
		await backend.script.openProject('/mock/projects/SongB.rpp');
		await backend.reaper.previousTab();
	}

	function tickAt(positionSeconds: number): ReaperTransport {
		return {
			playState: PLAYSTATE_PLAYING,
			positionSeconds,
			repeatOn: false,
			positionString: '',
			positionStringBeats: ''
		};
	}

	it('advances the active tab when end-of-song is reached', async () => {
		await openTwoTabs();
		await backend.reaper.play();

		let resolveAdvanced!: () => void;
		const advanced = new Promise<void>((r) => (resolveAdvanced = r));
		const engine = new PlaybackEngine(backend.reaper, {
			onAdvanced: () => resolveAdvanced()
		});
		engine.setItems(playItems);
		engine.setCurrentIndex(0);

		// Drive a tick at end-of-song. The transport object passed here (not
		// the mock's internal position) drives the engine's decision.
		engine.onTransportTick(tickAt(60), 60);

		await advanced;

		const { activeIndex } = await backend.script.getOpenTabs();
		expect(activeIndex).toBe(1);
		const transport = await backend.reaper.getTransport();
		expect(transport.playState).toBe(PLAYSTATE_PLAYING);

		engine.dispose();
	});

	it('fires crossover leadSeconds before the end and starts the next tab', async () => {
		await openTwoTabs();
		await backend.reaper.play();

		let resolveAdvanced!: () => void;
		const advanced = new Promise<void>((r) => (resolveAdvanced = r));
		const engine = new PlaybackEngine(backend.reaper, {
			onAdvanced: () => resolveAdvanced()
		});
		engine.setItems(crossoverItems);
		engine.setCurrentIndex(0);

		// Lead is 5s. With songEnd=60 these ticks have 6s and then 5s remaining.
		engine.onTransportTick(tickAt(54), 60); // 6s remaining — no fire yet
		let { activeIndex } = await backend.script.getOpenTabs();
		expect(activeIndex).toBe(0);

		engine.onTransportTick(tickAt(55), 60); // 5s remaining — fire
		await advanced;

		({ activeIndex } = await backend.script.getOpenTabs());
		expect(activeIndex).toBe(1);
		const transport = await backend.reaper.getTransport();
		expect(transport.playState).toBe(PLAYSTATE_PLAYING);

		engine.dispose();
	});
});
