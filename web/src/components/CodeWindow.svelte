<script lang="ts">
	import { highlightCode } from '../lib/markdown.js';

	interface Props {
		title: string;
		code: string;
		lang?: 'typescript' | 'bash';
	}
	let { title, code, lang = 'typescript' }: Props = $props();

	let html = $state('');
	$effect(() => {
		highlightCode(code, lang).then((h) => (html = h));
	});
</script>

<div class="window">
	<div class="window-bar">
		<div class="win-dot win-dot-r"></div>
		<div class="win-dot win-dot-y"></div>
		<div class="win-dot win-dot-g"></div>
		<div class="win-title">{title}</div>
	</div>
	<div class="window-body">
		{#if html}
			{@html html}
		{:else}
			<pre>{code}</pre>
		{/if}
	</div>
</div>

<style>
	.window {
		background: var(--bg-2);
		border: 1px solid var(--border-bright);
		border-radius: var(--radius-lg);
		overflow: hidden;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5), 0 0 40px rgba(99, 102, 241, 0.06);
		min-width: 0;
		max-width: 100%;
	}
	.window-bar {
		display: flex; align-items: center; gap: 8px;
		padding: 14px 16px;
		background: var(--bg-3);
		border-bottom: 1px solid var(--border);
	}
	.win-dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
	.win-dot-r { background: #ff5f57; }
	.win-dot-y { background: #febc2e; }
	.win-dot-g { background: #28c840; }
	.win-title { flex: 1; text-align: center; font-size: 12px; font-weight: 500; color: var(--text-2); font-family: 'JetBrains Mono', monospace; }
	.window-body {
		background: var(--bg-1);
		font-family: 'JetBrains Mono', monospace;
		font-size: 13px;
		line-height: 1.85;
		overflow-x: auto;
		max-width: 100%;
		text-align: left;
	}
	.window-body :global(pre) {
		margin: 0; padding: 22px 26px;
		white-space: pre; max-width: none;
		overflow-x: auto; line-height: 1.75;
		background: transparent !important;
	}
</style>
