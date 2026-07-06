<script lang="ts" module>
	type SongLike = Song | NewSong;

	import { notifications } from '$lib';
	import { getApi } from '$lib/api/api';
	import Button from '$lib/components/Button/Button.svelte';
	import type { Database } from '$lib/models/database';
	import { SONG_END_MARKER, SONG_START_MARKER } from '$lib/models/reaper-marker';
	import type { NewSong, Song } from '$lib/models/song';

	export interface SongEditorProps<T extends SongLike> {
		song: T;
		songs: Database<Song>;
		projects: string[];
		onSubmit: (song: T) => void;
	}
</script>

<script lang="ts">
	import Form from '../Form/Form.svelte';

	const api = getApi();

	// eslint-disable-next-line no-undef
	type T = $$Generic<SongLike>;
	let { song: originalSong, onSubmit, projects, songs }: SongEditorProps<T> = $props();
	const song = $state({ ...originalSong });
	const duration = $derived(getDuration(song.length));

	// State for hiding projects that exist in other songs
	let hideUsedProjects = $state(true);

	// Get projects that are already used by other songs (excluding current song if editing)
	const usedProjects = $derived(
		Object.values(songs)
			.filter((s) => s.id !== song.id) // Exclude current song when editing
			.map((s) => s.path)
	);

	// Filter projects based on checkbox state
	const filteredProjects = $derived(hideUsedProjects ? projects.filter((project) => !usedProjects.includes(project)) : projects);

	function getDuration(length: number) {
		const minutes = Math.floor(length / 60);
		const seconds = length % 60;
		return `${minutes}:${seconds.toString().padStart(2, '0')}`;
	}

	function handleProjectSelect(projectPath: string) {
		song.path = projectPath;

		// Extract filename from path and remove extension for song name
		const pathSegments = projectPath.split(/[/\\]/);
		const filename = pathSegments[pathSegments.length - 1];
		const nameWithoutExtension = filename.replace(/\.[^/.]+$/, '');
		song.name = nameWithoutExtension;
	}

	async function handleGetDurationClick() {
		const openTabs = await api.script.getOpenTabs();
		const activeTab = openTabs.tabs[openTabs.activeIndex];
		let openedNewTab = false;
		if (!activeTab || !song.path.endsWith(activeTab.name)) {
			await api.reaper.newTab();
			await api.script.openProject(song.path);
			openedNewTab = true;
		}
		// Read the markers alongside the length so we can tell the user whether
		// the duration was measured between the `=START`/`=END` markers or fell
		// back to the full project length.
		const markers = await api.reaper.getMarkers();
		song.length = Math.ceil(await api.script.getProjectLength());
		if (openedNewTab) {
			await api.reaper.closeTab();
		}

		const hasStart = markers.some((m) => m.name === SONG_START_MARKER);
		const hasEnd = markers.some((m) => m.name === SONG_END_MARKER);
		if (hasStart && hasEnd) {
			notifications.success(`Duration measured between the ${SONG_START_MARKER} and ${SONG_END_MARKER} markers.`);
		} else if (hasStart) {
			notifications.success(`Duration measured from the ${SONG_START_MARKER} marker to the end of the project.`);
		} else if (hasEnd) {
			notifications.success(`Duration measured from the project start to the ${SONG_END_MARKER} marker.`);
		} else {
			notifications.info(`No ${SONG_START_MARKER}/${SONG_END_MARKER} markers found — used the full project length.`);
		}
	}
</script>

<Form onsubmit={() => onSubmit(song)}>
	<div class="form-group">
		<label for="relative-path">Project File:</label>
		<select onchange={(e) => handleProjectSelect(e.currentTarget.value)} bind:value={song.path} id="relative-path" required>
			<option value="">Select project...</option>
			{#each filteredProjects as project (project)}
				<option value={project}>{project}</option>
			{/each}
		</select>
		<div class="checkbox-container">
			<label class="checkbox-label">
				<input type="checkbox" bind:checked={hideUsedProjects} />
				Hide projects already used by other songs
			</label>
		</div>
	</div>

	<div class="form-group">
		<label for="song-name">Song Name:</label>
		<input bind:value={song.name} type="text" id="song-name" placeholder="Enter song name" required />
	</div>

	<div class="form-group">
		<label for="duration">Duration (seconds):</label>
		<div class="input-with-button">
			<input bind:value={song.length} type="number" id="duration" placeholder="Duration in seconds" min="0" required />
			<Button elementType="button" onclick={handleGetDurationClick} disabled={song.path === ''}>Get from Reaper</Button>
		</div>
		<span class="duration-display">{duration}</span>
	</div>

	<div class="submit-section">
		<Button elementType="submit" disabled={song.name === '' || song.path === ''}>Save</Button>
	</div>
</Form>

<style>
	.duration-display {
		font-size: 0.875rem;
		color: var(--comment);
		font-style: italic;
		margin-top: 0.5rem;
	}

	.checkbox-container {
		margin-top: 0.5rem;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
		color: var(--comment);
		cursor: pointer;
		font-weight: normal;
	}

	.checkbox-label input[type='checkbox'] {
		cursor: pointer;
		width: auto;
		margin: 0;
	}
</style>
