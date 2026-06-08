import { describe, expect, it } from 'vitest';
import { getSongEnd, getSongStart, type ReaperMarker } from './reaper-marker';

const marker = (id: number, name: string, position: number): ReaperMarker => ({ id, name, position });

describe('getSongStart', () => {
	it('returns 0 when no =START marker exists', () => {
		expect(getSongStart([])).toBe(0);
		expect(getSongStart([marker(1, 'verse', 10)])).toBe(0);
	});

	it('returns the position of the =START marker when present', () => {
		const markers = [marker(1, 'intro', 0), marker(2, '=START', 4.5), marker(3, 'verse', 12)];
		expect(getSongStart(markers)).toBe(4.5);
	});

	it('is case-sensitive', () => {
		// Reaper subproject markers must be exact; `=start` is treated as a regular marker.
		expect(getSongStart([marker(1, '=start', 4.5)])).toBe(0);
	});
});

describe('getSongEnd', () => {
	it('returns the tab length when no =END marker exists', () => {
		expect(getSongEnd([], 180)).toBe(180);
		expect(getSongEnd([marker(1, 'chorus', 60)], 180)).toBe(180);
	});

	it('returns the position of the =END marker when present', () => {
		const markers = [marker(1, '=START', 4), marker(2, '=END', 175)];
		expect(getSongEnd(markers, 180)).toBe(175);
	});

	it('is case-sensitive', () => {
		expect(getSongEnd([marker(1, '=end', 100)], 180)).toBe(180);
	});
});
