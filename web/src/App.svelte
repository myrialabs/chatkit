<script lang="ts">
	import { onMount } from 'svelte';
	import { currentPath, installLinkInterceptor, navigate } from './lib/router.svelte.js';
	import Nav from './components/Nav.svelte';
	import Footer from './components/Footer.svelte';
	import Home from './routes/Home.svelte';
	import DocsPage from './routes/DocsPage.svelte';
	import NotFound from './routes/NotFound.svelte';

	onMount(() => installLinkInterceptor());

	const path = $derived(currentPath());
	// Section and slug are each independently optional: /docs, /docs/examples,
	// /docs/channels/telegram all match.
	const docsMatch = $derived(path.match(/^\/docs(?:\/([^/]+)(?:\/([^/]+))?)?\/?$/));

	// The old standalone /examples route lives inside the docs shell.
	$effect(() => {
		if (path === '/examples') navigate('/docs/examples', { replace: true });
	});
</script>

<Nav />

<main>
	{#key path}
		{#if path === '/'}
			<Home />
		{:else if docsMatch}
			<DocsPage section={docsMatch[1]} slug={docsMatch[2]} />
		{:else if path === '/examples'}
			<!-- redirecting via $effect above -->
		{:else}
			<NotFound />
		{/if}
	{/key}
</main>

<Footer />

<style>
	main { position: relative; z-index: 1; min-height: 60vh; }
</style>
