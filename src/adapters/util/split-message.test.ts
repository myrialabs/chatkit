import { test, expect, describe } from 'bun:test';
import { splitMessage, TEXT_LIMITS } from './split-message.js';

describe('splitMessage', () => {
	test('returns single chunk when within limit', () => {
		expect(splitMessage('short', { limit: 100 })).toEqual(['short']);
	});

	test('every chunk respects the limit', () => {
		const text = 'word '.repeat(500);
		const chunks = splitMessage(text, { limit: 100, preserveCodeFences: false });
		expect(chunks.length).toBeGreaterThan(1);
		for (const c of chunks) expect(c.length).toBeLessThanOrEqual(100);
		// No content lost (ignoring our re-joining of split points).
		expect(chunks.join('').replace(/\s+/g, ' ').trim()).toBe(text.replace(/\s+/g, ' ').trim());
	});

	test('hard-splits an oversized single token', () => {
		const chunks = splitMessage('x'.repeat(250), { limit: 100, preserveCodeFences: false });
		expect(chunks).toHaveLength(3);
		expect(chunks.every((c) => c.length <= 100)).toBe(true);
	});

	test('keeps code fences balanced across chunks', () => {
		const code = '```\n' + 'line\n'.repeat(100) + '```';
		const chunks = splitMessage(code, { limit: 80, preserveCodeFences: true });
		for (const c of chunks) {
			const fences = (c.match(/```/g) ?? []).length;
			expect(fences % 2).toBe(0); // each chunk opens and closes its fences
		}
	});

	test('exposes well-known limits', () => {
		expect(TEXT_LIMITS.telegram).toBe(4096);
		expect(TEXT_LIMITS.discord).toBe(2000);
	});
});
