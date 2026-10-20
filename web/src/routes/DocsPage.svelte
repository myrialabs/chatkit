<script lang="ts">
	import { docsIndex, findDocPage } from '../lib/docs.js';
	import Sidebar from '../components/Sidebar.svelte';
	import DocContent from '../components/DocContent.svelte';
	import Examples from './ExamplesPage.svelte';

	interface Props {
		section?: string;
		slug?: string;
	}
	let { section, slug }: Props = $props();

	const isExamples = $derived(section === 'examples' && !slug);
	let drawerOpen = $state(false);

	const currentPath = $derived(
		isExamples ? '/docs/examples' : section && slug ? `/docs/${section}/${slug}` : '/docs'
	);
	const page = $derived(section && slug ? findDocPage(section, slug) : docsIndex);
</script>

<div class="docs-shell container">
	<div class="docs-mobile-bar">
		<button class="drawer-toggle" onclick={() => (drawerOpen = true)}>
			<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="2" y1="4" x2="14" y2="4" /><line x1="2" y1="8" x2="14" y2="8" /><line x1="2" y1="12" x2="14" y2="12" /></svg>
			Menu
		</button>
	</div>
	<Sidebar {currentPath} open={drawerOpen} onClose={() => (drawerOpen = false)} />
	<div class="docs-body">
		{#if isExamples}
			<Examples />
		{:else if page}
			<DocContent source={page.content} />
		{:else}
			<p>Page not found.</p>
		{/if}
	</div>
</div>

<style>
	/* align-items: stretch (the default) so the sidebar's box is as tall as
	   docs-body — a sticky child needs a tall-enough containing block to stick
	   against, otherwise it has no room to stick within. */
	.docs-shell { display: flex; gap: 40px; padding: 110px 24px 100px; }
	.docs-body { flex: 1; min-width: 0; }
	.docs-mobile-bar { display: none; }

	@media (max-width: 900px) {
		.docs-shell { padding: 100px 16px 80px; flex-direction: column; align-items: stretch; }
		.docs-mobile-bar { display: block; width: 100%; margin-bottom: 24px; }
	}
</style>
