/**
 * The in-process outbound dispatcher. No external broker (no Redis/BullMQ) — just
 * a per-key serial chain that guarantees ordering, enforces a per-key rate limit,
 * and retries transient failures with exponential backoff + jitter. One key = one platform/account, so a slow or
 * failing account never blocks its neighbours.
 */

export interface RetryPolicy {
	/** Max retry attempts after the first try. Default `3`. */
	retries: number;
	/** Base backoff in ms. Default `500`. */
	baseMs: number;
	/** Backoff ceiling in ms. Default `30000`. */
	maxMs: number;
	/** Classify an error as retryable. Default: only when `err.retryable === true`. */
	isRetryable: (error: unknown) => boolean;
}

export interface RateLimit {
	/** Maximum sends per second for this key. */
	perSecond?: number;
	/** Explicit minimum interval between sends (overrides `perSecond`). */
	minIntervalMs?: number;
}

export const DEFAULT_RETRY: RetryPolicy = {
	retries: 3,
	baseMs: 500,
	maxMs: 30_000,
	isRetryable: (error) => (error as { retryable?: boolean } | null)?.retryable === true
};

/** Mark an error as a transient failure the dispatcher should retry. */
export function retryable<E extends Error>(error: E): E {
	(error as E & { retryable?: boolean }).retryable = true;
	return error;
}

interface KeyState {
	tail: Promise<unknown>;
	lastRunAt: number;
	pending: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface OutboundQueueOptions {
	retry?: Partial<RetryPolicy>;
	/** Default rate limit applied to every key unless overridden per call. */
	defaultRate?: RateLimit;
}

export class OutboundQueue {
	private readonly retry: RetryPolicy;
	private readonly defaultRate?: RateLimit;
	private readonly keys = new Map<string, KeyState>();

	constructor(options?: OutboundQueueOptions) {
		this.retry = { ...DEFAULT_RETRY, ...options?.retry };
		this.defaultRate = options?.defaultRate;
	}

	private minInterval(rate?: RateLimit): number {
		const r = rate ?? this.defaultRate;
		if (!r) return 0;
		if (r.minIntervalMs != null) return r.minIntervalMs;
		if (r.perSecond != null && r.perSecond > 0) return 1000 / r.perSecond;
		return 0;
	}

	/**
	 * Run `fn` on the serial chain for `key`. Calls for the same key run strictly
	 * in enqueue order, spaced by the rate limit, each retried per policy.
	 */
	run<T>(key: string, fn: () => Promise<T>, opts?: { rate?: RateLimit; retry?: Partial<RetryPolicy> }): Promise<T> {
		const state = this.keys.get(key) ?? { tail: Promise.resolve(), lastRunAt: 0, pending: 0 };
		this.keys.set(key, state);
		state.pending += 1;

		const policy: RetryPolicy = { ...this.retry, ...opts?.retry };
		const minInterval = this.minInterval(opts?.rate);

		const result = state.tail.then(async () => {
			const wait = Math.max(0, minInterval - (Date.now() - state.lastRunAt));
			if (wait > 0) await sleep(wait);
			try {
				return await this.attempt(fn, policy);
			} finally {
				state.lastRunAt = Date.now();
				state.pending -= 1;
			}
		});

		// Keep the chain alive regardless of this task's success/failure.
		state.tail = result.then(
			() => undefined,
			() => undefined
		);
		return result;
	}

	private async attempt<T>(fn: () => Promise<T>, policy: RetryPolicy): Promise<T> {
		let lastError: unknown;
		for (let attempt = 0; attempt <= policy.retries; attempt++) {
			try {
				return await fn();
			} catch (error) {
				lastError = error;
				if (attempt === policy.retries || !policy.isRetryable(error)) break;
				const exp = Math.min(policy.maxMs, policy.baseMs * 2 ** attempt);
				await sleep(Math.round(Math.random() * exp));
			}
		}
		throw lastError;
	}

	/** Number of queued/in-flight tasks for a key. */
	size(key: string): number {
		return this.keys.get(key)?.pending ?? 0;
	}

	/** Total queued/in-flight tasks across all keys. */
	totalPending(): number {
		let total = 0;
		for (const s of this.keys.values()) total += s.pending;
		return total;
	}

	/** Wait for every currently-enqueued task across all keys to settle. */
	async drain(): Promise<void> {
		await Promise.allSettled([...this.keys.values()].map((s) => s.tail));
		// A drained task may have enqueued more; loop until quiet.
		if (this.totalPending() > 0) await this.drain();
	}
}
