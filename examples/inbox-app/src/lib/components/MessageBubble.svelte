<script lang="ts">
	import { inbox } from '../store.svelte';
	import { clock, runsToHtml } from '../format';
	import { richMeta } from '../api';
	import type { Message } from '../types';
	import Icon from './Icon.svelte';

	let {
		message,
		quoted = null,
		onreact
	}: { message: Message; quoted?: Message | null; onreact?: (emoji: string) => void } = $props();
	const mine = $derived(message.direction === 'outbound');
	const rich = $derived(richMeta(message.meta));

	const QUICK = [
		{ value: String.fromCodePoint(0x1f44d), icon: 'check', label: 'Agree' },
		{ value: String.fromCodePoint(0x2764, 0xfe0f), icon: 'sparkles', label: 'Like' },
		{ value: String.fromCodePoint(0x1f604), icon: 'smile', label: 'Smile' },
		{ value: String.fromCodePoint(0x1f389), icon: 'sparkles', label: 'Celebrate' },
		{ value: String.fromCodePoint(0x1f64f), icon: 'contact', label: 'Thanks' }
	] as const;
	let picker = $state(false);

	function previewOf(m: Message): string {
		return m.text ?? m.caption ?? (m.media_url ? `${m.media_type ?? 'media'} attachment` : m.content_type);
	}

	const statusName = $derived(
		message.status === 'read' || message.status === 'delivered'
			? 'check-check'
			: message.status === 'sent' || message.status === 'accepted'
				? 'check'
				: message.status === 'failed'
					? 'x'
					: null
	);

	function reply() {
		if (!message.platform_message_id) return;
		inbox.reply = {
			messageId: message.id,
			platformMessageId: message.platform_message_id,
			preview: message.text ?? message.caption ?? message.content_type
		};
	}
</script>

{#if message.content_type === 'reaction'}
	<div class="my-2 flex justify-center">
		<div class="inline-flex items-center gap-1.5 rounded-full bg-slate-900/90 px-3 py-1 text-xs text-slate-400 shadow-sm ring-1 ring-slate-800">
			<Icon name="smile" class="size-3.5" />
			<span>{message.sender_name ?? 'Someone'} reacted</span>
		</div>
	</div>
{:else}
	<div class="group flex w-full items-end gap-2 {mine ? 'justify-end' : 'justify-start'}">
		{#if message.platform_message_id && mine}
			<div class="relative hidden items-center gap-1 self-center opacity-0 transition group-hover:opacity-100 sm:flex">
				<button class="rounded-lg p-1.5 text-slate-500 hover:bg-slate-900 hover:text-slate-200" title="Reply" onclick={reply} aria-label="Reply">
					<Icon name="reply" class="size-4" />
				</button>
				{#if onreact}
					<button class="rounded-lg p-1.5 text-slate-500 hover:bg-slate-900 hover:text-slate-200" title="React" onclick={() => (picker = !picker)} aria-label="React">
						<Icon name="smile" class="size-4" />
					</button>
				{/if}
			</div>
		{/if}

		<div class="flex max-w-[84%] flex-col gap-1 sm:max-w-[min(34rem,74%)]">
			{#if !mine && message.sender_name}
				<span class="px-1 text-[11px] font-semibold text-slate-500">{message.sender_name}</span>
			{/if}

			<div
				class="relative rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm ring-1
					{mine ? 'rounded-br-md bg-[#08795f] text-white ring-[#08795f]' : 'rounded-bl-md bg-slate-900 text-slate-100 ring-slate-800'}"
			>
				{#if quoted}
					<div class="mb-2 rounded-lg border-l-2 {mine ? 'border-white/60 bg-white/15 text-emerald-50/90' : 'border-emerald-500 bg-slate-950 text-slate-300'} px-2 py-1.5 text-xs">
						<div class="font-semibold">{quoted.sender_name ?? 'You'}</div>
						<div class="truncate">{previewOf(quoted)}</div>
					</div>
				{/if}

				{#if message.content_type === 'postback'}
					<span class="mb-1 inline-flex items-center gap-1 rounded-lg {mine ? 'bg-white/15' : 'bg-slate-800'} px-2 py-1 text-xs">
						<Icon name="reply" class="size-3.5" />
						{message.text}
					</span>
				{/if}

				{#if rich?.kind === 'location'}
					<a
						href={`https://www.google.com/maps?q=${rich.lat},${rich.lng}`}
						target="_blank"
						rel="noreferrer"
						class="mb-2 flex items-center gap-2 rounded-xl {mine ? 'bg-white/15 hover:bg-white/20' : 'bg-slate-950 hover:bg-slate-800'} px-3 py-2 text-xs"
					>
						<Icon name="location" class="size-4 shrink-0" />
						<span class="flex min-w-0 flex-col">
							<span class="truncate font-semibold">{rich.name || 'Shared location'}</span>
							<span class="opacity-75">{Number(rich.lat).toFixed(5)}, {Number(rich.lng).toFixed(5)}</span>
						</span>
					</a>
				{:else if rich?.kind === 'contact'}
					<div class="mb-2 flex items-center gap-2 rounded-xl {mine ? 'bg-white/15' : 'bg-slate-950'} px-3 py-2 text-xs">
						<span class="grid size-8 place-items-center rounded-full {mine ? 'bg-white/15' : 'bg-slate-900 text-slate-400 ring-1 ring-slate-800'}">
							<Icon name="contact" class="size-4" />
						</span>
						<span class="flex min-w-0 flex-col">
							<span class="truncate font-semibold">{rich.name}</span>
							<span class="opacity-75">{rich.phone}</span>
						</span>
					</div>
				{:else if rich?.kind === 'card'}
					<div class="mb-2 rounded-xl border-l-4 {mine ? 'border-white/60 bg-white/15' : 'border-indigo-400 bg-slate-950'} px-3 py-2">
						<div class="flex items-center gap-1.5 text-sm font-semibold">
							<Icon name="card" class="size-4" />
							{rich.title}
						</div>
						<div class="mt-1 whitespace-pre-wrap text-xs opacity-80">{rich.body}</div>
					</div>
				{:else if rich?.kind === 'template'}
					<div class="mb-2 flex items-center gap-2 rounded-xl {mine ? 'bg-white/15' : 'bg-slate-950'} px-3 py-2 text-xs">
						<Icon name="template" class="size-4" />
						<span class="font-semibold">Template: {rich.name}</span>
					</div>
				{/if}

				{#if message.media_url}
					{#if message.media_type === 'image' || message.media_type === 'sticker'}
						<img src={message.media_url} alt={message.caption ?? 'image'} class="mb-2 max-h-64 rounded-xl" />
					{:else if message.media_type === 'video'}
						<!-- svelte-ignore a11y_media_has_caption -->
						<video src={message.media_url} controls class="mb-2 max-h-64 rounded-xl"></video>
					{:else if message.media_type === 'audio' || message.media_type === 'voice'}
						<audio src={message.media_url} controls class="mb-2 w-56"></audio>
					{:else}
						<a href={message.media_url} target="_blank" rel="noreferrer" class="mb-2 flex items-center gap-2 underline">
							<Icon name="file" class="size-4" />
							{message.caption ?? 'document'}
						</a>
					{/if}
				{/if}

				{#if rich?.kind === 'runs'}
					<!-- eslint-disable-next-line svelte/no-at-html-tags — runsToHtml escapes all text -->
					<span class="whitespace-pre-wrap break-words">{@html runsToHtml(rich.runs)}</span>
				{:else if message.text && message.content_type !== 'postback'}
					<span class="whitespace-pre-wrap break-words">{message.text}</span>
				{:else if message.caption}
					<span class="whitespace-pre-wrap break-words">{message.caption}</span>
				{/if}

				{#if rich?.kind === 'buttons'}
					<div class="mt-2 flex flex-wrap gap-1.5">
						{#each rich.buttons as b (b.text)}
							<span class="rounded-lg border {mine ? 'border-white/25 bg-white/15' : 'border-slate-700 bg-slate-950'} px-2.5 py-1 text-xs">{b.text}</span>
						{/each}
					</div>
				{:else if rich?.kind === 'list'}
					<div class="mt-2 rounded-xl border {mine ? 'border-white/25 bg-white/15' : 'border-slate-700 bg-slate-950'} p-1.5">
						<div class="flex items-center gap-1 px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide opacity-70">
							<Icon name="list" class="size-3" />
							{rich.buttonText || 'List'}
						</div>
						{#each rich.sections as section (section)}
							{#each section.rows as row (row.id)}
								<div class="rounded-lg px-2 py-1 text-xs hover:bg-white/10">{row.title}</div>
							{/each}
						{/each}
					</div>
				{:else if rich?.kind === 'poll'}
					<div class="mt-2 rounded-xl border {mine ? 'border-white/25 bg-white/15' : 'border-slate-700 bg-slate-950'} p-2">
						<div class="mb-1 flex items-center gap-1.5 text-xs font-semibold">
							<Icon name="chart" class="size-4" />
							{rich.question}
						</div>
						{#each rich.options as opt (opt)}
							<div class="flex items-center gap-1.5 rounded px-2 py-1 text-xs opacity-80">
								<Icon name="circle" class="size-3" />
								{opt}
							</div>
						{/each}
					</div>
				{:else if rich?.kind === 'dice'}
					<div class="mt-2 inline-flex items-center gap-2 rounded-xl {mine ? 'bg-white/15' : 'bg-slate-950'} px-3 py-2 text-xs font-semibold">
						<Icon name="dice" class="size-4" />
						Dice roll
					</div>
				{:else if rich?.kind === 'venue'}
					<a
						href={`https://www.google.com/maps?q=${rich.lat},${rich.lng}`}
						target="_blank"
						rel="noreferrer"
						class="mt-2 flex items-center gap-2 rounded-xl {mine ? 'bg-white/15 hover:bg-white/20' : 'bg-slate-950 hover:bg-slate-800'} px-3 py-2 text-xs"
					>
						<Icon name="building" class="size-4 shrink-0" />
						<span class="flex min-w-0 flex-col">
							<span class="truncate font-semibold">{rich.title}</span>
							<span class="truncate opacity-75">{rich.address}</span>
						</span>
					</a>
				{:else if rich?.kind === 'embed'}
					<div class="mt-2 rounded-xl border-l-4 {mine ? 'bg-white/15' : 'bg-slate-950'} px-3 py-2" style={`border-color:${rich.color ?? '#5865F2'}`}>
						<div class="flex items-center gap-1.5 text-sm font-semibold">
							<Icon name="image" class="size-4" />
							{rich.title}
						</div>
						{#if rich.description}<div class="mt-1 whitespace-pre-wrap text-xs opacity-80">{rich.description}</div>{/if}
						{#if rich.fields?.length}
							<div class="mt-2 grid grid-cols-2 gap-2">
								{#each rich.fields as f (f.label)}
									<div class="text-xs"><span class="font-semibold opacity-90">{f.label}</span><br /><span class="opacity-70">{f.value}</span></div>
								{/each}
							</div>
						{/if}
					</div>
				{:else if rich?.kind === 'select'}
					<div class="mt-2 rounded-xl border {mine ? 'border-white/25 bg-white/15' : 'border-slate-700 bg-slate-950'} p-1.5">
						<div class="flex items-center gap-1 px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide opacity-70">
							<Icon name="chevron-down" class="size-3" />
							{rich.placeholder || rich.prompt}
						</div>
						{#each rich.options as o (o.value)}
							<div class="rounded-lg px-2 py-1 text-xs hover:bg-white/10">{o.label}</div>
						{/each}
					</div>
				{:else if rich?.kind === 'cta'}
					<div class="mt-2 flex flex-col gap-1">
						<span class="inline-flex items-center justify-center gap-1.5 rounded-lg border {mine ? 'border-white/25 bg-white/15' : 'border-slate-700 bg-slate-950'} px-2.5 py-1 text-xs">
							<Icon name="link" class="size-3.5" />
							{rich.displayText}
						</span>
					</div>
				{/if}

				<span class="ml-2 inline-flex items-center gap-1 align-bottom text-[10px] {mine ? 'text-emerald-50/85' : 'text-slate-500'}">
					{clock(message.created_at)}
					{#if mine && statusName}
						<Icon name={statusName} class="size-3 {message.status === 'read' ? 'text-cyan-100' : ''}" />
					{/if}
				</span>

				{#if picker}
					<div class="absolute bottom-full z-10 mb-2 flex gap-1 rounded-full bg-slate-900 px-2 py-1 shadow-lg shadow-black/40 ring-1 ring-slate-800 {mine ? 'right-0' : 'left-0'}">
						{#each QUICK as reaction (reaction.value)}
							<button
								class="flex size-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
								onclick={() => {
									onreact?.(reaction.value);
									picker = false;
								}}
								title={reaction.label}
								aria-label={reaction.label}
							>
								<Icon name={reaction.icon} class="size-4" />
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>

		{#if message.platform_message_id && !mine}
			<div class="relative hidden items-center gap-1 self-center opacity-0 transition group-hover:opacity-100 sm:flex">
				<button class="rounded-lg p-1.5 text-slate-500 hover:bg-slate-900 hover:text-slate-200" title="Reply" onclick={reply} aria-label="Reply">
					<Icon name="reply" class="size-4" />
				</button>
				{#if onreact}
					<button class="rounded-lg p-1.5 text-slate-500 hover:bg-slate-900 hover:text-slate-200" title="React" onclick={() => (picker = !picker)} aria-label="React">
						<Icon name="smile" class="size-4" />
					</button>
				{/if}
			</div>
		{/if}
	</div>
{/if}
