import type { Platform, RunSpec } from './types';

interface PlatformMeta {
	label: string;
	color: string;
	short: string;
}

/** Brand-ish colour + short tag per platform, for badges and avatars. */
export const PLATFORM_META: Record<Platform, PlatformMeta> = {
	telegram: { label: 'Telegram', color: '#229ED9', short: 'TG' },
	whatsapp_baileys: { label: 'WhatsApp', color: '#25D366', short: 'WA' },
	whatsapp_cloud: { label: 'WhatsApp Cloud', color: '#25D366', short: 'WA' },
	discord: { label: 'Discord', color: '#5865F2', short: 'DC' },
	slack: { label: 'Slack', color: '#611F69', short: 'SL' }
};

export function platformMeta(p: Platform): PlatformMeta {
	return PLATFORM_META[p] ?? { label: p, color: '#737373', short: '??' };
}

export function initials(name: string): string {
	const parts = name.trim().split(/\s+/).slice(0, 2);
	return parts.map((s) => s[0]?.toUpperCase() ?? '').join('') || '#';
}

/** Compact relative time for the conversation list (e.g. "3m", "2h", "Mon"). */
export function shortTime(iso: string): string {
	const then = new Date(iso).getTime();
	if (Number.isNaN(then)) return '';
	const diff = Date.now() - then;
	const min = Math.floor(diff / 60_000);
	if (min < 1) return 'now';
	if (min < 60) return `${min}m`;
	const hr = Math.floor(min / 60);
	if (hr < 24) return `${hr}h`;
	const d = new Date(iso);
	const days = Math.floor(hr / 24);
	if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
	return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Render universal rich-text runs to safe HTML for a message bubble. Every run's
 * text is HTML-escaped before the (trusted) formatting tags are applied, so the
 * result is safe to inject with `{@html}`.
 */
export function runsToHtml(runs: RunSpec[]): string {
	return runs
		.map((r) => {
			if (r.mention) return `<span class="font-medium text-sky-700">@${escapeHtml(r.mention.display || r.mention.id)}</span>`;
			let html = escapeHtml(r.text);
			if (r.code || r.pre) return `<code class="rounded bg-slate-900/10 px-1 font-mono text-[0.85em]">${html}</code>`;
			if (r.bold) html = `<strong>${html}</strong>`;
			if (r.italic) html = `<em>${html}</em>`;
			if (r.underline) html = `<u>${html}</u>`;
			if (r.strike) html = `<s>${html}</s>`;
			if (r.spoiler) html = `<span class="rounded bg-slate-900/10 px-0.5">${html}</span>`;
			if (r.link) html = `<a href="${escapeHtml(r.link)}" target="_blank" rel="noreferrer" class="underline">${html}</a>`;
			return html;
		})
		.join('');
}

/** Clock time for message bubbles. */
export function clock(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '';
	return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
