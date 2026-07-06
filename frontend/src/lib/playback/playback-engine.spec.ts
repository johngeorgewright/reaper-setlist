import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReaperApiClient } from '../api/reaper-backend/reaper-api';
import {
	PLAYSTATE_PAUSED,
	PLAYSTATE_PLAYING,
	PLAYSTATE_STOPPED,
	type PlayState,
	type ReaperTransport
} from '../models/reaper-transport';
import type { SetlistItem } from '../models/setlist';
import { PlaybackEngine, shouldTrigger } from './playback-engine';

function transport(positionSeconds: number, state: PlayState = PLAYSTATE_PLAYING): ReaperTransport {
	return {
		playState: state,
		positionSeconds,
		repeatOn: false,
		positionString: '',
		positionStringBeats: ''
	};
}

function fakeReaper() {
	return {
		nextTab: vi.fn(async () => ({ markers: [], transport: transport(0, PLAYSTATE_STOPPED) })),
		play: vi.fn(async () => transport(0, PLAYSTATE_PLAYING)),
		stop: vi.fn(async () => transport(0, PLAYSTATE_STOPPED))
	} as unknown as ReaperApiClient & {
		nextTab: ReturnType<typeof vi.fn>;
		play: ReturnType<typeof vi.fn>;
		stop: ReturnType<typeof vi.fn>;
	};
}

/**
 * `advance()` is fire-and-forget and now chains several awaited API calls
 * (`stop` → `nextTab` → `play`). Flush enough microtasks for the whole chain
 * to settle before asserting on the spies.
 */
async function flushAdvance() {
	await vi.runAllTicks();
	for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('shouldTrigger', () => {
	it('never fires for pause', () => {
		expect(shouldTrigger({ mode: 'pause' }, 0).fire).toBe(false);
		expect(shouldTrigger({ mode: 'pause' }, -100).fire).toBe(false);
	});

	it('fires for play exactly at end of song', () => {
		expect(shouldTrigger({ mode: 'play' }, 5).fire).toBe(false);
		expect(shouldTrigger({ mode: 'play' }, 0)).toEqual({ fire: true, delayMs: 0 });
		expect(shouldTrigger({ mode: 'play' }, -0.5)).toEqual({ fire: true, delayMs: 0 });
	});

	it('fires for timer at end with the configured delay in ms', () => {
		expect(shouldTrigger({ mode: 'timer', delaySeconds: 3 }, 1).fire).toBe(false);
		expect(shouldTrigger({ mode: 'timer', delaySeconds: 3 }, 0)).toEqual({
			fire: true,
			delayMs: 3000
		});
	});

	it('fires for crossover when remaining time falls below the lead', () => {
		expect(shouldTrigger({ mode: 'crossover', leadSeconds: 4 }, 5).fire).toBe(false);
		expect(shouldTrigger({ mode: 'crossover', leadSeconds: 4 }, 4)).toEqual({
			fire: true,
			delayMs: 0
		});
		expect(shouldTrigger({ mode: 'crossover', leadSeconds: 4 }, 0)).toEqual({
			fire: true,
			delayMs: 0
		});
	});
});

describe('PlaybackEngine', () => {
	let reaper: ReturnType<typeof fakeReaper>;
	let engine: PlaybackEngine;

	const items = (modes: SetlistItem['playConfig'][]): SetlistItem[] =>
		modes.map((mode, i) => ({ songId: `s${i}`, playConfig: mode }));

	beforeEach(() => {
		vi.useFakeTimers();
		reaper = fakeReaper();
		engine = new PlaybackEngine(reaper);
	});

	it('is a no-op when not playing', () => {
		engine.setItems(items([{ mode: 'pause' }, { mode: 'play' }]));
		engine.setCurrentIndex(0);
		const decision = engine.onTransportTick(transport(100, PLAYSTATE_PAUSED), 60);
		expect(decision).toEqual({ kind: 'noop' });
		expect(reaper.nextTab).not.toHaveBeenCalled();
	});

	it('is a no-op on the last item', () => {
		engine.setItems(items([{ mode: 'pause' }, { mode: 'play' }]));
		engine.setCurrentIndex(1);
		const decision = engine.onTransportTick(transport(200), 60);
		expect(decision).toEqual({ kind: 'noop' });
		expect(reaper.nextTab).not.toHaveBeenCalled();
	});

	it('advances at end-of-song for mode "play"', async () => {
		engine.setItems(items([{ mode: 'pause' }, { mode: 'play' }]));
		engine.setCurrentIndex(0);
		const decision = engine.onTransportTick(transport(60), 60);
		expect(decision).toEqual({ kind: 'advance' });
		// `advance()` is fire-and-forget; await microtasks.
		await flushAdvance();
		expect(reaper.nextTab).toHaveBeenCalledTimes(1);
		expect(reaper.play).toHaveBeenCalledTimes(1);
	});

	it('stops the previous song before switching for a clean cut', async () => {
		engine.setItems(items([{ mode: 'pause' }, { mode: 'play' }]));
		engine.setCurrentIndex(0);
		engine.onTransportTick(transport(60), 60);
		await flushAdvance();
		expect(reaper.stop).toHaveBeenCalledTimes(1);
		expect(reaper.nextTab).toHaveBeenCalledTimes(1);
	});

	it('fires only once per boundary even across multiple ticks', async () => {
		engine.setItems(items([{ mode: 'pause' }, { mode: 'play' }]));
		engine.setCurrentIndex(0);
		engine.onTransportTick(transport(60), 60);
		engine.onTransportTick(transport(60.5), 60);
		engine.onTransportTick(transport(61), 60);
		await flushAdvance();
		expect(reaper.nextTab).toHaveBeenCalledTimes(1);
	});

	it('re-arms after the current index changes', async () => {
		engine.setItems(items([{ mode: 'pause' }, { mode: 'play' }, { mode: 'play' }]));
		engine.setCurrentIndex(0);
		engine.onTransportTick(transport(60), 60); // fires for boundary 0→1
		engine.setCurrentIndex(1);
		engine.onTransportTick(transport(60), 60); // fires for boundary 1→2
		await flushAdvance();
		expect(reaper.nextTab).toHaveBeenCalledTimes(2);
	});

	it('schedules a delayed advance for mode "timer"', async () => {
		engine.setItems(items([{ mode: 'pause' }, { mode: 'timer', delaySeconds: 5 }]));
		engine.setCurrentIndex(0);
		const decision = engine.onTransportTick(transport(60), 60);
		expect(decision).toEqual({ kind: 'scheduleAdvance', afterMs: 5000 });
		expect(reaper.nextTab).not.toHaveBeenCalled();

		vi.advanceTimersByTime(4999);
		expect(reaper.nextTab).not.toHaveBeenCalled();

		vi.advanceTimersByTime(2);
		await flushAdvance();
		expect(reaper.nextTab).toHaveBeenCalledTimes(1);
	});

	it('cancels a pending timer when the tab changes', () => {
		engine.setItems(items([{ mode: 'pause' }, { mode: 'timer', delaySeconds: 5 }]));
		engine.setCurrentIndex(0);
		engine.onTransportTick(transport(60), 60);
		engine.setCurrentIndex(1); // user advanced manually
		vi.advanceTimersByTime(10_000);
		expect(reaper.nextTab).not.toHaveBeenCalled();
	});

	it('fires crossover before the end based on leadSeconds', () => {
		engine.setItems(items([{ mode: 'pause' }, { mode: 'crossover', leadSeconds: 4 }]));
		engine.setCurrentIndex(0);
		engine.onTransportTick(transport(55), 60); // 5s remaining, threshold 4 — no
		expect(reaper.nextTab).not.toHaveBeenCalled();
		engine.onTransportTick(transport(56), 60); // 4s remaining — fire
		expect(reaper.nextTab).toHaveBeenCalledTimes(1);
	});

	it('does not stop the previous song for crossover (overlap)', async () => {
		engine.setItems(items([{ mode: 'pause' }, { mode: 'crossover', leadSeconds: 4 }]));
		engine.setCurrentIndex(0);
		engine.onTransportTick(transport(56), 60); // 4s remaining — fire
		await flushAdvance();
		expect(reaper.stop).not.toHaveBeenCalled();
		expect(reaper.nextTab).toHaveBeenCalledTimes(1);
		expect(reaper.play).toHaveBeenCalledTimes(1);
	});
});
