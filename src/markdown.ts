/**
 * Markdown → universal {@link TextRun}s, and a run-aware splitter.
 *
 * What an LLM writes is GitHub-flavoured Markdown, and no chat platform renders
 * it verbatim: Telegram shows the asterisks, Slack has its own dialect, and the
 * WhatsApp/Discord dialects differ in the details. Parsing ONCE into runs and
 * letting each adapter's renderer do the rest is what keeps that a single
 * problem rather than one per platform.
 *
 * A deliberately small, zero-dependency GFM subset — the shapes model output
 * actually uses:
 *
 *   - inline: `code`, **bold** / __bold__, *italic* / _italic_, ~~strike~~,
 *     [label](url), ![alt](url), <https://autolinks>, backslash escapes
 *   - blocks: fenced code (``` / ~~~, with language), ATX headings, block
 *     quotes (nested Markdown inside), bullet / numbered / task lists, tables,
 *     horizontal rules, paragraphs
 *
 * Chat platforms have no headings, lists or tables, so those degrade to what
 * reads the same: a heading is a bold line, a list item gets a `•` (or its
 * number), a table becomes an aligned monospace block. Anything unparseable is
 * kept as literal text — this never throws and never drops characters a user
 * would miss.
 */

import type { TextRun } from './schema.js';

type Marks = Omit<TextRun, 'text'>;

const FENCE = /^(\s*)(`{3,}|~{3,})\s*([^\s`]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function sameMarks(a: Marks, b: Marks): boolean {
	const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof Marks>;
	for (const key of keys) {
		if (key === 'mention') {
			if (a.mention?.id !== b.mention?.id) return false;
			continue;
		}
		if ((a[key] ?? undefined) !== (b[key] ?? undefined)) return false;
	}
	return true;
}

function marksOf(run: TextRun): Marks {
	const marks: Marks = { ...run };
	delete (marks as Partial<TextRun>).text;
	return marks;
}

/** Push a run, merging into the previous one when the marks match. */
function push(out: TextRun[], text: string, marks: Marks): void {
	if (!text) return;
	const last = out[out.length - 1];
	if (last && sameMarks(marksOf(last), marks)) {
		last.text += text;
		return;
	}
	out.push({ text, ...marks });
}

function isWordChar(ch: string | undefined): boolean {
	return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}

/** Find the closing `delim` for an emphasis opened at `from`, or -1. */
function findClose(text: string, delim: string, from: number): number {
	let i = from;
	while (i < text.length) {
		const at = text.indexOf(delim, i);
		if (at === -1) return -1;
		// A closer is never preceded by whitespace (`foo *` is not italic) and,
		// for underscores, never followed by a word character (snake_case_names).
		const before = text[at - 1];
		const after = text[at + delim.length];
		const escaped = before === '\\';
		const validUnderscore = delim[0] !== '_' || !isWordChar(after);
		if (at > from && before !== undefined && !/\s/.test(before) && !escaped && validUnderscore) {
			// `**` must not close a single `*` and vice versa.
			if (delim.length === 1 && text[at + 1] === delim) {
				i = at + 2;
				continue;
			}
			// In a longer run (`***`), a double delimiter closes at the END of
			// the run, so `**a *b***` leaves the inner `*` to close `*b`.
			let close = at;
			if (delim.length === 2) while (text[close + 2] === delim[0]) close++;
			return close;
		}
		i = at + delim.length;
	}
	return -1;
}

/** Parse inline Markdown into runs carrying `base` marks plus their own. */
export function inlineToRuns(text: string, base: Marks = {}): TextRun[] {
	const out: TextRun[] = [];
	let plain = '';
	const flush = (): void => {
		push(out, plain, base);
		plain = '';
	};
	const emit = (runs: TextRun[]): void => {
		flush();
		for (const run of runs) push(out, run.text, marksOf(run));
	};

	let i = 0;
	while (i < text.length) {
		const ch = text[i]!;
		const next = text[i + 1];

		// Backslash escape of ASCII punctuation.
		if (ch === '\\' && next !== undefined && /[!-/:-@[-`{-~]/.test(next)) {
			plain += next;
			i += 2;
			continue;
		}

		// Inline code — contents are literal, so it is matched before anything else.
		if (ch === '`') {
			let ticks = 1;
			while (text[i + ticks] === '`') ticks++;
			const fence = '`'.repeat(ticks);
			const end = text.indexOf(fence, i + ticks);
			if (end !== -1) {
				let code = text.slice(i + ticks, end);
				if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ')) code = code.slice(1, -1);
				emit([{ text: code, ...base, code: true }]);
				i = end + ticks;
				continue;
			}
			plain += fence;
			i += ticks;
			continue;
		}

		// Images and links: ![alt](url) / [label](url).
		if (ch === '[' || (ch === '!' && next === '[')) {
			const isImage = ch === '!';
			const open = isImage ? i + 1 : i;
			const close = findBracket(text, open);
			if (close !== -1 && text[close + 1] === '(') {
				const paren = text.indexOf(')', close + 2);
				if (paren !== -1) {
					const url = text.slice(close + 2, paren).trim().split(/\s+/)[0] ?? '';
					const label = text.slice(open + 1, close);
					if (url) {
						emit(isImage ? [{ text: label || url, ...base, link: url }] : inlineToRuns(label || url, { ...base, link: url }));
						i = paren + 1;
						continue;
					}
				}
			}
		}

		// <https://autolink>
		if (ch === '<') {
			const end = text.indexOf('>', i + 1);
			const inner = end !== -1 ? text.slice(i + 1, end) : '';
			if (/^(https?:\/\/|mailto:)\S+$/i.test(inner)) {
				emit([{ text: inner.replace(/^mailto:/i, ''), ...base, link: inner }]);
				i = end + 1;
				continue;
			}
		}

		// Emphasis: ** __ ~~ then * _.
		const double = ch + (next ?? '');
		if (double === '**' || double === '__' || double === '~~') {
			const leftOk = ch !== '_' || !isWordChar(text[i - 1]);
			const end = leftOk && text[i + 2] !== undefined && !/\s/.test(text[i + 2]!) ? findClose(text, double, i + 2) : -1;
			if (end !== -1) {
				const marks = double === '~~' ? { ...base, strike: true } : { ...base, bold: true };
				emit(inlineToRuns(text.slice(i + 2, end), marks));
				i = end + 2;
				continue;
			}
		}
		if ((ch === '*' || ch === '_') && next !== ch) {
			const leftOk = ch !== '_' || !isWordChar(text[i - 1]);
			const end = leftOk && next !== undefined && !/\s/.test(next) ? findClose(text, ch, i + 1) : -1;
			if (end !== -1) {
				emit(inlineToRuns(text.slice(i + 1, end), { ...base, italic: true }));
				i = end + 1;
				continue;
			}
		}

		plain += ch;
		i++;
	}
	flush();
	return out;
}

/** Index of the `]` closing the `[` at `open`, honouring nesting and escapes. */
function findBracket(text: string, open: number): number {
	let depth = 0;
	for (let i = open; i < text.length; i++) {
		const ch = text[i];
		if (ch === '\\') {
			i++;
			continue;
		}
		if (ch === '[') depth++;
		else if (ch === ']') {
			depth--;
			if (depth === 0) return i;
		}
	}
	return -1;
}

function splitCells(line: string): string[] {
	let row = line.trim();
	if (row.startsWith('|')) row = row.slice(1);
	if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
	return row.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

function plain(runs: TextRun[]): string {
	return runs.map((run) => run.text).join('');
}

/** A table as an aligned monospace block — the only layout every chat app keeps. */
function renderTable(rows: string[][]): string {
	const cells = rows.map((row) => row.map((cell) => plain(inlineToRuns(cell))));
	const widths: number[] = [];
	for (const row of cells) row.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, [...cell].length)));
	const line = (row: string[]) => widths.map((w, i) => (row[i] ?? '').padEnd(w)).join(' │ ').trimEnd();
	const [head, ...body] = cells;
	return [line(head ?? []), widths.map((w) => '─'.repeat(w)).join('─┼─'), ...body.map(line)].join('\n');
}

interface Block {
	runs: TextRun[];
	/** List items are joined to their neighbours by one newline, not a blank line. */
	tight?: boolean;
}

function parseBlocks(markdown: string): Block[] {
	const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
	const blocks: Block[] = [];
	let paragraph: string[] = [];
	const flushParagraph = (): void => {
		if (paragraph.length) blocks.push({ runs: inlineToRuns(paragraph.join('\n')) });
		paragraph = [];
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;

		const fence = FENCE.exec(line);
		if (fence) {
			flushParagraph();
			const marker = fence[2]!;
			const language = fence[3] || undefined;
			const body: string[] = [];
			let j = i + 1;
			for (; j < lines.length; j++) {
				const closing = lines[j]!.trim();
				if (closing.startsWith(marker[0]!.repeat(marker.length)) && /^(`+|~+)$/.test(closing)) break;
				body.push(lines[j]!);
			}
			blocks.push({ runs: [{ text: body.join('\n') || ' ', pre: true, ...(language ? { language } : {}) }] });
			i = j;
			continue;
		}

		if (!line.trim()) {
			flushParagraph();
			continue;
		}

		const heading = HEADING.exec(line);
		if (heading) {
			flushParagraph();
			blocks.push({ runs: inlineToRuns(heading[2]!, { bold: true }) });
			continue;
		}

		if (RULE.test(line)) {
			flushParagraph();
			blocks.push({ runs: [{ text: '──────────' }] });
			continue;
		}

		if (QUOTE.test(line)) {
			flushParagraph();
			const quoted: string[] = [];
			while (i < lines.length && QUOTE.test(lines[i]!)) quoted.push(lines[i++]!.replace(QUOTE, ''));
			i--;
			const inner = markdownToRuns(quoted.join('\n'));
			blocks.push({ runs: inner.map((run) => ({ ...run, blockquote: true })) });
			continue;
		}

		if (line.includes('|') && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1]!) && lines[i + 1]!.includes('-')) {
			flushParagraph();
			const rows = [splitCells(line)];
			let j = i + 2;
			for (; j < lines.length && lines[j]!.includes('|') && lines[j]!.trim(); j++) rows.push(splitCells(lines[j]!));
			blocks.push({ runs: [{ text: renderTable(rows), pre: true }] });
			i = j - 1;
			continue;
		}

		const item = LIST_ITEM.exec(line);
		if (item) {
			flushParagraph();
			const depth = Math.floor(item[1]!.replace(/\t/g, '  ').length / 2);
			const ordered = /\d/.test(item[2]!);
			let content = item[3]!;
			let bullet = ordered ? `${item[2]!.replace(')', '.')} ` : '• ';
			const task = /^\[([ xX])\]\s+/.exec(content);
			if (task) {
				bullet = task[1] === ' ' ? '☐ ' : '☑ ';
				content = content.slice(task[0].length);
			}
			const runs: TextRun[] = [];
			push(runs, `${'  '.repeat(depth)}${bullet}`, {});
			for (const run of inlineToRuns(content)) push(runs, run.text, marksOf(run));
			blocks.push({ runs, tight: true });
			continue;
		}

		paragraph.push(line);
	}
	flushParagraph();
	return blocks;
}

/** Parse Markdown into runs. Blocks are separated by a blank line; list items by one newline. */
export function markdownToRuns(markdown: string): TextRun[] {
	const out: TextRun[] = [];
	let previous: Block | null = null;
	for (const block of parseBlocks(markdown)) {
		if (previous) push(out, previous.tight && block.tight ? '\n' : '\n\n', {});
		for (const run of block.runs) push(out, run.text, marksOf(run));
		previous = block;
	}
	return out;
}

/**
 * Split runs into chunks of at most `limit` characters (UTF-16 code units —
 * the unit Telegram and Discord count in), cutting at a paragraph break, then
 * a line break, then a space, and only mid-word as a last resort. Every run
 * keeps its marks on both sides of a cut, so a code block that has to be split
 * is still a code block in each message — which is what splitting the plain
 * string first and formatting after could never guarantee.
 */
export function splitRuns(runs: TextRun[], limit: number): TextRun[][] {
	const text = plain(runs);
	if (text.length <= limit) return runs.length ? [runs] : [];

	const cuts: number[] = [];
	let start = 0;
	while (text.length - start > limit) {
		const windowEnd = start + limit;
		const slice = text.slice(start, windowEnd);
		const minimum = Math.floor(limit / 2);
		let cut = -1;
		for (const boundary of ['\n\n', '\n', ' ']) {
			const at = slice.lastIndexOf(boundary);
			if (at >= minimum) {
				cut = start + at + boundary.length;
				break;
			}
		}
		if (cut === -1) {
			cut = windowEnd;
			// Never split a surrogate pair.
			const code = text.charCodeAt(cut - 1);
			if (code >= 0xd800 && code <= 0xdbff) cut--;
		}
		cuts.push(cut);
		start = cut;
	}

	const chunks: TextRun[][] = [];
	let chunk: TextRun[] = [];
	let offset = 0;
	let nextCut = 0;
	for (const run of runs) {
		let piece = run.text;
		const marks = marksOf(run);
		while (piece.length) {
			const boundary = cuts[nextCut] ?? Infinity;
			const room = boundary - offset;
			if (piece.length <= room) {
				push(chunk, piece, marks);
				offset += piece.length;
				piece = '';
			} else {
				push(chunk, piece.slice(0, room), marks);
				offset += room;
				piece = piece.slice(room);
			}
			if (offset === boundary) {
				chunks.push(chunk);
				chunk = [];
				nextCut++;
			}
		}
	}
	if (chunk.length) chunks.push(chunk);

	// A cut lands after the separator; leading or trailing blank lines on a
	// message are noise, so trim them without touching the marks.
	return chunks
		.map((runsOfChunk) => {
			const trimmed = runsOfChunk.map((run) => ({ ...run }));
			while (trimmed.length && !trimmed[0]!.pre && !trimmed[0]!.text.replace(/^\s+/, '')) trimmed.shift();
			if (trimmed[0] && !trimmed[0].pre) trimmed[0].text = trimmed[0].text.replace(/^\n+/, '');
			const last = trimmed[trimmed.length - 1];
			if (last && !last.pre) last.text = last.text.replace(/\s+$/, '');
			return trimmed.filter((run) => run.text.length > 0);
		})
		.filter((runsOfChunk) => runsOfChunk.length > 0);
}
