<script lang="ts" module>
	export interface PlayConfigEditorProps {
		/**
		 * The current play config. Bound; mutating fields on the parent's copy
		 * will be reflected here too. Mode changes always call `onChange` with
		 * a fresh object since the discriminated union changes shape.
		 */
		config: PlayConfig;
		/**
		 * Notified when the user picks a different mode (or tweaks a numeric
		 * field). The parent is responsible for assigning the returned value
		 * back into the setlist item.
		 */
		onChange: (config: PlayConfig) => void;
	}
</script>

<script lang="ts">
	import type { PlayConfig, PlayConfigMode } from '$lib/models/setlist';
	import { defaultPlayConfig } from '$lib/models/setlist';

	let { config, onChange }: PlayConfigEditorProps = $props();

	function onModeChange(event: Event & { currentTarget: HTMLSelectElement }) {
		const mode = event.currentTarget.value as PlayConfigMode;
		if (mode === config.mode) return;
		onChange(defaultPlayConfig(mode));
	}

	function onDelayChange(event: Event & { currentTarget: HTMLInputElement }) {
		if (config.mode !== 'timer') return;
		const delaySeconds = Math.max(0, Number(event.currentTarget.value) || 0);
		onChange({ mode: 'timer', delaySeconds });
	}

	function onLeadChange(event: Event & { currentTarget: HTMLInputElement }) {
		if (config.mode !== 'crossover') return;
		const leadSeconds = Math.max(0, Number(event.currentTarget.value) || 0);
		onChange({ mode: 'crossover', leadSeconds });
	}
</script>

<div class="play-config" role="group" aria-label="Play transition config">
	<span class="prefix" aria-hidden="true">After:</span>
	<select aria-label="Transition mode" value={config.mode} onchange={onModeChange}>
		<option value="pause">Pause</option>
		<option value="play">Play next</option>
		<option value="timer">Wait & play</option>
		<option value="crossover">Crossover</option>
	</select>

	{#if config.mode === 'timer'}
		<label class="numeric">
			<input
				type="number"
				min="0"
				step="0.5"
				value={config.delaySeconds}
				oninput={onDelayChange}
				aria-label="Wait seconds before playing next"
			/>
			<span>s</span>
		</label>
	{:else if config.mode === 'crossover'}
		<label class="numeric">
			<input
				type="number"
				min="0"
				step="0.5"
				value={config.leadSeconds}
				oninput={onLeadChange}
				aria-label="Crossover lead seconds"
			/>
			<span>s lead</span>
		</label>
	{/if}
</div>

<style>
	.play-config {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 0.75rem;
		margin-left: 1.5rem;
		background: color-mix(in srgb, var(--current-line) 60%, transparent);
		border-left: 2px solid var(--comment);
		border-radius: 0 0.5rem 0.5rem 0;
		font-size: 0.875rem;
	}

	.prefix {
		color: var(--comment);
		font-weight: 500;
	}

	select {
		padding: 0.25rem 0.5rem;
		font-size: 0.875rem;
	}

	.numeric {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		color: var(--comment);
	}

	.numeric input {
		width: 4.5rem;
		padding: 0.25rem 0.5rem;
		font-size: 0.875rem;
	}
</style>
