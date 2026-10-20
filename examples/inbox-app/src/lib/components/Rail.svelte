<script lang="ts">
	import { inbox } from '../store.svelte';
	import { platformMeta } from '../format';
	import type { Platform } from '../types';
	import Icon from './Icon.svelte';

	const platforms = $derived([...new Set(inbox.accounts.map((a) => a.platform))] as Platform[]);
	const connected = $derived(new Set(inbox.accounts.filter((a) => a.state === 'open' || a.state === 'authenticated').map((a) => a.platform)));

	function select(platform: Platform | null) {
		inbox.filter = platform;
	}
</script>

<nav class="flex w-14 shrink-0 flex-col items-center border-r border-slate-800 bg-slate-950 px-2 py-3 text-slate-400 sm:w-16">
	<div class="mb-4 flex size-10 items-center justify-center rounded-xl bg-emerald-600 text-white" title="ChatKit Inbox">
		<Icon name="message" class="size-5" />
	</div>

	<div class="flex w-full flex-col items-center gap-2">
		<button
			class="relative flex size-10 items-center justify-center rounded-xl border transition
				{inbox.filter === null ? 'border-transparent bg-slate-900 text-slate-100' : 'border-transparent bg-transparent text-slate-400 hover:bg-slate-800 hover:text-slate-100'}"
			onclick={() => select(null)}
			aria-label="All platforms"
			title="All platforms"
		>
			{#if inbox.filter === null}
				<span class="absolute -left-2 h-5 w-0.5 rounded-r-full bg-emerald-400"></span>
			{/if}
			<Icon name="inbox" class="size-5" />
		</button>

		{#each platforms as platform (platform)}
			{@const meta = platformMeta(platform)}
			<button
				class="relative flex size-10 items-center justify-center rounded-xl border text-[11px] font-bold transition hover:bg-slate-800
					{inbox.filter === platform ? 'border-transparent bg-slate-900 opacity-100' : 'border-transparent bg-transparent opacity-75 hover:opacity-100'}"
				style="color:{meta.color}"
				onclick={() => select(platform)}
				aria-label={meta.label}
				title={meta.label}
			>
				{#if inbox.filter === platform}
					<span class="absolute -left-2 h-5 w-0.5 rounded-r-full bg-emerald-400"></span>
				{/if}
				{meta.short}
				<span class="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-slate-950 {connected.has(platform) ? 'bg-emerald-500' : 'bg-slate-600'}"></span>
			</button>
		{/each}
	</div>

	<div class="mt-auto flex w-full flex-col items-center gap-2">
		<button
			class="flex size-10 items-center justify-center rounded-xl bg-emerald-600 text-white transition hover:bg-emerald-500"
			onclick={() => (inbox.newChatOpen = true)}
			aria-label="New chat"
			title="New chat"
		>
			<Icon name="plus" class="size-5" />
		</button>
		<button
			class="flex size-10 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-900 hover:text-slate-100"
			onclick={() => (inbox.settingsOpen = true)}
			aria-label="Channels"
			title="Channels"
		>
			<Icon name="settings" class="size-5" />
		</button>
		<div class="flex size-10 items-center justify-center rounded-xl" title={inbox.connected ? 'Live' : 'Reconnecting'}>
			<span class="size-2.5 rounded-full {inbox.connected ? 'bg-emerald-500' : 'bg-amber-400 animate-pulse'}"></span>
		</div>
	</div>
</nav>
