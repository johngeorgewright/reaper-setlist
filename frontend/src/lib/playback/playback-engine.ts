import type { ReaperApiClient } from '../api/reaper-backend/reaper-api';
import type { ReaperTransport } from '../models/reaper-transport';
import { PLAYSTATE_PLAYING } from '../models/reaper-transport';
import type { PlayConfig, SetlistItem } from '../models/setlist';

/**
 * Result of a single engine tick. Returned for visibility/testing rather than
 * directly mutated state, so the caller (or a test) can react to the decision.
 */
export type EngineDecision =
	| { kind: 'noop' }
	| { kind: 'advance' } // switch to next tab + play immediately
	| { kind: 'scheduleAdvance'; afterMs: number }; // wait then advance + play

/**
 * Optional sink for advisory messages and host-driven side effects.
 */
export interface PlaybackEngineSink {
	warning?(message: string): void;
	/**
	 * Invoked after the engine successfully advances to the next tab and starts
	 * playback. The host should refresh tabs/markers so the UI catches up
	 * without waiting for the next poll interval.
	 */
	onAdvanced?(): void;
}

/**
 * Coordinates auto-advance between setlist items based on each item's
 * `playConfig`. The engine is *advisory* — the play page calls `onTransportTick`
 * on every poll and the engine decides whether to advance.
 *
 * State machine per song boundary:
 *  - "armed":   the next-item transition has not yet fired for the current item
 *  - "fired":   already advanced (or scheduled to advance); ignore further ticks
 *  - "reset":   cleared when the current tab index changes or `reset()` is called
 *
 * The engine does **not** own the polling loop or know about wall-clock time;
 * the host (play page) drives it. The single exception is `timer` mode: once
 * the trigger condition is met, a `setTimeout` is scheduled for the delay,
 * because by then transport position has stopped advancing.
 */
export class PlaybackEngine {
	private items: readonly SetlistItem[] = [];
	private currentIndex = -1;
	private firedForIndex: number | null = null;
	private timerHandle: ReturnType<typeof setTimeout> | null = null;
	private hasWarnedCrossover = false;

	constructor(
		private readonly reaper: ReaperApiClient,
		private readonly sink: PlaybackEngineSink = {}
	) {}

	/**
	 * Update the setlist this engine is coordinating. Resets all scheduled
	 * actions; call again whenever the active setlist changes.
	 */
	setItems(items: readonly SetlistItem[]): void {
		this.items = items;
		this.reset();
		this.maybeWarnCrossover();
	}

	/**
	 * Notify the engine that the active tab changed. Clears any pending
	 * scheduled advance and re-arms the next boundary.
	 */
	setCurrentIndex(index: number): void {
		if (index === this.currentIndex) return;
		this.currentIndex = index;
		this.firedForIndex = null;
		this.cancelTimer();
	}

	/**
	 * Drive a single engine tick. Returns the decision made for visibility;
	 * the engine has already initiated the action (e.g. fired the API call,
	 * scheduled a timer) by the time this returns.
	 */
	onTransportTick(transport: ReaperTransport, songEnd: number): EngineDecision {
		// Nothing to do if we're not playing the current song.
		if (transport.playState !== PLAYSTATE_PLAYING) return { kind: 'noop' };

		// Already advanced for this song — wait for tab change to re-arm.
		if (this.firedForIndex === this.currentIndex) return { kind: 'noop' };

		const nextIndex = this.currentIndex + 1;
		if (nextIndex < 0 || nextIndex >= this.items.length) return { kind: 'noop' };

		const upcoming = this.items[nextIndex];
		const timeRemaining = songEnd - transport.positionSeconds;

		const trigger = shouldTrigger(upcoming.playConfig, timeRemaining);
		if (!trigger.fire) return { kind: 'noop' };

		this.firedForIndex = this.currentIndex;

		if (trigger.delayMs > 0) {
			this.scheduleAdvance(trigger.delayMs);
			return { kind: 'scheduleAdvance', afterMs: trigger.delayMs };
		}

		void this.advance();
		return { kind: 'advance' };
	}

	/** Cancel any scheduled advance and clear the per-item trigger record. */
	reset(): void {
		this.firedForIndex = null;
		this.cancelTimer();
	}

	/** Tear down — call from the host's `onDestroy`. */
	dispose(): void {
		this.cancelTimer();
	}

	private scheduleAdvance(delayMs: number): void {
		this.cancelTimer();
		this.timerHandle = setTimeout(() => {
			this.timerHandle = null;
			void this.advance();
		}, delayMs);
	}

	private cancelTimer(): void {
		if (this.timerHandle !== null) {
			clearTimeout(this.timerHandle);
			this.timerHandle = null;
		}
	}

	private async advance(): Promise<void> {
		// `nextTab` returns `{ markers, transport }` but we only need to issue
		// the tab change; the host will pick up the new state on its next poll
		// (or immediately if it implements `onAdvanced`).
		await this.reaper.nextTab();
		await this.reaper.play();
		this.sink.onAdvanced?.();
	}

	private maybeWarnCrossover(): void {
		if (this.hasWarnedCrossover) return;
		const hasCrossover = this.items.some((item) => item.playConfig.mode === 'crossover');
		if (!hasCrossover) return;
		this.hasWarnedCrossover = true;
		this.sink.warning?.(
			'Crossover mode requires "Project tabs: Run background projects" to be enabled in Reaper. ' +
				'Without it, the previous song will pause when the next one starts.'
		);
	}
}

interface TriggerDecision {
	fire: boolean;
	delayMs: number;
}

/**
 * Pure decision function: given an upcoming item's play config and the time
 * (in seconds) remaining in the current song, decide whether to fire the
 * advance now and how long to wait before doing so.
 *
 * Exported for unit testing.
 */
export function shouldTrigger(config: PlayConfig, timeRemainingSeconds: number): TriggerDecision {
	switch (config.mode) {
		case 'pause':
			return { fire: false, delayMs: 0 };
		case 'play':
			// Fire when current song reaches its end.
			return timeRemainingSeconds <= 0 ? { fire: true, delayMs: 0 } : { fire: false, delayMs: 0 };
		case 'timer':
			// Fire when current song reaches its end, then wait `delaySeconds`.
			return timeRemainingSeconds <= 0
				? { fire: true, delayMs: Math.max(0, config.delaySeconds * 1000) }
				: { fire: false, delayMs: 0 };
		case 'crossover':
			// Fire `leadSeconds` *before* the end of the current song.
			return timeRemainingSeconds <= config.leadSeconds
				? { fire: true, delayMs: 0 }
				: { fire: false, delayMs: 0 };
	}
}
