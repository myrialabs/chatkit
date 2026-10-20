<script lang="ts">
	import { inbox, isTyping } from '../store.svelte';
	import { platformMeta, initials, shortTime } from '../format';
	import type { Conversation } from '../types';
	import Icon from './Icon.svelte';

	let { onselect }: { onselect: (c: Conversation) => void } = $props();

	let search = $state('');
	let queue = $state<'all' | 'unread'>('all');

	const unreadCount = $derived(inbox.conversations.reduce((sum, c) => sum + c.unread, 0));
	const currentFilterLabel = $derived(inbox.filter ? platformMeta(inbox.filter).label : 'All platforms');
	const filtered = $derived.by(() =>
		inbox.conversations
			.filter((c) => (queue === 'unread' ? c.unread > 0 : true))
			.filter((c) => (inbox.filter ? c.platform === inbox.filter : true))
			.filter((c) => {
				if (!search.trim()) return true;
				const q = search.trim().toLowerCase();
				return [c.title, c.last_preview, c.account, c.conversation_id].some((v) => v.toLowerCase().includes(q));
			})
	);
</script>

<section class="flex w-full min-w-0 shrink-0 flex-col border-r border-slate-800 bg-slate-950 md:w-[21rem]">
	<div class="border-b border-slate-800 bg-slate-950 px-3 py-3 sm:px-4">
		<div class="flex items-end justify-between gap-3">
			<div class="min-w-0">
				<h1 class="text-lg font-semibold text-slate-100">Chats</h1>
				<p class="truncate text-xs font-medium text-slate-400">{currentFilterLabel} · {filtered.length} conversations · {unreadCount} unread</p>
			</div>
		</div>

		<div class="mt-3 grid grid-cols-2 rounded-lg bg-slate-900 p-1">
			<button
				class="rounded-md px-3 py-1.5 text-sm font-semibold transition {queue === 'all' ? 'bg-slate-800 text-slate-100 shadow-sm ring-1 ring-slate-700' : 'text-slate-400 hover:text-slate-100'}"
				onclick={() => (queue = 'all')}
			>
				All
			</button>
			<button
				class="rounded-md px-3 py-1.5 text-sm font-semibold transition {queue === 'unread' ? 'bg-slate-800 text-slate-100 shadow-sm ring-1 ring-slate-700' : 'text-slate-400 hover:text-slate-100'}"
				onclick={() => (queue = 'unread')}
			>
				Unread
			</button>
		</div>

		<label class="mt-3 flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-400 focus-within:border-emerald-500 focus-within:bg-slate-900 focus-within:ring-2 focus-within:ring-emerald-500/20">
			<Icon name="search" class="size-4" />
			<input
				bind:value={search}
				placeholder="Search chats"
				class="min-w-0 flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 outline-none"
			/>
		</label>

	</div>

	<div class="flex-1 overflow-y-auto">
		{#if filtered.length === 0}
			<div class="px-6 py-12 text-center">
				<div class="mx-auto mb-3 flex size-10 items-center justify-center text-slate-600">
					<Icon name="inbox" class="size-5" />
				</div>
				<p class="text-sm font-medium text-slate-300">No matching conversations</p>
				<p class="mt-1 text-xs leading-5 text-slate-500">Try another search or filter.</p>
			</div>
		{/if}

		<div class="divide-y divide-slate-900">
			{#each filtered as c (c.id)}
				{@const meta = platformMeta(c.platform)}
				{@const typing = isTyping(c.id)}
				<button
					class="w-full border-l-4 px-3 py-3 text-left transition sm:px-4
						{inbox.activeId === c.id ? 'border-l-emerald-500 bg-emerald-500/10' : 'border-l-transparent bg-slate-950 hover:bg-slate-900'}"
					onclick={() => onselect(c)}
				>
					<div class="flex gap-3">
						<div class="relative shrink-0">
							<div class="flex size-11 items-center justify-center rounded-full text-xs font-semibold text-white shadow-sm" style="background:{meta.color}">
								{initials(c.title)}
							</div>
							<span class="absolute -bottom-0.5 -right-1 rounded-md border border-slate-950 bg-slate-900 px-1.5 py-0.5 text-[8px] font-bold shadow-sm" style="color:{meta.color}">
								{meta.short}
							</span>
						</div>
						<div class="min-w-0 flex-1">
							<div class="flex items-center justify-between gap-2">
								<span class="min-w-0 truncate text-sm font-semibold text-slate-100">{c.title}</span>
								<span class="shrink-0 text-[11px] font-medium text-slate-500">{shortTime(c.last_message_at)}</span>
							</div>
							<div class="mt-1 flex items-center justify-between gap-2">
								{#if typing}
									<span class="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
										<span class="size-1.5 rounded-full bg-emerald-500"></span>
										typing
									</span>
								{:else}
									<span class="truncate text-xs leading-5 {c.unread > 0 ? 'font-semibold text-slate-200' : 'text-slate-400'}">{c.last_preview}</span>
								{/if}
								{#if c.unread > 0}
									<span class="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 px-1.5 text-[10px] font-bold text-white">{c.unread}</span>
								{/if}
							</div>
						</div>
					</div>
				</button>
			{/each}
		</div>
	</div>
</section>
