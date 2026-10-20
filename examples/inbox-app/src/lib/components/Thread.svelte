<script lang="ts">
	import { inbox, isTyping } from '../store.svelte';
	import { api } from '../api';
	import { initials, platformMeta } from '../format';
	import MessageBubble from './MessageBubble.svelte';
	import Composer from './Composer.svelte';
	import Icon from './Icon.svelte';
	import type { Conversation, Message } from '../types';

	let { conversation }: { conversation: Conversation } = $props();

	const messages = $derived(inbox.messagesByConv[conversation.id] ?? []);
	const typing = $derived(isTyping(conversation.id));
	const meta = $derived(platformMeta(conversation.platform));

	function quotedOf(m: Message): Message | null {
		return m.reply_to ? (messages.find((x) => x.platform_message_id === m.reply_to) ?? null) : null;
	}

	async function react(m: Message, emoji: string) {
		if (!m.platform_message_id) return;
		try {
			await api.react(conversation.id, m.platform_message_id, emoji);
		} catch {
			// best-effort
		}
	}

	function closeThread() {
		inbox.activeId = null;
		inbox.reply = null;
	}

	// Auto-scroll to the newest message when the list grows.
	let scroller = $state<HTMLDivElement | null>(null);
	$effect(() => {
		void messages.length;
		if (scroller) scroller.scrollTop = scroller.scrollHeight;
	});
</script>

<div class="flex min-w-0 flex-1 flex-col bg-[#070b12]">
	<header class="flex h-16 shrink-0 items-center gap-3 border-b border-slate-800 bg-slate-950 px-3 sm:px-5">
		<button class="flex size-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-900 hover:text-slate-100 md:hidden" onclick={closeThread} aria-label="Back to chats">
			<Icon name="arrow-left" class="size-5" />
		</button>
		<div class="flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white" style="background:{meta.color}">
			{initials(conversation.title)}
		</div>
		<div class="min-w-0 flex-1">
			<h2 class="truncate text-sm font-semibold text-slate-100">{conversation.title}</h2>
			<p class="truncate text-xs text-slate-400">
				{typing ? 'typing...' : `${meta.label} · ${conversation.account}`}
			</p>
		</div>
		<span class="hidden shrink-0 items-center gap-1.5 rounded-full bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-300 ring-1 ring-slate-800 sm:inline-flex">
			<span class="size-2 rounded-full bg-emerald-500"></span>
			Live
		</span>
	</header>

	<div bind:this={scroller} class="flex-1 overflow-y-auto px-3 py-4 sm:px-6 sm:py-5">
		{#if messages.length === 0}
			<div class="flex min-h-full items-center justify-center">
				<div class="max-w-sm text-center">
					<div class="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-slate-900 text-slate-500 ring-1 ring-slate-800">
						<Icon name="message" class="size-5" />
					</div>
					<p class="text-sm font-semibold text-slate-200">No messages yet</p>
					<p class="mt-1 text-xs leading-5 text-slate-500">Send a first reply from the composer below.</p>
				</div>
			</div>
		{:else}
			<div class="space-y-3">
				{#each messages as m (m.id)}
					<MessageBubble message={m} quoted={quotedOf(m)} onreact={(emoji) => react(m, emoji)} />
				{/each}
			</div>
		{/if}
		{#if typing}
			<div class="mt-3 flex justify-start">
				<div class="flex items-center gap-2 rounded-2xl rounded-bl-md bg-slate-900 px-3 py-2 text-slate-400 shadow-sm ring-1 ring-slate-800">
					<Icon name="message" class="size-4" />
					<div class="flex items-center gap-1">
						<span class="size-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]"></span>
						<span class="size-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]"></span>
						<span class="size-1.5 animate-bounce rounded-full bg-slate-400"></span>
					</div>
				</div>
			</div>
		{/if}
	</div>

	<Composer conversationId={conversation.id} />
</div>
