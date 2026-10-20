<script lang="ts">
	import { inbox } from '../store.svelte';
	import { api } from '../api';
	import { appendMessage } from '../store.svelte';
	import type { Capabilities, ButtonSpec, ListRowSpec, Message } from '../types';
	import Icon from './Icon.svelte';

	let { conversationId }: { conversationId: string } = $props();

	let draft = $state('');
	let sending = $state(false);
	let error = $state('');
	let fileInput = $state<HTMLInputElement | null>(null);
	let textInput = $state<HTMLTextAreaElement | null>(null);

	// The platform's capability descriptor drives which rich options the "+" menu
	// offers, so the composer never presents something the channel would reject.
	let caps = $state<Capabilities | null>(null);
	let platform = $state('');
	let menuOpen = $state(false);
	type RichKind =
		| 'location'
		| 'contact'
		| 'buttons'
		| 'list'
		| 'template'
		| 'card'
		| 'poll'
		| 'dice'
		| 'venue'
		| 'embed'
		| 'select'
		| 'cta';
	type IconName =
		| 'building'
		| 'card'
		| 'chart'
		| 'chevron-down'
		| 'contact'
		| 'dice'
		| 'image'
		| 'keyboard'
		| 'link'
		| 'list'
		| 'location'
		| 'template';
	type RichOption = { key: RichKind; label: string; icon: IconName };
	let modal = $state<RichKind | null>(null);

	$effect(() => {
		const id = conversationId;
		caps = null;
		platform = '';
		menuOpen = false;
		modal = null;
		api
			.capabilities(id)
			.then((r) => {
				if (id === conversationId) {
					caps = r.supports;
					platform = r.platform;
				}
			})
			.catch(() => {});
	});

	const richOptions = $derived.by(() => {
		const c = caps;
		if (!c) return [] as RichOption[];
		const opts: RichOption[] = [];
		if (c.location) opts.push({ key: 'location', label: 'Location', icon: 'location' });
		if (c.contact) opts.push({ key: 'contact', label: 'Contact card', icon: 'contact' });
		if (c.buttons) opts.push({ key: 'buttons', label: 'Buttons', icon: 'keyboard' });
		if (platform === 'whatsapp_cloud') opts.push({ key: 'list', label: 'List picker', icon: 'list' });
		if (platform === 'whatsapp_cloud') opts.push({ key: 'cta', label: 'CTA URL button', icon: 'link' });
		if (platform === 'telegram' || platform === 'discord' || platform === 'whatsapp_baileys') opts.push({ key: 'poll', label: 'Poll', icon: 'chart' });
		if (platform === 'telegram') opts.push({ key: 'dice', label: 'Dice', icon: 'dice' });
		if (platform === 'telegram' && c.location) opts.push({ key: 'venue', label: 'Venue', icon: 'building' });
		if (platform === 'discord' || platform === 'slack') opts.push({ key: 'select', label: 'Select menu', icon: 'chevron-down' });
		if (c.templates) opts.push({ key: 'template', label: 'Template', icon: 'template' });
		if (c.rich_layout) opts.push({ key: 'card', label: 'Rich card', icon: 'card' });
		if (platform === 'discord' || platform === 'slack') opts.push({ key: 'embed', label: 'Embed with fields', icon: 'image' });
		return opts;
	});

	// Real-time typing: tell the platform we're composing as the user types, and
	// stop shortly after they pause, on send, on blur, or when the chat changes.
	let typingOn = false;
	let typingTimer: ReturnType<typeof setTimeout> | null = null;

	function pingTyping() {
		if (!typingOn) {
			typingOn = true;
			void api.setTyping(conversationId, true);
		}
		if (typingTimer) clearTimeout(typingTimer);
		typingTimer = setTimeout(stopTyping, 2500);
	}
	function stopTyping() {
		if (typingTimer) {
			clearTimeout(typingTimer);
			typingTimer = null;
		}
		if (typingOn) {
			typingOn = false;
			void api.setTyping(conversationId, false);
		}
	}

	// Stop typing on the previous conversation when switching chats.
	$effect(() => {
		void conversationId;
		return () => stopTyping();
	});

	async function onFile(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		error = '';
		try {
			const { message } = await api.sendMedia(conversationId, file);
			appendMessage(message);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Upload failed';
		} finally {
			if (fileInput) fileInput.value = '';
		}
	}

	async function send() {
		const body = draft.trim();
		if (!body || sending) return;
		sending = true;
		error = '';
		const replyTo = inbox.reply?.platformMessageId;
		stopTyping();
		try {
			const { message } = await api.send(conversationId, body, replyTo);
			appendMessage(message);
			draft = '';
			inbox.reply = null;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to send';
		} finally {
			sending = false;
		}
	}

	function onkey(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			void send();
		}
	}

	function resizeDraft() {
		if (!textInput) return;
		textInput.style.height = 'auto';
		textInput.style.height = `${Math.min(textInput.scrollHeight, 160)}px`;
	}

	$effect(() => {
		void draft;
		resizeDraft();
	});

	// --- rich modal state -----------------------------------------------------

	let loc = $state({ lat: '', lng: '', name: '' });
	let card = $state({ title: '', body: '' });
	let contactForm = $state({ name: '', phone: '' });
	let tmpl = $state({ name: '', language: 'en_US' });
	let btnForm = $state({ body: '', buttons: [{ text: '', data: '' }] as Array<{ text: string; data: string }> });
	let listForm = $state({
		body: '',
		buttonText: 'Choose',
		rows: [{ id: '', title: '' }] as Array<{ id: string; title: string }>
	});
	let pollForm = $state({ question: '', options: ['', ''] as string[] });
	const DICE_CHOICES = [
		{ value: String.fromCodePoint(0x1f3b2), label: 'Dice' },
		{ value: String.fromCodePoint(0x1f3af), label: 'Target' },
		{ value: String.fromCodePoint(0x1f3c0), label: 'Basketball' },
		{ value: String.fromCodePoint(0x26bd), label: 'Football' },
		{ value: String.fromCodePoint(0x1f3b3), label: 'Bowling' },
		{ value: String.fromCodePoint(0x1f3b0), label: 'Slot' }
	];
	let diceForm = $state({ emoji: DICE_CHOICES[0].value });
	let venueForm = $state({ lat: '', lng: '', title: '', address: '' });
	let embedForm = $state({ title: '', description: '', color: '#5865F2', fields: [{ label: '', value: '' }] as Array<{ label: string; value: string }> });
	let selectForm = $state({ prompt: '', placeholder: 'Choose', options: [{ label: '', value: '' }] as Array<{ label: string; value: string }> });
	let ctaForm = $state({ body: '', displayText: '', url: '' });

	function openModal(kind: RichKind) {
		menuOpen = false;
		error = '';
		// Reset each form to a clean slate on open.
		loc = { lat: '', lng: '', name: '' };
		card = { title: '', body: '' };
		contactForm = { name: '', phone: '' };
		tmpl = { name: '', language: 'en_US' };
		btnForm = { body: '', buttons: [{ text: '', data: '' }] };
		listForm = { body: '', buttonText: 'Choose', rows: [{ id: '', title: '' }] };
		pollForm = { question: '', options: ['', ''] };
		diceForm = { emoji: DICE_CHOICES[0].value };
		venueForm = { lat: '', lng: '', title: '', address: '' };
		embedForm = { title: '', description: '', color: '#5865F2', fields: [{ label: '', value: '' }] };
		selectForm = { prompt: '', placeholder: 'Choose', options: [{ label: '', value: '' }] };
		ctaForm = { body: '', displayText: '', url: '' };
		modal = kind;
	}

	function useMyLocation() {
		if (!navigator.geolocation) return;
		navigator.geolocation.getCurrentPosition((p) => {
			loc = { ...loc, lat: String(p.coords.latitude.toFixed(6)), lng: String(p.coords.longitude.toFixed(6)) };
		});
	}

	/** Run a rich send, append the resulting message, and close the modal. */
	async function submitRich(run: () => Promise<{ message: Message }>) {
		sending = true;
		error = '';
		try {
			const { message } = await run();
			appendMessage(message);
			modal = null;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Send failed';
		} finally {
			sending = false;
		}
	}

	const sendLocation = () =>
		submitRich(() => api.sendLocation(conversationId, Number(loc.lat), Number(loc.lng), loc.name.trim() || undefined));
	const sendContact = () => submitRich(() => api.sendContact(conversationId, contactForm.name.trim(), contactForm.phone.trim()));
	const sendTemplate = () => submitRich(() => api.sendTemplate(conversationId, tmpl.name.trim(), tmpl.language.trim() || undefined));
	const sendCard = () => submitRich(() => api.sendCard(conversationId, card.title.trim(), card.body.trim()));
	const sendButtons = () =>
		submitRich(() => {
			const buttons: ButtonSpec[] = btnForm.buttons
				.filter((b) => b.text.trim())
				.map((b) => ({ text: b.text.trim(), data: b.data.trim() || b.text.trim() }));
			return api.sendButtons(conversationId, btnForm.body.trim(), buttons);
		});
	const sendList = () =>
		submitRich(() => {
			const rows: ListRowSpec[] = listForm.rows.filter((r) => r.title.trim()).map((r) => ({ id: r.id.trim() || r.title.trim(), title: r.title.trim() }));
			return api.sendList(conversationId, listForm.body.trim(), listForm.buttonText.trim() || 'Choose', [{ rows }]);
		});
	const sendPoll = () =>
		submitRich(() => api.sendPoll(conversationId, pollForm.question.trim(), pollForm.options.map((o) => o.trim()).filter(Boolean)));
	const sendDice = () => submitRich(() => api.sendDice(conversationId, diceForm.emoji));
	const sendVenue = () =>
		submitRich(() => api.sendVenue(conversationId, Number(venueForm.lat), Number(venueForm.lng), venueForm.title.trim(), venueForm.address.trim()));
	const sendEmbed = () =>
		submitRich(() =>
			api.sendEmbed(
				conversationId,
				embedForm.title.trim(),
				embedForm.description.trim(),
				embedForm.color,
				embedForm.fields.filter((f) => f.label.trim()).map((f) => ({ label: f.label.trim(), value: f.value.trim() }))
			)
		);
	const sendSelect = () =>
		submitRich(() =>
			api.sendSelect(
				conversationId,
				selectForm.prompt.trim(),
				selectForm.placeholder.trim(),
				selectForm.options.filter((o) => o.label.trim()).map((o) => ({ label: o.label.trim(), value: o.value.trim() || o.label.trim() }))
			)
		);
	const sendCta = () => submitRich(() => api.sendCtaUrl(conversationId, ctaForm.body.trim(), ctaForm.displayText.trim(), ctaForm.url.trim()));
</script>

<div class="relative border-t border-slate-800 bg-slate-950 px-3 py-3 sm:px-5">
	{#if inbox.reply}
		<div class="mb-3 flex items-center gap-2 rounded-lg border border-emerald-400/20 border-l-4 border-l-emerald-500 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
			<Icon name="reply" class="size-4 shrink-0" />
			<span class="flex-1 truncate">Replying to: {inbox.reply.preview}</span>
			<button class="rounded-lg p-1 text-emerald-200 hover:bg-emerald-400/10" onclick={() => (inbox.reply = null)} aria-label="Cancel reply">
				<Icon name="x" class="size-3.5" />
			</button>
		</div>
	{/if}

	{#if error}
		<p class="mb-3 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</p>
	{/if}

	<!-- Capability-gated rich menu -->
	{#if menuOpen && richOptions.length > 0}
		<div class="absolute bottom-20 left-3 z-20 w-64 overflow-hidden rounded-xl bg-slate-900 py-2 shadow-xl shadow-black/40 ring-1 ring-slate-800 sm:left-5">
			{#each richOptions as opt (opt.key)}
				<button class="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm font-medium text-slate-200 hover:bg-slate-800" onclick={() => openModal(opt.key)}>
					<span class="flex size-8 items-center justify-center rounded-md bg-slate-800 text-slate-400">
						<Icon name={opt.icon} class="size-4" />
					</span>
					{opt.label}
				</button>
			{/each}
		</div>
	{/if}

	<div class="flex items-end gap-2">
		<input bind:this={fileInput} type="file" class="hidden" onchange={onFile} />
		<button
			class="flex size-10 shrink-0 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-slate-300 transition hover:border-slate-600 hover:bg-slate-800 hover:text-slate-100"
			onclick={() => fileInput?.click()}
			title="Attach a file"
			aria-label="Attach"
		>
			<Icon name="paperclip" class="size-5" />
		</button>
		<button
			class="flex size-10 shrink-0 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-slate-300 transition hover:border-slate-600 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-30 {menuOpen ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300' : ''}"
			onclick={() => (menuOpen = !menuOpen)}
			disabled={richOptions.length === 0}
			title={richOptions.length === 0 ? 'No rich features on this channel' : 'Rich message'}
			aria-label="Rich message"
		>
			<Icon name="plus" class="size-5" />
		</button>
		<textarea
			bind:this={textInput}
			bind:value={draft}
			onkeydown={onkey}
			oninput={() => {
				pingTyping();
				resizeDraft();
			}}
			onblur={stopTyping}
			rows="1"
			placeholder="Message"
			class="max-h-40 min-h-10 flex-1 resize-none overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm leading-5 text-slate-100 placeholder:text-slate-500 outline-none focus:border-emerald-500 focus:bg-slate-900 focus:ring-2 focus:ring-emerald-500/20"
		></textarea>
		<button
			class="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white transition hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500"
			onclick={send}
			disabled={sending || !draft.trim()}
			aria-label="Send"
		>
			<Icon name="send" class="size-5" />
		</button>
	</div>
</div>

<!-- Rich composer modals -->
{#if modal}
	<div class="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm" onclick={() => (modal = null)} role="presentation">
		<div class="composer-modal max-h-[88vh] w-full max-w-md overflow-y-auto rounded-2xl bg-slate-900 p-5 text-slate-100 shadow-2xl shadow-black/40 ring-1 ring-slate-800" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === 'Escape' && (modal = null)} role="dialog" tabindex="-1">
			<div class="mb-4 flex items-center justify-between">
				<h3 class="text-sm font-semibold text-slate-100">
					{#if modal === 'location'}Share location{:else if modal === 'contact'}Share contact{:else if modal === 'buttons'}Interactive buttons{:else if modal === 'list'}List picker{:else if modal === 'template'}WhatsApp template{:else if modal === 'poll'}Poll{:else if modal === 'dice'}Dice{:else if modal === 'venue'}Venue{:else if modal === 'embed'}Embed with fields{:else if modal === 'select'}Select menu{:else if modal === 'cta'}CTA URL button{:else}Rich card{/if}
				</h3>
				<button class="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100" onclick={() => (modal = null)} aria-label="Close">
					<Icon name="x" class="size-4" />
				</button>
			</div>

			{#if error}
				<p class="mb-3 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</p>
			{/if}

			{#if modal === 'location'}
				<div class="space-y-2">
					<div class="flex gap-2">
						<input bind:value={loc.lat} placeholder="Latitude" class="w-1/2 rounded-lg bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:bg-white/10" />
						<input bind:value={loc.lng} placeholder="Longitude" class="w-1/2 rounded-lg bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:bg-white/10" />
					</div>
					<input bind:value={loc.name} placeholder="Label (optional)" class="w-full rounded-lg bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:bg-white/10" />
					<button class="text-xs text-emerald-400 hover:text-emerald-300" onclick={useMyLocation}>Use my current location</button>
				</div>
				<button class="mt-4 w-full rounded-lg bg-emerald-600 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40" disabled={sending || !loc.lat || !loc.lng} onclick={sendLocation}>Send location</button>
			{:else if modal === 'contact'}
				<div class="space-y-2">
					<input bind:value={contactForm.name} placeholder="Full name" class="w-full rounded-lg bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:bg-white/10" />
					<input bind:value={contactForm.phone} placeholder="Phone (E.164, e.g. 6281…)" class="w-full rounded-lg bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:bg-white/10" />
				</div>
				<button class="mt-4 w-full rounded-lg bg-emerald-600 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40" disabled={sending || !contactForm.name.trim() || !contactForm.phone.trim()} onclick={sendContact}>Send contact</button>
			{:else if modal === 'buttons'}
				<div class="space-y-2">
					<input bind:value={btnForm.body} placeholder="Message text" class="w-full rounded-lg bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:bg-white/10" />
					{#each btnForm.buttons as btn, i (i)}
						<div class="flex gap-2">
							<input bind:value={btn.text} placeholder="Button label" class="w-1/2 rounded-lg bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:bg-white/10" />
							<input bind:value={btn.data} placeholder="data (postback)" class="w-1/2 rounded-lg bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:bg-white/10" />
						</div>
					{/each}
					{#if btnForm.buttons.length < 3}
						<button class="text-xs text-emerald-400 hover:text-emerald-300" onclick={() => (btnForm.buttons = [...btnForm.buttons, { text: '', data: '' }])}>+ Add button</button>
					{/if}
				</div>
				<button class="mt-4 w-full rounded-lg bg-emerald-600 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40" disabled={sending || !btnForm.body.trim() || !btnForm.buttons.some((b) => b.text.trim())} onclick={sendButtons}>Send buttons</button>
			{:else if modal === 'list'}
				<div class="space-y-2">
					<input bind:value={listForm.body} placeholder="Message text" class="w-full rounded-lg bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:bg-white/10" />
					<input bind:value={listForm.buttonText} placeholder="List button label" class="w-full rounded-lg bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:bg-white/10" />
					{#each listForm.rows as row, i (i)}
						<div class="flex gap-2">
							<input bind:value={row.title} placeholder="Row title" class="w-2/3 rounded-lg bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:bg-white/10" />
							<input bind:value={row.id} placeholder="id" class="w-1/3 rounded-lg bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:bg-white/10" />
						</div>
					{/each}
					<button class="text-xs text-emerald-400 hover:text-emerald-300" onclick={() => (listForm.rows = [...listForm.rows, { id: '', title: '' }])}>+ Add row</button>
				</div>
				<button class="mt-4 w-full rounded-lg bg-emerald-600 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40" disabled={sending || !listForm.body.trim() || !listForm.rows.some((r) => r.title.trim())} onclick={sendList}>Send list</button>
			{:else if modal === 'template'}
				<div class="space-y-2">
					<input bind:value={tmpl.name} placeholder="Template name (e.g. hello_world)" class="w-full rounded-lg bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:bg-white/10" />
					<input bind:value={tmpl.language} placeholder="Language code (e.g. en_US)" class="w-full rounded-lg bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:bg-white/10" />
					<p class="text-xs text-slate-400">The template must already be approved in your Meta WhatsApp account.</p>
				</div>
				<button class="mt-4 w-full rounded-lg bg-emerald-600 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40" disabled={sending || !tmpl.name.trim()} onclick={sendTemplate}>Send template</button>
			{:else if modal === 'card'}
				<div class="space-y-2">
					<input bind:value={card.title} placeholder="Card title" class="w-full rounded-lg bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:bg-white/10" />
					<textarea bind:value={card.body} rows="3" placeholder="Card body (Markdown on Slack)" class="w-full resize-none rounded-lg bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:bg-white/10"></textarea>
				</div>
				<button class="mt-4 w-full rounded-lg bg-emerald-600 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40" disabled={sending || !card.title.trim()} onclick={sendCard}>Send card</button>
			{:else if modal === 'poll'}
				<div class="space-y-2">
					<input bind:value={pollForm.question} placeholder="Question" class="w-full rounded-lg bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:bg-white/10" />
					{#each pollForm.options as _opt, i (i)}
						<input bind:value={pollForm.options[i]} placeholder={`Option ${i + 1}`} class="w-full rounded-lg bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:bg-white/10" />
					{/each}
					<button class="text-xs text-emerald-400 hover:text-emerald-300" onclick={() => (pollForm.options = [...pollForm.options, ''])}>+ Add option</button>
				</div>
				<button class="mt-4 w-full rounded-lg bg-emerald-600 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40" disabled={sending || !pollForm.question.trim() || pollForm.options.filter((o) => o.trim()).length < 2} onclick={sendPoll}>Send poll</button>
			{:else if modal === 'dice'}
				<div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
					{#each DICE_CHOICES as choice (choice.value)}
						<button
							class="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition {diceForm.emoji === choice.value ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200' : 'border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800'}"
							onclick={() => (diceForm.emoji = choice.value)}
						>
							<Icon name="dice" class="size-4" />
							{choice.label}
						</button>
					{/each}
				</div>
				<button class="mt-4 w-full rounded-lg bg-emerald-600 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40" disabled={sending} onclick={sendDice}>Send dice roll</button>
			{:else if modal === 'venue'}
				<div class="space-y-2">
					<div class="flex gap-2">
						<input bind:value={venueForm.lat} placeholder="Latitude" class="w-1/2 rounded-lg bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:bg-white/10" />
						<input bind:value={venueForm.lng} placeholder="Longitude" class="w-1/2 rounded-lg bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:bg-white/10" />
					</div>
					<input bind:value={venueForm.title} placeholder="Title" class="w-full rounded-lg bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:bg-white/10" />
					<input bind:value={venueForm.address} placeholder="Address" class="w-full rounded-lg bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:bg-white/10" />
				</div>
				<button class="mt-4 w-full rounded-lg bg-emerald-600 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40" disabled={sending || !venueForm.lat || !venueForm.lng || !venueForm.title.trim()} onclick={sendVenue}>Send venue</button>
			{:else if modal === 'embed'}
				<div class="space-y-2">
					<input bind:value={embedForm.title} placeholder="Title" class="w-full rounded-lg bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:bg-white/10" />
					<textarea bind:value={embedForm.description} rows="2" placeholder="Description" class="w-full resize-none rounded-lg bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:bg-white/10"></textarea>
					<div class="flex items-center gap-2">
						<span class="text-xs text-neutral-400">Accent colour</span>
						<input type="color" bind:value={embedForm.color} class="h-8 w-12 rounded bg-transparent" />
					</div>
					{#each embedForm.fields as f, i (i)}
						<div class="flex gap-2">
							<input bind:value={f.label} placeholder="Field name" class="w-1/2 rounded-lg bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:bg-white/10" />
							<input bind:value={f.value} placeholder="Field value" class="w-1/2 rounded-lg bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:bg-white/10" />
						</div>
					{/each}
					<button class="text-xs text-emerald-400 hover:text-emerald-300" onclick={() => (embedForm.fields = [...embedForm.fields, { label: '', value: '' }])}>+ Add field</button>
				</div>
				<button class="mt-4 w-full rounded-lg bg-emerald-600 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40" disabled={sending || !embedForm.title.trim()} onclick={sendEmbed}>Send embed</button>
			{:else if modal === 'select'}
				<div class="space-y-2">
					<input bind:value={selectForm.prompt} placeholder="Prompt" class="w-full rounded-lg bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:bg-white/10" />
					<input bind:value={selectForm.placeholder} placeholder="Placeholder" class="w-full rounded-lg bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:bg-white/10" />
					{#each selectForm.options as o, i (i)}
						<div class="flex gap-2">
							<input bind:value={o.label} placeholder="Option label" class="w-2/3 rounded-lg bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:bg-white/10" />
							<input bind:value={o.value} placeholder="value" class="w-1/3 rounded-lg bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:bg-white/10" />
						</div>
					{/each}
					<button class="text-xs text-emerald-400 hover:text-emerald-300" onclick={() => (selectForm.options = [...selectForm.options, { label: '', value: '' }])}>+ Add option</button>
				</div>
				<button class="mt-4 w-full rounded-lg bg-emerald-600 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40" disabled={sending || !selectForm.prompt.trim() || !selectForm.options.some((o) => o.label.trim())} onclick={sendSelect}>Send select</button>
			{:else if modal === 'cta'}
				<div class="space-y-2">
					<input bind:value={ctaForm.body} placeholder="Message body" class="w-full rounded-lg bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:bg-white/10" />
					<input bind:value={ctaForm.displayText} placeholder="Button text" class="w-full rounded-lg bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:bg-white/10" />
					<input bind:value={ctaForm.url} placeholder="https://…" class="w-full rounded-lg bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:bg-white/10" />
				</div>
				<button class="mt-4 w-full rounded-lg bg-emerald-600 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40" disabled={sending || !ctaForm.body.trim() || !ctaForm.url.trim()} onclick={sendCta}>Send CTA button</button>
			{/if}
		</div>
	</div>
{/if}
