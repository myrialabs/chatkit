import { test, expect, describe } from 'bun:test';
import { responseBytes } from './stream.js';

async function collect(source: AsyncIterable<Uint8Array>): Promise<number[]> {
	const out: number[] = [];
	for await (const chunk of source) out.push(...chunk);
	return out;
}

describe('responseBytes', () => {
	test('streams a Response body via the reader', async () => {
		// A real Response exposes a web ReadableStream body → the getReader path.
		const res = new Response(new Uint8Array([1, 2, 3, 4]));
		expect(await collect(responseBytes(res))).toEqual([1, 2, 3, 4]);
	});

	test('falls back to arrayBuffer when no body stream is present', async () => {
		let bufferCalls = 0;
		const fake = {
			body: null,
			arrayBuffer: async () => {
				bufferCalls++;
				return new Uint8Array([9, 8, 7]).buffer;
			}
		} as unknown as Response;
		expect(await collect(responseBytes(fake))).toEqual([9, 8, 7]);
		expect(bufferCalls).toBe(1);
	});
});
