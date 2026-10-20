<script lang="ts">
	import { api } from '../api';
	import { platformMeta } from '../format';
	import { appendMessage, inbox, upsertConversation } from '../store.svelte';
	import type { Account } from '../types';
	import Icon from './Icon.svelte';

	const available = $derived(inbox.accounts);
	let accountId = $state('');
	let destination = $state('');
	let title = $state('');
	let draft = $state('');
	let sending = $state(false);
	let error = $state('');

	$effect(() => {
		if (!accountId && available.length > 0) {
			accountId = (available.find((a) => a.state === 'open' || a.state === 'authenticated') ?? available[0]!).id;
		}
	});

	const selected = $derived(available.find((a) => a.id === accountId) ?? null);
	const hint = $derived(destinationHint(selected));

	function destinationHint(account: Account | null): string {
		if (!account) return 'Select a channel first';
		if (account.platform === 'whatsapp_baileys' || account.platform === 'whatsapp_cloud') return 'Example: 6281234567890';
		if (account.platform === 'telegram') return 'Chat id or @channelusername';
		if (account.platform === 'discord') return 'Channel id';
		return 'Channel id or user id';
	}

	async function submit() {
		if (!accountId || !destination.trim() || !draft.trim() || sending) return;
		sending = true;
		error = '';
		try {
			const { conversation, message } = await api.startConversation({
				accountId,
				destination: destination.trim(),
				title: title.trim() || undefined,
				text: draft.trim()
			});
			upsertConversation(conversation);
			appendMessage(message);
			inbox.activeId = conversation.id;
			inbox.newChatOpen = false;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to start chat';
		} finally {
			sending = false;
		}
	}
</script>

<div
	class="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm"
	onclick={(e) => {
		if (e.target === e.currentTarget) inbox.newChatOpen = false;
	}}
	role="presentation"
>
	<div class="w-full max-w-md rounded-xl bg-slate-900 shadow-2xl shadow-black/40 ring-1 ring-slate-800">
		<div class="flex items-center justify-between border-b border-slate-800 px-5 py-4">
			<div>
				<h2 class="text-base font-semibold text-slate-100">New chat</h2>
				<p class="text-xs text-slate-400">Send the first message to a native account or number.</p>
			</div>
			<button class="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100" onclick={() => (inbox.newChatOpen = false)} aria-label="Close">
				<Icon name="x" class="size-4" />
			</button>
		</div>

		<div class="space-y-4 p-5">
			<label class="block">
				<span class="mb-1.5 block text-xs font-medium text-slate-300">Channel</span>
				<select
					bind:value={accountId}
					class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
				>
					{#each available as a (a.id)}
						{@const meta = platformMeta(a.platform)}
						<option value={a.id}>{a.label} - {meta.label} ({a.account})</option>
					{/each}
				</select>
			</label>

			<label class="block">
				<span class="mb-1.5 block text-xs font-medium text-slate-300">To</span>
				<input
					bind:value={destination}
					placeholder={hint}
					class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-emerald-500 focus:bg-slate-950 focus:ring-2 focus:ring-emerald-500/20"
				/>
			</label>

			<label class="block">
				<span class="mb-1.5 block text-xs font-medium text-slate-300">Display name (optional)</span>
				<input
					bind:value={title}
					placeholder="Name shown in this inbox"
					class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-emerald-500 focus:bg-slate-950 focus:ring-2 focus:ring-emerald-500/20"
				/>
			</label>

			<label class="block">
				<span class="mb-1.5 block text-xs font-medium text-slate-300">Message</span>
				<textarea
					bind:value={draft}
					rows="4"
					placeholder="Write the first message"
					class="w-full resize-none rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-emerald-500 focus:bg-slate-950 focus:ring-2 focus:ring-emerald-500/20"
				></textarea>
			</label>

			{#if selected?.platform === 'whatsapp_baileys'}
				<p class="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-200">
					WhatsApp Baileys keeps ChatKit safety enabled. Cold messages may be refused unless the recipient has opted in or messaged this account before.
				</p>
			{/if}

			{#if error}
				<p class="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</p>
			{/if}

			<div class="flex justify-end gap-2 border-t border-slate-800 pt-4">
				<button class="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800" onclick={() => (inbox.newChatOpen = false)}>
					Cancel
				</button>
				<button
					class="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
					onclick={submit}
					disabled={sending || !accountId || !destination.trim() || !draft.trim()}
				>
					<Icon name={sending ? 'loader' : 'send'} class="size-4 {sending ? 'animate-spin' : ''}" />
					Send
				</button>
			</div>
		</div>
	</div>
</div>
