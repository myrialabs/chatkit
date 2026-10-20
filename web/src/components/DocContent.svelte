<script lang="ts">
	import Markdown from './Markdown.svelte';
	import type { RenderResult } from '../lib/markdown.js';

	interface Props {
		source: string;
	}
	let { source }: Props = $props();

	let headings = $state<RenderResult['headings']>([]);
	const tocHeadings = $derived(headings.filter((h) => h.depth === 2 || h.depth === 3));
</script>

<div class="doc-content">
	<div class="doc-main">
		<Markdown {source} onHeadings={(h) => (headings = h)} />
	</div>
	{#if tocHeadings.length > 1}
		<aside class="doc-toc">
			<div class="doc-toc-sticky">
				<div class="toc-label">On this page</div>
				<nav>
					{#each tocHeadings as h (h.id)}
						<a href="#{h.id}" class="toc-link" class:toc-sub={h.depth === 3}>{h.text}</a>
					{/each}
				</nav>
			</div>
		</aside>
	{/if}
</div>

<style>
	/* align-items: stretch (default) so doc-toc's box is as tall as doc-main —
	   sticky needs a tall containing block. The sticky element itself must stay
	   short, though: doc-toc stretches (giving room to stick within), while the
	   actual position:sticky lives on the shorter doc-toc-sticky child — sticky
	   on the stretched element itself has no slack to stick with. */
	.doc-content { display: flex; gap: 48px; min-width: 0; }
	.doc-main { flex: 1; min-width: 0; }
	.doc-toc { width: 200px; flex-shrink: 0; }
	.doc-toc-sticky { position: sticky; top: 96px; }
	.toc-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: var(--text-2); margin-bottom: 12px; }
	.doc-toc nav { display: flex; flex-direction: column; gap: 2px; border-left: 1px solid var(--border); }
	.toc-link {
		display: block; color: var(--text-2); text-decoration: none; font-size: 13px;
		padding: 5px 0 5px 14px; border-left: 2px solid transparent; margin-left: -1px;
		transition: color 0.15s;
	}
	.toc-link:hover { color: var(--text-0); }
	.toc-sub { padding-left: 26px; font-size: 12.5px; }

	@media (max-width: 900px) {
		.doc-content { flex-direction: column; align-items: stretch; }
		.doc-toc { display: none; }
	}
</style>
