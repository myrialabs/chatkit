import { test, expect, describe } from 'bun:test';
import { capabilities, emptySupport, assertSupported, CapabilityError, CapabilityRegistry } from './capability.js';
import { text, media, location, reaction } from './envelope.js';

const telegram = capabilities('telegram', {
	...emptySupport(),
	reactions: true,
	location: true,
	media: ['image', 'document']
});

describe('assertSupported', () => {
	test('allows text and passthrough always', () => {
		expect(() => assertSupported(telegram, text('hi') as any)).not.toThrow();
		expect(() => assertSupported(telegram, { type: 'passthrough' })).not.toThrow();
	});

	test('gates unsupported media type with a clear error', () => {
		expect(() => assertSupported(telegram, media({ mediaType: 'sticker', url: 'x' }) as any)).toThrow(CapabilityError);
		expect(() => assertSupported(telegram, media({ mediaType: 'image', url: 'x' }) as any)).not.toThrow();
	});

	test('gates location and reactions per descriptor', () => {
		expect(() => assertSupported(telegram, location(1, 2) as any)).not.toThrow();
		const noReact = capabilities('slack', emptySupport());
		expect(() => assertSupported(noReact, reaction('👍', '1') as any)).toThrow(CapabilityError);
	});
});

describe('CapabilityRegistry', () => {
	test('stores and retrieves descriptors', () => {
		const reg = new CapabilityRegistry();
		reg.set(telegram);
		expect(reg.get('telegram')?.supports.reactions).toBe(true);
		expect(reg.has('discord')).toBe(false);
		expect(reg.all()).toHaveLength(1);
	});
});
