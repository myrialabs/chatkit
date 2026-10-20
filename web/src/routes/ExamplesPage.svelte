<script lang="ts">
	import { examplesReadme, exampleFiles } from '../lib/examples.js';
	import Markdown from '../components/Markdown.svelte';
	import CodeWindow from '../components/CodeWindow.svelte';
	import { reveal } from '../lib/reveal.js';
	import type { RenderResult } from '../lib/markdown.js';

	let readmeHeadings = $state<RenderResult['headings']>([]);
	const tocHeadings = $derived(readmeHeadings.filter((h) => h.depth === 2));
</script>

<div class="examples-shell">
	<div class="examples-main">
		<Markdown source={examplesReadme} onHeadings={(h) => (readmeHeadings = h)} />

		<h2 id="every-snippet" class="every-example-heading">Every snippet, in full</h2>
		<div class="examples-grid">
			{#each exampleFiles as example, i (example.name)}
				<div id="example-{example.name}" class="example-anchor" use:reveal={{ delay: (i % 4) * 60 }}>
					<CodeWindow title="{example.name}.ts" code={example.code} lang="typescript" />
				</div>
			{/each}
		</div>
	</div>

	<aside class="examples-toc">
		<div class="examples-toc-sticky">
			<div class="toc-label">On this page</div>
			<nav>
				{#each tocHeadings as h (h.id)}
					<a href="#{h.id}" class="toc-link">{h.text}</a>
				{/each}
				<a href="#every-snippet" class="toc-link">Every snippet, in full</a>
				<div class="toc-divider"></div>
				{#each exampleFiles as example (example.name)}
					<a href="#example-{example.name}" class="toc-link toc-sub">{example.name}.ts</a>
				{/each}
			</nav>
		</div>
	</aside>
</div>

<style>
	.examples-shell { display: flex; gap: 48px; min-width: 0; }
	.examples-main { flex: 1; min-width: 0; }
	.every-example-heading {
		font-size: 24px; font-weight: 700; color: var(--text-0);
		margin: 44px 0 16px; padding-top: 12px; border-top: 1px solid var(--border);
		scroll-margin-top: 90px;
	}
	.examples-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 24px; }
	.example-anchor { scroll-margin-top: 90px; }

	/* examples-toc stretches (giving room to stick within); the actual
	   position:sticky lives on the shorter inner examples-toc-sticky child. */
	.examples-toc { width: 200px; flex-shrink: 0; }
	.examples-toc-sticky {
		position: sticky; top: 96px;
		max-height: calc(100vh - 120px); overflow-y: auto;
	}
	.toc-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: var(--text-2); margin-bottom: 12px; }
	.examples-toc nav { display: flex; flex-direction: column; gap: 2px; border-left: 1px solid var(--border); }
	.toc-link {
		display: block; color: var(--text-2); text-decoration: none; font-size: 13px;
		padding: 5px 0 5px 14px; border-left: 2px solid transparent; margin-left: -1px;
		transition: color 0.15s;
	}
	.toc-link:hover { color: var(--text-0); }
	.toc-sub { padding-left: 26px; font-size: 12.5px; font-family: 'JetBrains Mono', monospace; }
	.toc-divider { height: 1px; background: var(--border); margin: 8px 14px 8px 0; }

	@media (max-width: 900px) {
		.examples-shell { flex-direction: column; }
		.examples-toc { display: none; }
	}
</style>
