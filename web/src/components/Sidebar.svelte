<script lang="ts">
	import { docSections } from '../lib/docs.js';
	import { navigate } from '../lib/router.svelte.js';

	interface Props {
		currentPath: string;
		open: boolean;
		onClose: () => void;
	}
	let { currentPath, open, onClose }: Props = $props();

	function go(to: string): void {
		navigate(to);
		onClose();
	}
</script>

{#snippet nav()}
	<nav class="sidebar-nav">
		<a href="/docs" class="index-link" class:active={currentPath === '/docs'} onclick={(e) => { e.preventDefault(); go('/docs'); }}>
			Overview
		</a>
		<a href="/docs/examples" class="index-link" class:active={currentPath === '/docs/examples'} onclick={(e) => { e.preventDefault(); go('/docs/examples'); }}>
			Examples
		</a>
		{#each docSections as section (section.key)}
			<div class="sidebar-section">
				<div class="sidebar-section-title">{section.title}</div>
				{#each section.pages as page (page.path)}
					<a
						href={page.path}
						class="sidebar-link"
						class:active={currentPath === page.path}
						onclick={(e) => { e.preventDefault(); go(page.path); }}
					>
						{page.title}
					</a>
				{/each}
			</div>
		{/each}
	</nav>
{/snippet}

<aside class="sidebar-desktop">
	{@render nav()}
</aside>

{#if open}
	<div class="drawer-backdrop" onclick={onClose} role="presentation"></div>
	<aside class="sidebar-drawer">
		<button class="drawer-close" onclick={onClose} aria-label="Close menu">&times;</button>
		{@render nav()}
	</aside>
{/if}

<style>
	.sidebar-desktop { width: 220px; flex-shrink: 0; }
	.sidebar-nav { position: sticky; top: 96px; display: flex; flex-direction: column; gap: 20px; max-height: calc(100vh - 120px); overflow-y: auto; }
	.sidebar-section { display: flex; flex-direction: column; gap: 2px; }
	.sidebar-section-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: var(--text-2); margin: 4px 0 6px; }
	.index-link, .sidebar-link {
		color: var(--text-1); text-decoration: none; font-size: 14px;
		padding: 6px 10px; border-radius: 8px; transition: all 0.15s;
	}
	.index-link { font-weight: 600; margin-bottom: 4px; }
	.sidebar-link:hover, .index-link:hover { background: var(--bg-2); color: var(--text-0); }
	.sidebar-link.active, .index-link.active { background: rgba(99, 102, 241, 0.14); color: var(--accent-2); font-weight: 500; }

	.sidebar-drawer {
		display: none;
	}

	@media (max-width: 900px) {
		.sidebar-desktop { display: none; }
		.sidebar-drawer {
			display: flex; flex-direction: column;
			position: fixed; top: 0; right: 0; bottom: 0;
			width: min(320px, 85vw);
			background: var(--bg-1);
			border-left: 1px solid var(--border-bright);
			z-index: 201;
			padding: 20px;
			overflow-y: auto;
		}
		.drawer-close {
			align-self: flex-end;
			background: none; border: none; color: var(--text-1);
			font-size: 28px; line-height: 1; cursor: pointer; padding: 4px 8px;
			margin-bottom: 8px;
		}
		.sidebar-nav { position: static; max-height: none; }
	}
</style>
