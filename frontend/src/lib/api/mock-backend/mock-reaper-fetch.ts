import type { PlayState } from '$lib/models/reaper-transport';
import {
	PLAYSTATE_PAUSED,
	PLAYSTATE_PLAYING,
	PLAYSTATE_RECORDING,
	PLAYSTATE_STOPPED
} from '$lib/models/reaper-transport';
import type { ReaperMarker } from '$lib/models/reaper-marker';
import { getSongEnd, getSongStart } from '$lib/models/reaper-marker';
import type { ReaperTab } from '$lib/models/reaper-tab';
import { SectionKeys, ScriptOperationKey } from '../reaper-backend/reaper-state';

const MOCK_ACTION_ID = '_RS_MOCK';
const MOCK_ROOT_FOLDER = '/mock/projects';
const STORAGE_KEY = 'reaper-setlist-mock-extstate';
const TICK_INTERVAL_MS = 100;

interface MockTab {
	index: number;
	name: string;
	path: string;
	length: number;
	dirty: boolean;
	position: number;
	markers: ReaperMarker[];
}

/**
 * In-memory + localStorage-backed simulation of Reaper's web command surface.
 * Implements the `fetch` interface so it can be passed to the real
 * `ReaperBackend` constructor, exercising the production code path while
 * the dev server runs without an actual Reaper instance.
 */
export class MockReaperFetch {
	/** Persistent: ExtState section -> key -> value (mirrors Reaper's GetExtState). */
	private extState: Map<string, Map<string, string>>;

	/** Volatile: open project tabs. */
	private tabs: MockTab[] = [];
	private activeIndex = -1;

	/** Volatile: transport state. */
	private playState: PlayState = PLAYSTATE_STOPPED;
	private repeatOn = false;

	/**
	 * Simulated state of action 41816 — "Project tabs: Run background
	 * projects". Real Reaper persists this preference across restarts; the
	 * mock mirrors that by storing it in ExtState. Tests can flip it with
	 * `setBackgroundProjectsEnabled`; the play page also flips it by sending
	 * the 41816 action directly.
	 */
	private backgroundProjectsEnabled = false;

	private tickHandle: number | null = null;

	constructor() {
		this.extState = this.loadExtState();
		this.ensureMockDefaults();
		this.backgroundProjectsEnabled =
			this.getExtState(SectionKeys.ReaperSetlist, 'mockBackgroundProjects') === 'true';
		this.startTicker();
	}

	/**
	 * Bound `fetch`-compatible function. Pass this to `ReaperBackend(fetch)`.
	 */
	fetch = async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
		const url =
			typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
		// Strip everything up to and including `/_/`
		const idx = url.indexOf('/_/');
		const path = idx >= 0 ? url.slice(idx + 3) : url;

		const commandStrings = path.split(';');
		const responseLines: string[] = [];

		for (const raw of commandStrings) {
			const cmd = decodeURI(raw);
			const lines = this.executeCommand(cmd);
			for (const line of lines) {
				responseLines.push(line);
			}
		}

		// Reaper's web surface terminates each line (including the last) with `\n`.
		const body = responseLines.length > 0 ? responseLines.join('\n') + '\n' : '';
		return new Response(body, { status: 200 });
	};

	/** Stop the internal ticker — useful for tests. */
	dispose(): void {
		if (this.tickHandle !== null) {
			clearInterval(this.tickHandle);
			this.tickHandle = null;
		}
	}

	/**
	 * Test hook: toggle the simulated state of action 41816 ("Project tabs:
	 * Run background projects"). The `isBackgroundProjectsEnabled` script
	 * operation reads this flag.
	 */
	setBackgroundProjectsEnabled(enabled: boolean): void {
		this.backgroundProjectsEnabled = enabled;
		this.setExtState(
			SectionKeys.ReaperSetlist,
			'mockBackgroundProjects',
			enabled ? 'true' : 'false'
		);
	}

	// --- command dispatch -------------------------------------------------

	private executeCommand(cmd: string): string[] {
		// Query commands
		if (cmd === 'TRANSPORT') return [this.formatTransport()];
		if (cmd === 'MARKER') return this.formatMarkers();

		// EXTSTATE I/O
		if (cmd.startsWith('GET/EXTSTATE/') || cmd.startsWith('GET/EXTSTATE_PERSIST/')) {
			const after = cmd.startsWith('GET/EXTSTATE/')
				? cmd.slice('GET/EXTSTATE/'.length)
				: cmd.slice('GET/EXTSTATE_PERSIST/'.length);
			const slash = after.indexOf('/');
			const section = after.slice(0, slash);
			const key = after.slice(slash + 1);
			return [this.formatExtStateGet(section, key)];
		}
		if (cmd.startsWith('SET/EXTSTATEPERSIST/') || cmd.startsWith('SET/EXTSTATE/')) {
			const prefix = cmd.startsWith('SET/EXTSTATEPERSIST/')
				? 'SET/EXTSTATEPERSIST/'
				: 'SET/EXTSTATE/';
			const after = cmd.slice(prefix.length);
			// Format: section/key/value (the value is `encodeURIComponent`'d by the
			// client so `/` inside an encoded value becomes `%2F` and won't split
			// across `/` boundaries here).
			const firstSlash = after.indexOf('/');
			const secondSlash = after.indexOf('/', firstSlash + 1);
			const section = after.slice(0, firstSlash);
			const key = after.slice(firstSlash + 1, secondSlash);
			const value = decodeURIComponent(after.slice(secondSlash + 1));
			this.setExtState(section, key, value);
			return [];
		}

		// Position seek:
		//   SET/POS_STR/m{markerId} — jump to a named marker
		//   SET/POS_STR/<seconds>   — jump to an absolute position (Reaper accepts
		//                              a variety of time formats here; we support
		//                              the plain-seconds form which is enough for
		//                              tests/automation).
		if (cmd.startsWith('SET/POS_STR/')) {
			const target = cmd.slice('SET/POS_STR/'.length);
			const tab = this.activeTab();
			if (tab) {
				if (target.startsWith('m')) {
					const id = parseInt(target.slice(1), 10);
					const marker = tab.markers.find((m) => m.id === id);
					if (marker) tab.position = marker.position;
				} else {
					const seconds = Number(target);
					if (Number.isFinite(seconds) && seconds >= 0) tab.position = seconds;
				}
			}
			return [];
		}

		// Reaper actions (numeric command IDs)
		switch (cmd) {
			case '1007': // Transport: Play
				if (this.activeTab()) this.playState = PLAYSTATE_PLAYING;
				return [];
			case '1008': // Transport: Pause
				this.playState = this.playState === PLAYSTATE_PLAYING ? PLAYSTATE_PAUSED : this.playState;
				return [];
			case '1016': // Transport: Stop
				this.playState = PLAYSTATE_STOPPED;
				return [];
			case '1013': // Transport: Record
				if (this.activeTab()) this.playState = PLAYSTATE_RECORDING;
				return [];
			case '40042': // Transport: Go to start
				if (this.activeTab()) this.activeTab()!.position = 0;
				return [];
			case '40859': // New project tab
				this.openNewTab();
				return [];
			case '40860': // Close current project tab
				this.closeActiveTab();
				return [];
			case '40861': // Next tab
				if (this.tabs.length > 0) this.activeIndex = (this.activeIndex + 1) % this.tabs.length;
				return [];
			case '40862': // Previous tab
				if (this.tabs.length > 0)
					this.activeIndex = (this.activeIndex - 1 + this.tabs.length) % this.tabs.length;
				return [];
			case '40886': // Close all tabs
				this.tabs = [];
				this.activeIndex = -1;
				this.playState = PLAYSTATE_STOPPED;
				return [];
			case '41816': // Project tabs: Run background projects (toggle)
				this.setBackgroundProjectsEnabled(!this.backgroundProjectsEnabled);
				return [];
		}

		// Script action: dispatch the Operation extstate value to a mock handler.
		if (cmd === MOCK_ACTION_ID) {
			this.runScriptAction();
			return [];
		}

		// Unknown command — silently ignore (Reaper would too).
		return [];
	}

	// --- formatting -------------------------------------------------------

	private formatTransport(): string {
		const tab = this.activeTab();
		const pos = tab?.position ?? 0;
		const positionString = this.formatTimecode(pos);
		const positionStringBeats = `${Math.floor(pos / 2) + 1}.${(Math.floor(pos) % 2) + 1}.00`;
		return [
			'TRANSPORT',
			String(this.playState),
			pos.toFixed(6),
			this.repeatOn ? '1' : '0',
			positionString,
			positionStringBeats
		].join('\t');
	}

	private formatMarkers(): string[] {
		const tab = this.activeTab();
		const lines: string[] = ['MARKER_LIST'];
		if (tab) {
			for (const m of tab.markers) {
				lines.push(['MARKER', m.name, String(m.id), m.position.toFixed(6)].join('\t'));
			}
		}
		lines.push('MARKER_LIST_END');
		return lines;
	}

	private formatTimecode(seconds: number): string {
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		const ms = Math.floor((seconds - Math.floor(seconds)) * 1000);
		return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
	}

	private formatExtStateGet(section: string, key: string): string {
		const value = this.getExtState(section, key);
		if (value === undefined) {
			// Reaper returns the header without a value when the key is unset.
			return ['EXTSTATE', section, key].join('\t');
		}
		return ['EXTSTATE', section, key, value].join('\t');
	}

	// --- script-action operations ----------------------------------------

	private runScriptAction(): void {
		const operation = this.getExtState(SectionKeys.ReaperSetlist, ScriptOperationKey);
		if (!operation) return;
		this.deleteExtState(SectionKeys.ReaperSetlist, ScriptOperationKey);

		const handler = this.scriptOperations[operation];
		if (handler) {
			try {
				handler();
			} catch (err) {
				// Mirror Lua-side `safe_operation`: log but do not crash.
				console.error(`Mock script operation '${operation}' failed:`, err);
			}
		} else {
			console.warn(`Mock: unknown script operation '${operation}'`);
		}
	}

	private scriptOperations: Record<string, () => void> = {
		listProjects: () => {
			const projects = [
				`${MOCK_ROOT_FOLDER}/Demo Song A.rpp`,
				`${MOCK_ROOT_FOLDER}/Demo Song B.rpp`,
				`${MOCK_ROOT_FOLDER}/Demo Song C.rpp`,
				`${MOCK_ROOT_FOLDER}/Demo Song D.rpp`
			];
			this.setExtState(SectionKeys.ReaperSetlist, 'projects', JSON.stringify(projects));
		},
		testProjectsFolder: () => {
			const folderPath = this.consumeExtState(SectionKeys.ReaperSetlist, 'folderPath');
			const valid = !!folderPath && folderPath.length > 0;
			this.setExtState(SectionKeys.ReaperSetlist, 'valid', valid ? 'true' : 'false');
			this.setExtState(
				SectionKeys.ReaperSetlist,
				'message',
				valid ? `Mock: '${folderPath}' accepted.` : 'Mock: empty folder path.'
			);
		},
		openProject: () => {
			const projectPath = this.consumeExtState(SectionKeys.ReaperSetlist, 'projectPath');
			if (projectPath) this.openProjectInActiveTab(projectPath);
		},
		testActionId: () => {
			this.consumeExtState(SectionKeys.ReaperSetlist, 'testNonce');
			this.setExtState(
				SectionKeys.ReaperSetlist,
				'testOutput',
				`Test action ID received: ${MOCK_ACTION_ID}`
			);
		},
		getProjectLength: () => {
			const tab = this.activeTab();
			const length = tab ? this.songLengthFor(tab) : 0;
			this.setExtState(SectionKeys.ReaperSetlist, 'projectLength', length.toFixed(6));
		},
		getOpenTabs: () => {
			const tabs: ReaperTab[] = this.tabs.map((t) => ({
				index: t.index,
				name: t.name,
				length: this.songLengthFor(t),
				dirty: t.dirty
			}));
			this.setExtState(SectionKeys.ReaperSetlist, 'tabs', JSON.stringify(tabs));
			this.setExtState(
				SectionKeys.ReaperSetlist,
				'activeIndex',
				String(Math.max(0, this.activeIndex))
			);
		},
		writeChunkedData: () => {
			const section = this.consumeExtState(SectionKeys.ReaperSetlist, 'section');
			const key = this.consumeExtState(SectionKeys.ReaperSetlist, 'key');
			const lengthStr = this.consumeExtState(SectionKeys.ReaperSetlist, 'chunks_length');
			if (!section || !key || !lengthStr) return;
			const length = parseInt(lengthStr, 10);
			let combined = '';
			for (let i = 0; i < length; i++) {
				const chunk = this.consumeExtState(SectionKeys.ReaperSetlist, `chunks_${i}`);
				if (chunk !== undefined) combined += chunk;
			}
			this.setExtState(section, key, combined);
		},
		deleteState: () => {
			const section = this.consumeExtState(SectionKeys.ReaperSetlist, 'section');
			const key = this.consumeExtState(SectionKeys.ReaperSetlist, 'key');
			if (section && key) this.deleteExtState(section, key);
		},
		isBackgroundProjectsEnabled: () => {
			this.setExtState(
				SectionKeys.ReaperSetlist,
				'enabled',
				this.backgroundProjectsEnabled ? 'true' : 'false'
			);
		}
	};

	// --- tab/transport simulation ----------------------------------------

	private activeTab(): MockTab | undefined {
		return this.activeIndex >= 0 ? this.tabs[this.activeIndex] : undefined;
	}

	private openNewTab(): void {
		const tab: MockTab = {
			index: this.tabs.length,
			name: 'untitled.rpp',
			path: '',
			length: 0,
			dirty: false,
			position: 0,
			markers: []
		};
		this.tabs.push(tab);
		this.activeIndex = this.tabs.length - 1;
		this.playState = PLAYSTATE_STOPPED;
	}

	private closeActiveTab(): void {
		if (this.activeIndex < 0) return;
		this.tabs.splice(this.activeIndex, 1);
		this.tabs.forEach((t, i) => (t.index = i));
		if (this.tabs.length === 0) {
			this.activeIndex = -1;
		} else if (this.activeIndex >= this.tabs.length) {
			this.activeIndex = this.tabs.length - 1;
		}
		this.playState = PLAYSTATE_STOPPED;
	}

	private openProjectInActiveTab(projectPath: string): void {
		const name = projectPath.split('/').pop() ?? projectPath;
		const length = this.simulatedLengthFor(projectPath);
		const tab = this.activeTab();
		const replacement: MockTab = {
			index: tab?.index ?? this.tabs.length,
			name,
			path: projectPath,
			length,
			dirty: false,
			position: 0,
			markers: this.simulatedMarkersFor(projectPath, length)
		};
		if (tab) {
			this.tabs[this.activeIndex] = replacement;
		} else {
			this.tabs.push(replacement);
			this.activeIndex = this.tabs.length - 1;
		}
	}

	/**
	 * Song length derived from a tab's `=START`/`=END` markers, mirroring the
	 * Lua `song_length` helper (span between the markers, falling back to the
	 * full project length when a marker is missing).
	 */
	private songLengthFor(tab: MockTab): number {
		const end = getSongEnd(tab.markers, tab.length);
		const start = getSongStart(tab.markers);
		return Math.max(0, end - start);
	}

	/** Deterministic 60–300s length keyed by project path. */
	private simulatedLengthFor(path: string): number {
		let h = 0;
		for (let i = 0; i < path.length; i++) h = (h * 31 + path.charCodeAt(i)) | 0;
		return 60 + (Math.abs(h) % 240);
	}

	/** Always include `=START` and `=END` markers so playback logic can be exercised. */
	private simulatedMarkersFor(path: string, length: number): ReaperMarker[] {
		// Offset `=START` by a small count-in so the marker-based start position
		// (and length) is distinguishable from the raw project start at 0.
		const start = Math.min(2, Math.max(0, length - 1));
		return [
			{ id: 1, name: '=START', position: start },
			{ id: 2, name: '=END', position: Math.max(start, length - 1) }
		];
	}

	private startTicker(): void {
		// Skip in non-browser environments (SSR / unit tests) — no window means
		// nothing meaningful to advance and a runaway interval can hold the
		// process open.
		if (typeof window === 'undefined') return;
		this.tickHandle = setInterval(() => this.tick(), TICK_INTERVAL_MS) as unknown as number;
	}

	private tick(): void {
		const tab = this.activeTab();
		if (!tab) return;
		if (this.playState === PLAYSTATE_PLAYING || this.playState === PLAYSTATE_RECORDING) {
			// Match Reaper's behaviour: the transport keeps running past the end
			// of media (playhead advances into silence) unless the user stops it.
			// Mirroring this matters for the playback engine, which only fires
			// auto-advance while playState === PLAYING.
			tab.position += TICK_INTERVAL_MS / 1000;
		}
	}

	// --- ExtState persistence --------------------------------------------

	private getExtState(section: string, key: string): string | undefined {
		return this.extState.get(section)?.get(key);
	}

	private setExtState(section: string, key: string, value: string): void {
		let bucket = this.extState.get(section);
		if (!bucket) {
			bucket = new Map();
			this.extState.set(section, bucket);
		}
		bucket.set(key, value);
		this.persistExtState();
	}

	private deleteExtState(section: string, key: string): void {
		this.extState.get(section)?.delete(key);
		this.persistExtState();
	}

	private consumeExtState(section: string, key: string): string | undefined {
		const value = this.getExtState(section, key);
		if (value !== undefined) this.deleteExtState(section, key);
		return value;
	}

	private loadExtState(): Map<string, Map<string, string>> {
		try {
			if (typeof localStorage === 'undefined') return new Map();
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return new Map();
			const parsed = JSON.parse(raw) as Record<string, Record<string, string>>;
			const out = new Map<string, Map<string, string>>();
			for (const [section, kv] of Object.entries(parsed)) {
				out.set(section, new Map(Object.entries(kv)));
			}
			return out;
		} catch (err) {
			console.warn('Mock: failed to load persisted ExtState:', err);
			return new Map();
		}
	}

	private persistExtState(): void {
		try {
			if (typeof localStorage === 'undefined') return;
			const obj: Record<string, Record<string, string>> = {};
			for (const [section, kv] of this.extState) {
				obj[section] = Object.fromEntries(kv);
			}
			localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
		} catch (err) {
			console.warn('Mock: failed to persist ExtState:', err);
		}
	}

	private ensureMockDefaults(): void {
		// Pre-seed the script action ID and project root so the setup flow can be
		// skipped by default in mock mode.
		if (!this.getExtState(SectionKeys.ReaperSetlist, 'ScriptActionId')) {
			this.setExtState(SectionKeys.ReaperSetlist, 'ScriptActionId', MOCK_ACTION_ID);
		}
		if (!this.getExtState(SectionKeys.ReaperSetlist, 'ProjectRoot')) {
			this.setExtState(SectionKeys.ReaperSetlist, 'ProjectRoot', MOCK_ROOT_FOLDER);
		}
	}
}
