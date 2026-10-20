import { describe, expect, test } from 'bun:test';
import { markdownToRuns, splitRuns } from './markdown.js';
import { plainText, renderDiscord, renderSlackMrkdwn, renderTelegramEntities } from './format.js';
import type { TextRun } from './schema.js';

const marked = (runs: TextRun[], mark: keyof TextRun) => runs.filter((run) => run[mark]).map((run) => run.text);

describe('markdownToRuns — inline', () => {
	test('bold, italic, strike, code and links', () => {
		const runs = markdownToRuns('Use **bold**, *italic*, ~~old~~, `npm i` and [docs](https://x.dev).');
		expect(plainText(runs)).toBe('Use bold, italic, old, npm i and docs.');
		expect(marked(runs, 'bold')).toEqual(['bold']);
		expect(marked(runs, 'italic')).toEqual(['italic']);
		expect(marked(runs, 'strike')).toEqual(['old']);
		expect(marked(runs, 'code')).toEqual(['npm i']);
		expect(runs.find((run) => run.link)?.link).toBe('https://x.dev');
	});

	test('nested emphasis keeps both marks', () => {
		const runs = markdownToRuns('**bold and *both***');
		expect(runs.find((run) => run.text === 'both')).toMatchObject({ bold: true, italic: true });
	});

	test('snake_case, lone asterisks and escapes stay literal', () => {
		expect(plainText(markdownToRuns('call my_var_name now'))).toBe('call my_var_name now');
		expect(marked(markdownToRuns('call my_var_name now'), 'italic')).toEqual([]);
		expect(plainText(markdownToRuns('2 * 3 * 4'))).toBe('2 * 3 * 4');
		expect(plainText(markdownToRuns('\\*not italic\\*'))).toBe('*not italic*');
	});

	test('code spans are literal inside', () => {
		const runs = markdownToRuns('run `**not bold**`');
		expect(marked(runs, 'code')).toEqual(['**not bold**']);
		expect(marked(runs, 'bold')).toEqual([]);
	});

	test('unclosed markers are kept as text', () => {
		expect(plainText(markdownToRuns('a **dangling'))).toBe('a **dangling');
		expect(plainText(markdownToRuns('see [label](no-close'))).toBe('see [label](no-close');
	});
});

describe('markdownToRuns — blocks', () => {
	test('fenced code keeps its language and its contents verbatim', () => {
		const runs = markdownToRuns('Before\n\n```ts\nconst a = **1**;\n```\n\nAfter');
		const pre = runs.find((run) => run.pre);
		expect(pre).toMatchObject({ text: 'const a = **1**;', language: 'ts' });
		expect(plainText(runs)).toBe('Before\n\nconst a = **1**;\n\nAfter');
	});

	test('headings become bold lines, lists get bullets, task lists get boxes', () => {
		const runs = markdownToRuns('# Plan\n\n- one\n- **two**\n  - nested\n1. first\n- [ ] todo\n- [x] done');
		expect(plainText(runs)).toBe('Plan\n\n• one\n• two\n  • nested\n1. first\n☐ todo\n☑ done');
		expect(marked(runs, 'bold')).toEqual(['Plan', 'two']);
	});

	test('quotes are marked as one quote, with formatting inside', () => {
		const runs = markdownToRuns('> a **b**\n> c');
		expect(runs.every((run) => run.blockquote)).toBe(true);
		const { entities } = renderTelegramEntities(runs);
		expect(entities.filter((e) => e.type === 'blockquote')).toEqual([{ type: 'blockquote', offset: 0, length: plainText(runs).length }]);
	});

	test('tables become an aligned monospace block', () => {
		const runs = markdownToRuns('| Name | Qty |\n|---|---:|\n| **apple** | 3 |\n| fig | 12 |');
		expect(runs).toHaveLength(1);
		expect(runs[0]!.pre).toBe(true);
		expect(runs[0]!.text.split('\n')).toEqual(['Name  │ Qty', '──────┼────', 'apple │ 3', 'fig   │ 12']);
	});

	test('an unclosed fence takes the rest of the message', () => {
		const runs = markdownToRuns('```\nline 1\nline 2');
		expect(runs[0]).toMatchObject({ text: 'line 1\nline 2', pre: true });
	});
});

describe('renderers', () => {
	test('Telegram carries the code language', () => {
		const { entities } = renderTelegramEntities(markdownToRuns('```python\nprint(1)\n```'));
		expect(entities).toEqual([{ type: 'pre', offset: 0, length: 8, language: 'python' }]);
	});

	test('Discord and Slack prefix quoted lines', () => {
		const runs = markdownToRuns('> one\n> two');
		expect(renderDiscord(runs)).toBe('> one\n> two');
		expect(renderSlackMrkdwn(runs)).toBe('>one\n>two');
	});
});

describe('splitRuns', () => {
	test('a message under the limit is one chunk', () => {
		const runs = markdownToRuns('hello **world**');
		expect(splitRuns(runs, 100)).toEqual([runs]);
	});

	test('cuts at paragraph breaks and keeps marks on both sides', () => {
		const paragraph = `**${'word '.repeat(30).trim()}**`;
		const runs = markdownToRuns([paragraph, paragraph, paragraph].join('\n\n'));
		const chunks = splitRuns(runs, 200);
		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			expect(plainText(chunk).length).toBeLessThanOrEqual(200);
			expect(chunk.every((run) => run.bold || !run.text.trim())).toBe(true);
			expect(plainText(chunk)).toBe(plainText(chunk).trim());
		}
		expect(chunks.map(plainText).join(' ').replace(/\s+/g, ' ')).toBe(plainText(runs).replace(/\s+/g, ' '));
	});

	test('a code block too long for one message stays code in every chunk', () => {
		const code = Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n');
		const chunks = splitRuns(markdownToRuns(`\`\`\`ts\n${code}\n\`\`\``), 120);
		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) expect(chunk.every((run) => run.pre && run.language === 'ts')).toBe(true);
	});

	test('never splits a surrogate pair', () => {
		const chunks = splitRuns([{ text: '😀'.repeat(50) }], 21);
		for (const chunk of chunks) expect(plainText(chunk)).not.toMatch(/[\uD800-\uDBFF]$/);
		expect(chunks.map(plainText).join('')).toBe('😀'.repeat(50));
	});
});
