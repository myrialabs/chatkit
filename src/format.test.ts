import { test, expect, describe } from 'bun:test';
import {
	plainText,
	renderTelegramEntities,
	renderDiscord,
	renderSlackMrkdwn,
	renderWhatsApp,
	telegramEntitiesToRuns
} from './format.js';
import type { TextRun } from './schema.js';

const runs: TextRun[] = [
	{ text: 'Hi ' },
	{ text: 'bold', bold: true },
	{ text: ' ' },
	{ text: 'link', link: 'https://x.io' }
];

describe('plainText', () => {
	test('concatenates run text', () => {
		expect(plainText(runs)).toBe('Hi bold link');
	});
});

describe('renderTelegramEntities', () => {
	test('emits offset/length entities over the raw text', () => {
		const { text, entities } = renderTelegramEntities(runs);
		expect(text).toBe('Hi bold link');
		expect(entities).toEqual([
			{ type: 'bold', offset: 3, length: 4 },
			{ type: 'text_link', offset: 8, length: 4, url: 'https://x.io' }
		]);
	});

	test('a single run can carry multiple marks', () => {
		const { entities } = renderTelegramEntities([{ text: 'x', bold: true, italic: true, underline: true }]);
		expect(entities.map((e) => e.type).sort()).toEqual(['bold', 'italic', 'underline']);
	});

	test('numeric mention becomes text_mention; non-numeric degrades', () => {
		expect(renderTelegramEntities([{ text: '@a', mention: { id: '42' } }]).entities).toEqual([
			{ type: 'text_mention', offset: 0, length: 2, user: { id: 42 } }
		]);
		expect(renderTelegramEntities([{ text: '@a', mention: { id: 'U01' } }]).entities).toEqual([]);
	});
});

describe('renderDiscord', () => {
	test('wraps marks in markdown and escapes literals', () => {
		expect(renderDiscord([{ text: 'a*b', bold: true }])).toBe('**a\\*b**');
		expect(renderDiscord([{ text: 'x', spoiler: true }])).toBe('||x||');
		expect(renderDiscord([{ text: 'lbl', link: 'https://x.io' }])).toBe('[lbl](https://x.io)');
	});
	test('mention becomes <@id>', () => {
		expect(renderDiscord([{ text: 'n', mention: { id: '123' } }])).toBe('<@123>');
	});
});

describe('renderSlackMrkdwn', () => {
	test('uses mrkdwn syntax and drops unsupported marks', () => {
		expect(renderSlackMrkdwn([{ text: 'b', bold: true }])).toBe('*b*');
		// underline is unsupported → dropped
		expect(renderSlackMrkdwn([{ text: 'u', underline: true }])).toBe('u');
		expect(renderSlackMrkdwn([{ text: 'lbl', link: 'https://x.io' }])).toBe('<https://x.io|lbl>');
	});
	test('HTML-escapes angle brackets and ampersands', () => {
		expect(renderSlackMrkdwn([{ text: '1 < 2 & 3' }])).toBe('1 &lt; 2 &amp; 3');
	});
});

describe('renderWhatsApp', () => {
	test('uses WhatsApp markup and collects mention JIDs', () => {
		expect(renderWhatsApp([{ text: 'b', bold: true }]).text).toBe('*b*');
		const m = renderWhatsApp([{ text: 'Andi', mention: { id: '628123' } }]);
		expect(m.text).toBe('@628123');
		expect(m.mentions).toEqual(['628123@s.whatsapp.net']);
	});
});

describe('telegramEntitiesToRuns', () => {
	test('reconstructs runs from overlapping entities', () => {
		const rich = telegramEntitiesToRuns('Hi there', [{ type: 'bold', offset: 3, length: 5 }]);
		expect(rich).toEqual([{ text: 'Hi ' }, { text: 'there', bold: true }]);
	});
	test('returns undefined for plain text', () => {
		expect(telegramEntitiesToRuns('plain', [])).toBeUndefined();
		expect(telegramEntitiesToRuns('plain', undefined)).toBeUndefined();
	});
	test('maps text_link and text_mention', () => {
		const rich = telegramEntitiesToRuns('go', [{ type: 'text_link', offset: 0, length: 2, url: 'https://x.io' }]);
		expect(rich).toEqual([{ text: 'go', link: 'https://x.io' }]);
		const men = telegramEntitiesToRuns('Al', [{ type: 'text_mention', offset: 0, length: 2, user: { id: 7 } }]);
		expect(men).toEqual([{ text: 'Al', mention: { id: '7', display: 'Al' } }]);
	});
});
