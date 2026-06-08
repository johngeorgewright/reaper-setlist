import { migrateSetlist, type Setlist } from '$lib/models/setlist';
import type { SetlistsStore } from '../api';
import { ReaperKVS } from './reaper-kvs';

export class ReaperSetlistStoreImpl extends ReaperKVS<Setlist> implements SetlistsStore {
	override async get(key: string): Promise<Setlist | undefined> {
		const raw = await super.get(key);
		return raw ? migrateSetlist(raw) : raw;
	}

	override async list(): Promise<Record<string, Setlist>> {
		const raw = await super.list();
		const migrated: Record<string, Setlist> = {};
		for (const [id, setlist] of Object.entries(raw)) {
			migrated[id] = migrateSetlist(setlist);
		}
		return migrated;
	}

	async deleteSongFromSets(id: string): Promise<void> {
		const setlists = await this.list();
		const updates: Promise<void>[] = [];
		for (const setlist of Object.values(setlists)) {
			const filtered = setlist.items.filter((item) => item.songId !== id);
			if (filtered.length !== setlist.items.length) {
				setlist.items = filtered;
				updates.push(this.update(setlist.id, setlist));
			}
		}
		await Promise.all(updates);
	}
}
