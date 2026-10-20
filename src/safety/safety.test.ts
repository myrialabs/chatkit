import { test, expect, describe } from 'bun:test';
import { BaileysSafety, SafetyError, noopSafety } from './index.js';
import { MemoryStateStore } from '../store/index.js';
import { noopLogger } from '../logger.js';

function make(opts?: ConstructorParameters<typeof BaileysSafety>[2]) {
	return new BaileysSafety(new MemoryStateStore(), noopLogger, opts);
}

describe('BaileysSafety', () => {
	test('throttles consecutive sends (Gaussian jitter + min interval)', async () => {
		const safety = make({ maxPerSecond: 50, requireOptIn: false, jitter: { meanMs: 0, stddevMs: 0 } });
		const t0 = Date.now();
		await safety.gate({ account: 'wa:1', userId: 'u', isReply: true });
		await safety.gate({ account: 'wa:1', userId: 'u', isReply: true });
		expect(Date.now() - t0).toBeGreaterThanOrEqual(15);
	});

	test('enforces opt-in for cold (non-reply) sends', async () => {
		const store = new MemoryStateStore();
		const safety = new BaileysSafety(store, noopLogger, { requireOptIn: true, maxPerSecond: 1000, jitter: { meanMs: 0, stddevMs: 0 } });
		await expect(safety.gate({ account: 'wa:1', userId: 'u', isReply: false })).rejects.toThrow(SafetyError);
		await store.setOptIn('wa:1', 'u', true);
		await expect(safety.gate({ account: 'wa:1', userId: 'u', isReply: false })).resolves.toBeUndefined();
		// Replies are always allowed.
		await expect(safety.gate({ account: 'wa:1', userId: 'v', isReply: true })).resolves.toBeUndefined();
	});

	test('an inbound opens a session that allows non-reply sends', async () => {
		const safety = make({ requireOptIn: true, maxPerSecond: 1000, jitter: { meanMs: 0, stddevMs: 0 } });
		await expect(safety.gate({ account: 'wa:1', userId: 'u', isReply: false })).rejects.toThrow(SafetyError);
		safety.recordInbound('wa:1', 'u'); // user messaged us → session opens
		await expect(safety.gate({ account: 'wa:1', userId: 'u', isReply: false })).resolves.toBeUndefined();
		await expect(safety.gate({ account: 'wa:1', userId: 'other', isReply: false })).rejects.toThrow(SafetyError);
	});

	test('a session survives a restart (persisted 24h window)', async () => {
		const store = new MemoryStateStore();
		const opts = { requireOptIn: true, maxPerSecond: 1000, jitter: { meanMs: 0, stddevMs: 0 } };
		const first = new BaileysSafety(store, noopLogger, opts);
		first.recordInbound('wa:1', 'u');
		await Promise.resolve(); // let the write-through persist settle
		// A fresh controller (as after a process restart) shares only the store.
		const restarted = new BaileysSafety(store, noopLogger, opts);
		await expect(restarted.gate({ account: 'wa:1', userId: 'u', isReply: false })).resolves.toBeUndefined();
	});

	test('an inbound opens the window under the conversation JID (LID resilience)', async () => {
		const safety = make({ requireOptIn: true, maxPerSecond: 1000, jitter: { meanMs: 0, stddevMs: 0 } });
		// Sender JID and chat JID differ (LID): the send is gated on the conversation JID.
		safety.recordInbound('wa:1', '628@s.whatsapp.net', '53433@lid');
		await expect(safety.gate({ account: 'wa:1', userId: '53433@lid', isReply: false })).resolves.toBeUndefined();
	});

	test('typing duration scales with text and is zero when disabled', () => {
		const on = make({ typing: { enabled: true, perCharMs: 50, minMs: 100, maxMs: 3000 } });
		expect(on.typingDurationFor('x'.repeat(100))).toBeGreaterThan(0);
		expect(on.humanizers().typing).toBe(true);
		expect(make({ typing: { enabled: false } }).typingDurationFor('hello')).toBe(0);
	});

	test('daily cap refuses sends past the limit', async () => {
		const safety = make({ requireOptIn: false, maxPerSecond: 1000, jitter: { meanMs: 0, stddevMs: 0 }, maxPerDay: 2 });
		await safety.gate({ account: 'wa:1', userId: 'u', isReply: true });
		await safety.gate({ account: 'wa:1', userId: 'u', isReply: true });
		await expect(safety.gate({ account: 'wa:1', userId: 'u', isReply: true })).rejects.toThrow('daily cap');
	});

	test('halt blocks all sends until cleared', async () => {
		const safety = make({ requireOptIn: false, maxPerSecond: 1000, jitter: { meanMs: 0, stddevMs: 0 } });
		safety.flagAtRisk('wa:1', 'account at risk');
		expect(safety.isHalted('wa:1')).toBe(true);
		await expect(safety.gate({ account: 'wa:1', userId: 'u', isReply: true })).rejects.toThrow('halted');
		safety.clearRisk('wa:1');
		await expect(safety.gate({ account: 'wa:1', userId: 'u', isReply: true })).resolves.toBeUndefined();
	});

	test('warming blocks cold sends but allows replies', async () => {
		const safety = make({ requireOptIn: false, blockColdDuringWarmup: true, warmupMaxPerSecond: 1000, jitter: { meanMs: 0, stddevMs: 0 } });
		safety.setWarmup('wa:1', Date.now() + 60_000);
		await expect(safety.gate({ account: 'wa:1', userId: 'u', isReply: false })).rejects.toThrow('warming');
		await expect(safety.gate({ account: 'wa:1', userId: 'u', isReply: true })).resolves.toBeUndefined();
	});

	test('reply ratio reflected in stats', async () => {
		const safety = make({ requireOptIn: false, maxPerSecond: 1000, jitter: { meanMs: 0, stddevMs: 0 } });
		safety.recordInbound('wa:1');
		await safety.gate({ account: 'wa:1', userId: 'u', isReply: true });
		await safety.gate({ account: 'wa:1', userId: 'u', isReply: true });
		const s = safety.stats('wa:1');
		expect(s.outbound).toBe(2);
		expect(s.inbound).toBe(1);
		expect(s.replyRatio).toBeCloseTo(0.5);
	});

	test('warming ramps the send rate from the warmup ceiling toward steady state', async () => {
		const opts = { requireOptIn: false, jitter: { meanMs: 0, stddevMs: 0 }, maxPerSecond: 1000, warmupMaxPerSecond: 10 };
		// A just-started warmup (frac ~0) sends at the slow warmup ceiling (~100ms interval).
		const fresh = make(opts);
		fresh.setWarmup('wa:1', Date.now() + 60_000, Date.now());
		await fresh.gate({ account: 'wa:1', userId: 'u', isReply: true });
		const t0 = Date.now();
		await fresh.gate({ account: 'wa:1', userId: 'u', isReply: true });
		expect(Date.now() - t0).toBeGreaterThanOrEqual(80);

		// A mostly-elapsed warmup (frac ~1) has ramped up to near steady state — fast.
		const warm = make(opts);
		warm.setWarmup('wa:1', Date.now() + 60_000, Date.now() - 600_000);
		await warm.gate({ account: 'wa:1', userId: 'u', isReply: true });
		const t1 = Date.now();
		await warm.gate({ account: 'wa:1', userId: 'u', isReply: true });
		expect(Date.now() - t1).toBeLessThan(60);
	});

	test('auto-halts on a catastrophic reply ratio when opted in', async () => {
		const safety = make({
			requireOptIn: false,
			maxPerSecond: 1000,
			jitter: { meanMs: 0, stddevMs: 0 },
			haltOnLowReplyRatio: true,
			replyRatioSample: 3,
			minReplyRatio: 0.5
		});
		// 3 outbound, 0 inbound → ratio 0 < 0.5 once the sample is reached → auto-halt.
		for (let i = 0; i < 3; i++) await safety.gate({ account: 'wa:1', userId: 'u', isReply: true });
		expect(safety.isHalted('wa:1')).toBe(true);
		await expect(safety.gate({ account: 'wa:1', userId: 'u', isReply: true })).rejects.toThrow('halted');
	});

	test('an expired session no longer grants a cold send (eviction)', async () => {
		const safety = make({ requireOptIn: true, maxPerSecond: 1000, jitter: { meanMs: 0, stddevMs: 0 }, sessionWindowMs: 20 });
		safety.recordInbound('wa:1', 'u');
		await expect(safety.gate({ account: 'wa:1', userId: 'u', isReply: false })).resolves.toBeUndefined();
		await new Promise((r) => setTimeout(r, 40));
		await expect(safety.gate({ account: 'wa:1', userId: 'u', isReply: false })).rejects.toThrow(SafetyError);
	});

	test('backoff grows and is bounded', () => {
		const safety = make({ backoff: { baseMs: 100, maxMs: 1000 } });
		for (let i = 0; i < 20; i++) expect(safety.backoffDelay(i)).toBeLessThanOrEqual(1000);
	});
});

describe('noopSafety', () => {
	test('never blocks', async () => {
		await expect(noopSafety.gate({ account: 'x', userId: 'y', isReply: false })).resolves.toBeUndefined();
		expect(noopSafety.isHalted('x')).toBe(false);
	});
});
