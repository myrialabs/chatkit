<script lang="ts">
	type IconName =
		| 'archive'
		| 'arrow-left'
		| 'bot'
		| 'building'
		| 'card'
		| 'chart'
		| 'check'
		| 'check-check'
		| 'chevron-down'
		| 'circle'
		| 'contact'
		| 'dice'
		| 'file'
		| 'image'
		| 'inbox'
		| 'keyboard'
		| 'link'
		| 'list'
		| 'loader'
		| 'location'
		| 'message'
		| 'paperclip'
		| 'plus'
		| 'reply'
		| 'search'
		| 'send'
		| 'settings'
		| 'smile'
		| 'sparkles'
		| 'template'
		| 'trash'
		| 'wifi'
		| 'x';

	let {
		name,
		class: className = 'size-4',
		strokeWidth = 2
	}: {
		name: IconName;
		class?: string;
		strokeWidth?: number;
	} = $props();
</script>

<svg
	viewBox="0 0 24 24"
	fill="none"
	class={className}
	stroke="currentColor"
	stroke-width={strokeWidth}
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	{#if name === 'archive'}
		<rect x="3" y="4" width="18" height="5" rx="1" />
		<path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9" />
		<path d="M10 13h4" />
	{:else if name === 'arrow-left'}
		<path d="m12 19-7-7 7-7" />
		<path d="M19 12H5" />
	{:else if name === 'bot'}
		<path d="M12 8V4H8" />
		<rect x="4" y="8" width="16" height="12" rx="2" />
		<path d="M2 14h2" />
		<path d="M20 14h2" />
		<path d="M9 13v.01" />
		<path d="M15 13v.01" />
		<path d="M10 17h4" />
	{:else if name === 'building'}
		<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18" />
		<path d="M6 12H4a2 2 0 0 0-2 2v8" />
		<path d="M18 9h2a2 2 0 0 1 2 2v11" />
		<path d="M10 6h4" />
		<path d="M10 10h4" />
		<path d="M10 14h4" />
		<path d="M10 18h4" />
	{:else if name === 'card'}
		<rect x="3" y="5" width="18" height="14" rx="2" />
		<path d="M7 10h10" />
		<path d="M7 14h6" />
	{:else if name === 'chart'}
		<path d="M3 3v18h18" />
		<path d="M7 16V9" />
		<path d="M12 16V5" />
		<path d="M17 16v-4" />
	{:else if name === 'check'}
		<path d="M20 6 9 17l-5-5" />
	{:else if name === 'check-check'}
		<path d="m3 12 4 4L17 6" />
		<path d="m12 16 2 2 7-7" />
	{:else if name === 'chevron-down'}
		<path d="m6 9 6 6 6-6" />
	{:else if name === 'circle'}
		<circle cx="12" cy="12" r="9" />
	{:else if name === 'contact'}
		<path d="M16 21v-2a4 4 0 0 0-8 0v2" />
		<circle cx="12" cy="7" r="4" />
	{:else if name === 'dice'}
		<rect x="3" y="3" width="18" height="18" rx="3" />
		<path d="M8 8h.01" />
		<path d="M16 8h.01" />
		<path d="M8 16h.01" />
		<path d="M16 16h.01" />
		<path d="M12 12h.01" />
	{:else if name === 'file'}
		<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
		<path d="M14 2v6h6" />
	{:else if name === 'image'}
		<rect x="3" y="3" width="18" height="18" rx="2" />
		<circle cx="9" cy="9" r="2" />
		<path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
	{:else if name === 'inbox'}
		<path d="M22 12h-6l-2 3h-4l-2-3H2" />
		<path d="m5.45 5.11-3.2 6.4A2 2 0 0 0 2 12.4V19a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6.6a2 2 0 0 0-.25-.89l-3.2-6.4A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
	{:else if name === 'keyboard'}
		<rect x="2" y="5" width="20" height="14" rx="2" />
		<path d="M6 9h.01" />
		<path d="M10 9h.01" />
		<path d="M14 9h.01" />
		<path d="M18 9h.01" />
		<path d="M8 13h.01" />
		<path d="M12 13h.01" />
		<path d="M16 13h.01" />
		<path d="M7 17h10" />
	{:else if name === 'link'}
		<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
		<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
	{:else if name === 'list'}
		<path d="M8 6h13" />
		<path d="M8 12h13" />
		<path d="M8 18h13" />
		<path d="M3 6h.01" />
		<path d="M3 12h.01" />
		<path d="M3 18h.01" />
	{:else if name === 'loader'}
		<path d="M12 2v4" />
		<path d="M12 18v4" />
		<path d="m4.93 4.93 2.83 2.83" />
		<path d="m16.24 16.24 2.83 2.83" />
		<path d="M2 12h4" />
		<path d="M18 12h4" />
		<path d="m4.93 19.07 2.83-2.83" />
		<path d="m16.24 7.76 2.83-2.83" />
	{:else if name === 'location'}
		<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0z" />
		<circle cx="12" cy="10" r="3" />
	{:else if name === 'message'}
		<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
	{:else if name === 'paperclip'}
		<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
	{:else if name === 'plus'}
		<path d="M12 5v14" />
		<path d="M5 12h14" />
	{:else if name === 'reply'}
		<path d="m9 17-5-5 5-5" />
		<path d="M20 18v-2a4 4 0 0 0-4-4H4" />
	{:else if name === 'search'}
		<circle cx="11" cy="11" r="8" />
		<path d="m21 21-4.3-4.3" />
	{:else if name === 'send'}
		<path d="m22 2-7 20-4-9-9-4Z" />
		<path d="M22 2 11 13" />
	{:else if name === 'settings'}
		<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.52a2 2 0 0 1-1 1.72l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.72v-.52a2 2 0 0 1 1-1.72l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
		<circle cx="12" cy="12" r="3" />
	{:else if name === 'smile'}
		<circle cx="12" cy="12" r="10" />
		<path d="M8 14s1.5 2 4 2 4-2 4-2" />
		<path d="M9 9h.01" />
		<path d="M15 9h.01" />
	{:else if name === 'sparkles'}
		<path d="m12 3-1.9 5.8L4 11l6.1 2.2L12 19l1.9-5.8L20 11l-6.1-2.2Z" />
		<path d="M5 3v4" />
		<path d="M3 5h4" />
		<path d="M19 17v4" />
		<path d="M17 19h4" />
	{:else if name === 'template'}
		<path d="M8 2h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h2z" />
		<path d="M14 2v6h6" />
		<path d="M8 13h8" />
		<path d="M8 17h5" />
	{:else if name === 'trash'}
		<path d="M3 6h18" />
		<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
		<path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
	{:else if name === 'wifi'}
		<path d="M5 13a10 10 0 0 1 14 0" />
		<path d="M8.5 16.5a5 5 0 0 1 7 0" />
		<path d="M12 20h.01" />
	{:else if name === 'x'}
		<path d="M18 6 6 18" />
		<path d="m6 6 12 12" />
	{/if}
</svg>
