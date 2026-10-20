<script lang="ts">
	import { renderMarkdown, type RenderResult } from '../lib/markdown.js';

	interface Props {
		source: string;
		onHeadings?: (headings: RenderResult['headings']) => void;
	}
	let { source, onHeadings }: Props = $props();

	let html = $state('');

	$effect(() => {
		renderMarkdown(source).then((result) => {
			html = result.html;
			onHeadings?.(result.headings);
		});
	});
</script>

<div class="prose">
	{@html html}
</div>
