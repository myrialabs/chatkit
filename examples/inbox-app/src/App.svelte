<script lang="ts">
	import { onMount } from 'svelte';
	import { inbox, upsertConversation, mergeMessages, isHistoryLoaded, appendMessage, applyStatus, activeConversation, markTyping } from './lib/store.svelte';
	import { api, connectStream } from './lib/api';
	import type { Conversation } from './lib/types';
	import Rail from './lib/components/Rail.svelte';
	import ConversationList from './lib/components/ConversationList.svelte';
	import Thread from './lib/components/Thread.svelte';
	import Settings from './lib/components/Settings.svelte';
	import Icon from './lib/components/Icon.svelte';
	import NewChat from './lib/components/NewChat.svelte';

	const active = $derived(activeConversation());
	const hasChannels = $derived(inbox.accounts.length > 0);

	async function openConversation(c: Conversation) {
		inbox.activeId = c.id;
		inbox.reply = null;
		// Always load history once per conversation, even if a live message already
		// created the array — and merge (never replace) so that live message survives.
		if (!isHistoryLoaded(c.id)) mergeMessages(c.id, await api.messages(c.id));
		if (c.unread > 0) {
			await api.markRead(c.id);
			c.unread = 0;
		}
	}

	onMount(() => {
		void (async () => {
			inbox.platformSpecs = await api.platformSpecs();
			inbox.accounts = await api.accounts();
			for (const c of await api.conversations()) upsertConversation(c);
		})();

		const es = connectStream({
			onOpen: () => (inbox.connected = true),
			onError: () => (inbox.connected = false),
			onMessage: ({ conversation, message }) => {
				upsertConversation(conversation);
				appendMessage(message);
				if (conversation.id === inbox.activeId) {
					void api.markRead(conversation.id);
					conversation.unread = 0;
				}
			},
			onStatus: ({ message }) => applyStatus(message),
			onQr: (qr) => (inbox.qr = qr),
			onConnection: ({ state }) => {
				// A channel changed state — refresh the list, and dismiss the QR once linked.
				void api.accounts().then((a) => {
					inbox.accounts = a;
				});
				if (state === 'open' || state === 'authenticated') inbox.qr = null;
			},
			onPresence: ({ conversationId, state }) => markTyping(conversationId, state === 'typing' || state === 'recording')
		});
		return () => es.close();
	});
</script>

<div class="flex h-full min-w-0 overflow-hidden bg-[#070b12] font-sans text-slate-100 antialiased">
	{#if hasChannels}
		<Rail />
		<div class="{active ? 'hidden md:contents' : 'contents'}">
			<ConversationList onselect={openConversation} />
		</div>

		{#if active}
			<Thread conversation={active} />
		{:else}
			<main class="hidden min-w-0 flex-1 flex-col bg-[#070b12] md:flex">
				<div class="flex flex-1 items-center justify-center px-8">
					<div class="max-w-md text-center">
						<div class="mx-auto flex size-16 items-center justify-center rounded-xl bg-slate-900 text-emerald-400 shadow-sm ring-1 ring-slate-800">
							<Icon name="inbox" class="size-8" strokeWidth={1.7} />
						</div>
						<h2 class="mt-5 text-2xl font-semibold text-slate-100">Select a conversation</h2>
						<p class="mt-2 text-sm leading-6 text-slate-400">Choose a thread from the sidebar, then reply from the composer.</p>
					</div>
				</div>
			</main>
		{/if}
	{:else}
		<main class="flex min-h-0 flex-1 bg-[#070b12]">
			<div class="mx-auto flex w-full max-w-3xl items-center px-4 py-8 sm:px-8 sm:py-10">
				<section class="w-full rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-black/30 sm:p-8">
					<div class="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-400/20">
						<Icon name="sparkles" class="size-4" />
						Setup
					</div>
					<h1 class="mt-5 max-w-2xl text-3xl font-semibold tracking-tight text-slate-100">Connect your first channel.</h1>
					<p class="mt-4 max-w-2xl text-sm leading-6 text-slate-400">
						After a channel is connected, incoming conversations appear in a simple queue. Open one, reply, and move to the next.
					</p>
					<div class="mt-6 flex flex-wrap gap-3">
						<button
							class="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-500"
							onclick={() => (inbox.settingsOpen = true)}
						>
							<Icon name="plus" class="size-4" />
							Connect first channel
						</button>
						<span class="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-3 text-sm font-medium text-slate-300 ring-1 ring-slate-800">
							<Icon name="wifi" class="size-4" />
							Live updates start automatically
						</span>
					</div>
				</section>
			</div>
		</main>
	{/if}
</div>

{#if inbox.settingsOpen}
	<Settings />
{/if}

{#if inbox.newChatOpen}
	<NewChat />
{/if}

{#if inbox.qr}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
		<div class="w-full max-w-sm rounded-xl bg-slate-900 p-6 text-center shadow-2xl shadow-black/40 ring-1 ring-slate-800">
			<div class="mx-auto mb-3 flex size-11 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-300">
				<Icon name="link" class="size-5" />
			</div>
			<h3 class="mb-1 text-base font-semibold text-slate-100">Link WhatsApp</h3>
			<p class="mb-4 text-xs leading-5 text-slate-400">
				Open WhatsApp, go to Linked Devices, choose Link a Device, then scan this code.
				<strong class="font-semibold text-amber-300"> Use a test number.</strong>
			</p>
			<img src={inbox.qr.dataUrl} alt="WhatsApp QR" class="mx-auto rounded-lg bg-white p-2" />
			<button class="mt-4 rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800" onclick={() => (inbox.qr = null)}>
				Close
			</button>
		</div>
	</div>
{/if}
