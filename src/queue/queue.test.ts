import { test, expect, describe } from 'bun:test';
import { OutboundQueue, retryable } from './index.js';

describe('OutboundQueue', () => {
	test('runs tasks for a key strictly in order', async () => {
		const q = new OutboundQueue();
		const order: number[] = [];
		const tasks = [0, 1, 2, 3].map((i) =>
			q.run('acc', async () => {
				await new Promise((r) => setTimeout(r, (4 - i) * 5));
				order.push(i);
				return i;
			})
		);
		await Promise.all(tasks);
		expect(order).toEqual([0, 1, 2, 3]);
	});

	test('different keys run concurrently (isolation)', async () => {
		const q = new OutboundQueue();
		const started: string[] = [];
		const a = q.run('a', async () => {
			started.push('a');
			await new Promise((r) => setTimeout(r, 30));
		});
		const b = q.run('b', async () => {
			started.push('b');
		});
		await Promise.all([a, b]);
		expect(started).toContain('a');
		expect(started).toContain('b');
	});

	test('retries transient failures then succeeds', async () => {
		const q = new OutboundQueue({ retry: { baseMs: 1, retries: 3 } });
		let attempts = 0;
		const result = await q.run('acc', async () => {
			attempts++;
			if (attempts < 3) throw retryable(new Error('temporary'));
			return 'ok';
		});
		expect(result).toBe('ok');
		expect(attempts).toBe(3);
	});

	test('does not retry non-retryable errors', async () => {
		const q = new OutboundQueue({ retry: { baseMs: 1 } });
		let attempts = 0;
		await expect(
			q.run('acc', async () => {
				attempts++;
				throw new Error('permanent');
			})
		).rejects.toThrow('permanent');
		expect(attempts).toBe(1);
	});

	test('enforces a minimum interval (rate limit)', async () => {
		const q = new OutboundQueue();
		const times: number[] = [];
		await Promise.all(
			[0, 1, 2].map(() => q.run('acc', async () => times.push(Date.now()), { rate: { minIntervalMs: 25 } }))
		);
		expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(20);
		expect(times[2]! - times[1]!).toBeGreaterThanOrEqual(20);
	});

	test('drain waits for everything', async () => {
		const q = new OutboundQueue();
		let done = 0;
		for (let i = 0; i < 5; i++) {
			q.run('acc', async () => {
				await new Promise((r) => setTimeout(r, 5));
				done++;
			});
		}
		await q.drain();
		expect(q.totalPending()).toBe(0);
		expect(done).toBe(5);
	});
});
