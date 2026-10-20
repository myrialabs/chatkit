<script lang="ts">
	import { inbox } from '../store.svelte';
	import { api } from '../api';
	import { platformMeta } from '../format';
	import type { Platform } from '../types';
	import Icon from './Icon.svelte';

	let selected = $state<Platform | ''>('');
	let account = $state('');
	let label = $state('');
	let creds = $state<Record<string, string>>({});
	let saving = $state(false);
	let error = $state('');

	const spec = $derived(inbox.platformSpecs.find((s) => s.platform === selected) ?? null);

	function choose(p: Platform) {
		selected = p;
		account = '';
		label = '';
		creds = {};
		error = '';
	}

	async function submit() {
		if (!spec) return;
		saving = true;
		error = '';
		try {
			await api.addAccount({ platform: spec.platform, account: account || undefined, label: label || undefined, creds });
			inbox.accounts = await api.accounts();
			selected = '';
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to add channel';
		} finally {
			saving = false;
		}
	}

	async function remove(id: string) {
		await api.removeAccount(id);
		inbox.accounts = await api.accounts();
	}

	function stateColor(state: string): string {
		if (state === 'open' || state === 'authenticated') return 'bg-emerald-400';
		if (state === 'connecting' || state === 'qr') return 'bg-amber-400';
		return 'bg-neutral-600';
	}
	function stateLabel(state: string): string {
		if (state === 'open') return 'connected';
		if (state === 'qr') return 'scan QR';
		if (state === 'connecting') return 'connecting';
		if (state === 'closed') return 'disconnected';
		return state;
	}
</script>

<div
	class="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm"
	onclick={(e) => {
		if (e.target === e.currentTarget) inbox.settingsOpen = false;
	}}
	role="presentation"
>
	<div class="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-slate-900 shadow-2xl shadow-black/40 ring-1 ring-slate-800">
		<div class="flex items-center justify-between border-b border-slate-800 px-5 py-4">
			<div>
				<h2 class="text-base font-semibold text-slate-100">Channels</h2>
				<p class="text-xs text-slate-400">Connect adapters and monitor their status.</p>
			</div>
			<button class="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100" onclick={() => (inbox.settingsOpen = false)} aria-label="Close">
				<Icon name="x" class="size-4" />
			</button>
		</div>

		<div class="flex-1 overflow-y-auto px-5 py-4">
			<!-- Configured channels -->
			{#if inbox.accounts.length > 0}
				<ul class="mb-6 space-y-2">
					{#each inbox.accounts as a (a.id)}
						{@const meta = platformMeta(a.platform)}
						<li class="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950 px-3 py-3">
							<span class="flex size-9 items-center justify-center rounded-full text-[11px] font-bold text-white" style="background:{meta.color}">
								{meta.short}
							</span>
							<div class="min-w-0 flex-1">
								<div class="truncate text-sm font-semibold text-slate-100">{a.label}</div>
								<div class="truncate text-[11px] text-slate-400">{a.platform}:{a.account}</div>
								{#if a.webhookPath}
									<div class="mt-0.5 truncate text-[11px] text-sky-300">webhook: {a.webhookPath}</div>
								{/if}
							</div>
							<span class="flex shrink-0 items-center gap-1.5 rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-slate-300 ring-1 ring-slate-700">
								<span class="size-2 rounded-full {stateColor(a.state)}"></span>
								{stateLabel(a.state)}
							</span>
							<button class="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-red-500/10 hover:text-red-300" onclick={() => remove(a.id)} aria-label="Remove channel">
								<Icon name="trash" class="size-4" />
							</button>
						</li>
					{/each}
				</ul>
			{:else}
				<div class="mb-6 rounded-xl border border-dashed border-slate-700 bg-slate-950 px-4 py-6 text-center">
					<div class="mx-auto mb-3 flex size-11 items-center justify-center rounded-lg bg-slate-900 text-slate-500">
						<Icon name="wifi" class="size-5" />
					</div>
					<p class="text-sm font-medium text-slate-300">No channels yet</p>
					<p class="mt-1 text-xs text-slate-500">Choose a platform below to connect the first channel.</p>
				</div>
			{/if}

			<!-- Add a channel -->
			<h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Add a channel</h3>
			<div class="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
				{#each inbox.platformSpecs as s (s.platform)}
					{@const meta = platformMeta(s.platform)}
					<button
						class="flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition
							{selected === s.platform ? 'border-transparent ring-2' : 'border-slate-700 bg-slate-950 hover:bg-slate-800'}"
						style={selected === s.platform ? `background:${meta.color}22; --tw-ring-color:${meta.color}` : ''}
						onclick={() => choose(s.platform)}
					>
						<span class="size-2 rounded-full" style="background:{meta.color}"></span>
						<span class="truncate text-slate-300">{s.label}</span>
					</button>
				{/each}
			</div>

			{#if spec}
				<div class="space-y-3 rounded-xl border border-slate-800 bg-slate-950 p-4">
					{#if spec.note}<p class="rounded-lg bg-slate-900 px-3 py-2 text-xs leading-5 text-slate-400 ring-1 ring-slate-800">{spec.note}</p>{/if}

					<label class="block">
						<span class="mb-1 block text-xs font-medium text-slate-300">{spec.accountLabel}</span>
						<input
							bind:value={account}
							placeholder={spec.accountPlaceholder}
							class="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
						/>
					</label>

					{#each spec.fields as f (f.key)}
						<label class="block">
							<span class="mb-1 block text-xs font-medium text-slate-300">{f.label}{f.required ? '' : ' (optional)'}</span>
							<input
								type={f.type}
								bind:value={creds[f.key]}
								placeholder={f.placeholder ?? ''}
								class="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
							/>
						</label>
					{/each}

					<label class="block">
						<span class="mb-1 block text-xs font-medium text-slate-300">Display name (optional)</span>
						<input
							bind:value={label}
							placeholder={spec.label}
							class="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
						/>
					</label>

					{#if error}<p class="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</p>{/if}

					<button
						class="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-40"
						onclick={submit}
						disabled={saving}
					>
						<Icon name={saving ? 'loader' : 'plus'} class="size-4 {saving ? 'animate-spin' : ''}" />
						{saving ? 'Connecting' : 'Add channel'}
					</button>
				</div>
			{/if}
		</div>
	</div>
</div>
