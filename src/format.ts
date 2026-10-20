/**
 * Pure renderers that turn ChatKit's universal {@link TextRun} array into each
 * platform's native rich-text representation. Formatting is **best-effort**: a mark
 * a platform can't express is dropped and the text is kept — this never throws and
 * is never capability-gated, unlike buttons or media.
 *
 * Support matrix (mark → platform):
 *
 * | mark       | Telegram | Discord | Slack | WhatsApp (both) |
 * |------------|:--------:|:-------:|:-----:|:---------------:|
 * | bold       |    ✅    |   ✅    |  ✅   |       ✅        |
 * | italic     |    ✅    |   ✅    |  ✅   |       ✅        |
 * | strike     |    ✅    |   ✅    |  ✅   |       ✅        |
 * | code / pre |    ✅    |   ✅    |  ✅   |       ✅        |
 * | link       |    ✅    |   ✅    |  ✅   |  ⚠️ plain url   |
 * | underline  |    ✅    |   ✅    |  ❌   |       ❌        |
 * | spoiler    |    ✅    |   ✅    |  ❌   |       ❌        |
 * | mention    |    ✅    |   ✅    |  ✅   |  ✅ (Baileys)   |
 * | blockquote |    ✅    |   ✅    |  ✅   |       ✅        |
 * | pre lang   |    ✅    |   ✅    |  ❌   |       ❌        |
 *
 * Telegram is rendered as an `entities` array (offset/length over the raw text),
 * which avoids markup-escaping entirely. The others are rendered as their native
 * markup string (Discord/WhatsApp markdown, Slack `mrkdwn`).
 */

import type { TextRun } from './schema.js';

/** The concatenated plain text of a run array — the canonical, mark-free form. */
export function plainText(runs: TextRun[]): string {
	return runs.map((r) => r.text).join('');
}

// --- Telegram (entities) ----------------------------------------------------

/** A Telegram `MessageEntity`. Offsets/lengths are in UTF-16 code units. */
export interface TelegramEntity {
	type: string;
	offset: number;
	length: number;
	url?: string;
	user?: { id: number };
	language?: string;
}

/**
 * Render runs to Telegram's `{ text, entities }`. Emit one entity per active mark;
 * Telegram permits multiple entities over the same span, so a bold link is two
 * entities. `text_mention` requires a numeric user id — a non-numeric mention id
 * degrades to plain text.
 */
export function renderTelegramEntities(runs: TextRun[]): { text: string; entities: TelegramEntity[] } {
	let text = '';
	const entities: TelegramEntity[] = [];
	// A quote spans runs: open it at the first quoted run, close it at the
	// first one that is not, so formatting inside a quote stays one quote.
	let quoteStart: number | null = null;
	const closeQuote = (end: number): void => {
		if (quoteStart !== null && end > quoteStart) entities.push({ type: 'blockquote', offset: quoteStart, length: end - quoteStart });
		quoteStart = null;
	};
	for (const run of runs) {
		const offset = text.length; // JS strings are UTF-16 — matches Telegram.
		const length = run.text.length;
		if (run.blockquote && quoteStart === null) quoteStart = offset;
		if (!run.blockquote && quoteStart !== null) closeQuote(offset);
		text += run.text;
		if (length === 0) continue;
		const push = (type: string, extra?: Partial<TelegramEntity>): void => {
			entities.push({ type, offset, length, ...extra });
		};
		if (run.pre) push('pre', run.language ? { language: run.language } : undefined);
		else if (run.code) push('code');
		if (run.bold) push('bold');
		if (run.italic) push('italic');
		if (run.underline) push('underline');
		if (run.strike) push('strikethrough');
		if (run.spoiler) push('spoiler');
		if (run.link) push('text_link', { url: run.link });
		if (run.mention) {
			const id = Number(run.mention.id);
			if (Number.isFinite(id) && run.mention.id.trim() !== '') push('text_mention', { user: { id } });
		}
	}
	closeQuote(text.length);
	entities.sort((a, b) => a.offset - b.offset);
	return { text, entities };
}

/**
 * Prefix every line a quoted run starts or continues with `marker`, for the
 * markup platforms whose quote syntax is a line prefix.
 */
function quoteLines(out: string, seg: string, marker: string): string {
	const atLineStart = out.length === 0 || out.endsWith('\n');
	return (atLineStart ? marker : '') + seg.replace(/\n(?!$)/g, `\n${marker}`);
}

// --- Discord (markdown) -----------------------------------------------------

function escapeDiscord(s: string): string {
	return s.replace(/([\\*_~`|>[\]()])/g, '\\$1');
}

/** Render runs to Discord message markdown. */
export function renderDiscord(runs: TextRun[]): string {
	let out = '';
	for (const run of runs) {
		if (run.mention) {
			out += `<@${run.mention.id}>`;
			continue;
		}
		if (run.pre) {
			out += `\`\`\`${run.language ?? ''}\n${run.text}\n\`\`\``;
			continue;
		}
		if (run.code) {
			out += `\`${run.text.replace(/`/g, '\\`')}\``;
			continue;
		}
		let seg = escapeDiscord(run.text);
		if (run.strike) seg = `~~${seg}~~`;
		if (run.underline) seg = `__${seg}__`;
		if (run.italic) seg = `*${seg}*`;
		if (run.bold) seg = `**${seg}**`;
		if (run.spoiler) seg = `||${seg}||`;
		if (run.link) seg = `[${seg}](${run.link})`;
		out += run.blockquote ? quoteLines(out, seg, '> ') : seg;
	}
	return out;
}

// --- Slack (mrkdwn) ---------------------------------------------------------

function escapeSlack(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Render runs to Slack `mrkdwn`. Underline and spoiler are unsupported → dropped. */
export function renderSlackMrkdwn(runs: TextRun[]): string {
	let out = '';
	for (const run of runs) {
		if (run.mention) {
			out += `<@${run.mention.id}>`;
			continue;
		}
		if (run.pre) {
			out += `\`\`\`${run.text}\`\`\``;
			continue;
		}
		if (run.code) {
			out += `\`${run.text}\``;
			continue;
		}
		if (run.link) {
			out += `<${run.link}|${escapeSlack(run.text)}>`;
			continue;
		}
		let seg = escapeSlack(run.text);
		if (run.strike) seg = `~${seg}~`;
		if (run.italic) seg = `_${seg}_`;
		if (run.bold) seg = `*${seg}*`;
		out += run.blockquote ? quoteLines(out, seg, '>') : seg;
	}
	return out;
}

// --- WhatsApp (markdown + mentions) -----------------------------------------

/** Normalise a mention id to a WhatsApp JID (Baileys `mentions` array). */
function toJid(id: string): string {
	return id.includes('@') ? id : `${id.replace(/[^\d]/g, '')}@s.whatsapp.net`;
}

/**
 * Render runs to WhatsApp markup. Returns the text plus the `mentions` JID array
 * (used by Baileys; the Cloud API ignores it — mentions in free-form text are not
 * supported there and degrade to a plain `@number`). Underline/spoiler are dropped;
 * links become a plain URL since WhatsApp has no inline-link syntax.
 */
export function renderWhatsApp(runs: TextRun[]): { text: string; mentions: string[] } {
	let out = '';
	const mentions: string[] = [];
	for (const run of runs) {
		if (run.mention) {
			const digits = run.mention.id.replace(/[^\d]/g, '');
			out += `@${digits}`;
			mentions.push(toJid(run.mention.id));
			continue;
		}
		if (run.pre || run.code) {
			out += `\`\`\`${run.text}\`\`\``;
			continue;
		}
		let seg = run.text;
		if (run.strike) seg = `~${seg}~`;
		if (run.italic) seg = `_${seg}_`;
		if (run.bold) seg = `*${seg}*`;
		if (run.link) seg = seg === run.link ? seg : `${seg} (${run.link})`;
		out += run.blockquote ? quoteLines(out, seg, '> ') : seg;
	}
	return { text: out, mentions };
}

// --- Inbound: Telegram entities → runs --------------------------------------

interface InboundTelegramEntity {
	type: string;
	offset: number;
	length: number;
	url?: string;
	user?: { id: number | string };
	language?: string;
}

/**
 * Convert an inbound Telegram `text`/`entities` pair back into universal runs, so a
 * received formatted message round-trips and consumers (e.g. an inbox UI) can render
 * it. Entities may overlap; we slice the text at every entity boundary and fold the
 * marks covering each slice onto one run. Plain segments become mark-less runs.
 */
export function telegramEntitiesToRuns(text: string, entities: InboundTelegramEntity[] | undefined): TextRun[] | undefined {
	if (!entities || entities.length === 0) return undefined;
	// Collect every boundary so each slice has a uniform set of covering entities.
	const bounds = new Set<number>([0, text.length]);
	for (const e of entities) {
		bounds.add(e.offset);
		bounds.add(e.offset + e.length);
	}
	const points = [...bounds].filter((p) => p >= 0 && p <= text.length).sort((a, b) => a - b);
	const runs: TextRun[] = [];
	for (let i = 0; i < points.length - 1; i++) {
		const start = points[i]!;
		const end = points[i + 1]!;
		if (end <= start) continue;
		const slice = text.slice(start, end);
		const run: TextRun = { text: slice };
		for (const e of entities) {
			if (e.offset > start || e.offset + e.length < end) continue;
			applyEntity(run, e);
		}
		runs.push(run);
	}
	// A single mark-less run carries no information beyond `text` — skip it.
	if (runs.length === 1 && isPlain(runs[0]!)) return undefined;
	return runs;
}

function applyEntity(run: TextRun, e: InboundTelegramEntity): void {
	switch (e.type) {
		case 'bold':
			run.bold = true;
			break;
		case 'italic':
			run.italic = true;
			break;
		case 'underline':
			run.underline = true;
			break;
		case 'strikethrough':
			run.strike = true;
			break;
		case 'spoiler':
			run.spoiler = true;
			break;
		case 'code':
			run.code = true;
			break;
		case 'pre':
			run.pre = true;
			if (e.language) run.language = e.language;
			break;
		case 'blockquote':
		case 'expandable_blockquote':
			run.blockquote = true;
			break;
		case 'text_link':
			if (e.url) run.link = e.url;
			break;
		case 'url':
			run.link = run.text;
			break;
		case 'text_mention':
			if (e.user) run.mention = { id: String(e.user.id), display: run.text };
			break;
		case 'mention':
			run.mention = { id: run.text.replace(/^@/, ''), display: run.text };
			break;
	}
}

function isPlain(run: TextRun): boolean {
	return !(run.bold || run.italic || run.strike || run.underline || run.code || run.pre || run.spoiler || run.link || run.mention || run.blockquote);
}
