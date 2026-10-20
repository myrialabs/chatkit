import { describe, expect, test } from 'bun:test';
import { assertSupportedRuntime, versionAtLeast } from './runtime.js';

describe('runtime guard', () => {
	test('compares versions numerically, not lexically', () => {
		expect(versionAtLeast('22.13.0', '22.13.0')).toBe(true);
		expect(versionAtLeast('22.9.0', '22.13.0')).toBe(false);
		expect(versionAtLeast('24.0.0', '22.13.0')).toBe(true);
		expect(versionAtLeast('1.10.0', '1.2.0')).toBe(true);
	});

	test('rejects Node older than the floor', () => {
		expect(() => assertSupportedRuntime({ node: '20.20.2' })).toThrow(/Node >= 22\.13/);
		expect(() => assertSupportedRuntime({ node: '22.12.0' })).toThrow(/Node >= 22\.13/);
	});

	test('accepts supported Node', () => {
		expect(() => assertSupportedRuntime({ node: '22.13.0' })).not.toThrow();
		expect(() => assertSupportedRuntime({ node: '24.13.1' })).not.toThrow();
	});

	test('judges Bun by its own version, not the emulated Node version', () => {
		expect(() => assertSupportedRuntime({ node: '22.0.0', bun: '1.0.9' })).toThrow(/Bun >= 1\.1/);
		expect(() => assertSupportedRuntime({ node: '16.0.0', bun: '1.1.0' })).not.toThrow();
	});

	test('does not block unknown runtimes', () => {
		expect(() => assertSupportedRuntime({})).not.toThrow();
		expect(() => assertSupportedRuntime(undefined as never)).not.toThrow();
	});

	test('the current runtime is supported', () => {
		expect(() => assertSupportedRuntime()).not.toThrow();
	});
});
