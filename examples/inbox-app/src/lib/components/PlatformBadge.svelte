<script lang="ts">
	import type { Platform } from '../types';
	import { platformMeta } from '../format';

	let { platform, showLabel = true }: { platform: Platform; showLabel?: boolean } = $props();
	const meta = $derived(platformMeta(platform));
</script>

<span
	class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
	style="background:{meta.color}22; color:{meta.color}"
>
	<span class="size-1.5 rounded-full" style="background:{meta.color}"></span>
	{#if showLabel}{meta.label}{:else}{meta.short}{/if}
</span>
