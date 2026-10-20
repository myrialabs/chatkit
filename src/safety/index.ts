/**
 * The Baileys safety layer — mandatory, not optional.
 * It does not make an unofficial connection "safe"; it only lowers and slows the
 * probability of a ban by shaping outbound traffic to look human:
 *
 *   - a session window: an inbound message opens a 24h window in which replies are
 *     allowed without an explicit opt-in (mirrors WhatsApp's customer-service window);
 *   - human-like throttling: a low per-account rate ceiling + Gaussian jitter;
 *   - typing simulation & read receipts: the adapter "types" for a duration derived
 *     from the message before sending, and marks inbound messages read like a human;
 *   - warming guard: new numbers are rate-limited and (optionally) blocked from
 *     cold, business-initiated sends;
 *   - opt-in enforcement before business-initiated (out-of-session) messages;
 *   - reply-ratio awareness + optional per-day cap and active-hours window;
 *   - "account at risk" backoff: a halt that refuses sends until cleared;
 *   - reconnect backoff to avoid abnormal reconnect-loop patterns.
 *
 * The behavioural humanizers (session window, typing, read receipts, presence) are
 * ON by default; the hard limiters (per-day cap, active hours) are opt-in so they
 * never surprise a legitimate integration. Non-WhatsApp adapters get a no-op.
 */

import type { Logger } from '../logger.js';
import type { StateStore } from '../store/index.js';

/** Thrown when the safety layer refuses an outbound send. */
export class SafetyError extends Error {
	readonly reason: 'halted' | 'opt-in' | 'warming' | 'daily-cap' | 'quiet-hours';
	constructor(reason: SafetyError['reason'], message: string) {
		super(message);
		this.name = 'SafetyError';
		this.reason = reason;
	}
}

export interface SafetyOptions {
	/** Master switch. Default `true`. */
	enabled?: boolean;
	/** Steady-state ceiling, messages/second per account. Default `1`. */
	maxPerSecond?: number;
	/** Gaussian jitter (ms) added between sends: mean and standard deviation. */
	jitter?: { meanMs: number; stddevMs: number };
	/** Require recipients to be opted in before out-of-session sends. Default `true`. */
	requireOptIn?: boolean;
	/** How long an inbound message keeps a conversation "in session" (ms). Default 24h. */
	sessionWindowMs?: number;
	/** During warming, rate ceiling (msgs/sec). Default `0.2` (1 per 5s). */
	warmupMaxPerSecond?: number;
	/** Block cold (out-of-session) sends during the warming window. Default `true`. */
	blockColdDuringWarmup?: boolean;
	/** Warn once the inbound/outbound ratio drops below this (after a sample). Default `0.1`. */
	minReplyRatio?: number;
	/** Outbound count before the reply-ratio check activates. Default `20`. */
	replyRatioSample?: number;
	/**
	 * Escalate a sustained low reply-ratio into an automatic "account at risk" halt
	 * instead of a one-off warning. A low reply-ratio is the strongest spam signal
	 * WhatsApp weighs; halting protects the number, but it
	 * *stops sending*, so it stays opt-in to never surprise a legitimate integration.
	 * When enabled, the halt trips once the ratio is below `minReplyRatio` after
	 * `replyRatioSample` sends. Default `false`.
	 */
	haltOnLowReplyRatio?: boolean;
	/** Reconnect backoff bounds (ms). */
	backoff?: { baseMs: number; maxMs: number };
	/**
	 * Typing simulation: how long to "type" before a send, derived from the message.
	 * `enabled` on by default; the adapter shows a composing presence for the duration.
	 */
	typing?: { enabled?: boolean; perCharMs?: number; minMs?: number; maxMs?: number };
	/** Mark inbound messages as read (human-like). Default `true`. */
	readReceipts?: boolean;
	/** Manage online/offline presence rather than staying online 24/7. Default `true`. */
	managePresence?: boolean;
	/** Optional hard cap of sends per account per day (off by default). */
	maxPerDay?: number;
	/** Optional local active-hours window; sends outside it are refused (off by default). */
	activeHours?: { startHour: number; endHour: number };
}

type FullDefaults = Required<
	Omit<SafetyOptions, 'jitter' | 'backoff' | 'typing' | 'maxPerDay' | 'activeHours' | 'haltOnLowReplyRatio'>
> & { haltOnLowReplyRatio: boolean } & {
	jitter: { meanMs: number; stddevMs: number };
	backoff: { baseMs: number; maxMs: number };
	typing: Required<NonNullable<SafetyOptions['typing']>>;
	maxPerDay: number | null;
	activeHours: { startHour: number; endHour: number } | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULTS: FullDefaults = {
	enabled: true,
	maxPerSecond: 1,
	jitter: { meanMs: 350, stddevMs: 150 },
	requireOptIn: true,
	sessionWindowMs: DAY_MS,
	warmupMaxPerSecond: 0.2,
	blockColdDuringWarmup: true,
	minReplyRatio: 0.1,
	replyRatioSample: 20,
	haltOnLowReplyRatio: false,
	backoff: { baseMs: 1000, maxMs: 60_000 },
	typing: { enabled: true, perCharMs: 45, minMs: 600, maxMs: 5000 },
	readReceipts: true,
	managePresence: true,
	maxPerDay: null,
	activeHours: null
};

export interface SafetyStats {
	inbound: number;
	outbound: number;
	replyRatio: number;
	halted: boolean;
	warming: boolean;
	/** Sends counted in the current local day. */
	today: number;
}

/** Outbound gating context the adapter supplies. */
export interface GateInput {
	account: string;
	/** The recipient's native user id (for opt-in / session checks). */
	userId: string;
	/** True when this send quotes/replies to a recent inbound (lower risk). */
	isReply: boolean;
}

/** Behavioural humanizers the adapter should apply (typing, read receipts, presence). */
export interface Humanizers {
	typing: boolean;
	readReceipts: boolean;
	presence: boolean;
}

export interface SafetyController {
	gate(input: GateInput): Promise<void>;
	/**
	 * Open the session window for an inbound message. Both the sender's `userId` and
	 * the `conversationId` are recorded, because under WhatsApp LID these can differ
	 * and a send is gated on the conversation JID. The window is also persisted so it
	 * survives a restart (the 24h expiry still applies).
	 */
	recordInbound(account: string, userId?: string, conversationId?: string): void;
	flagAtRisk(account: string, reason?: string): void;
	clearRisk(account: string): void;
	isHalted(account: string): boolean;
	/**
	 * Put an account into a warming ramp until `until` (epoch ms; `null` clears it).
	 * `since` marks when warming began (defaults to now); the send rate is
	 * interpolated from `warmupMaxPerSecond` at `since` up to `maxPerSecond` at
	 * `until`, so a new number ramps up gradually rather than jumping to full speed.
	 */
	setWarmup(account: string, until: number | null, since?: number): void;
	backoffDelay(attempt: number): number;
	stats(account: string): SafetyStats;
	/** Milliseconds to "type" before sending `text` (0 when typing is disabled). */
	typingDurationFor(text: string): number;
	/** Which behavioural humanizers are enabled. */
	humanizers(): Humanizers;
}

interface AccountState {
	lastSendAt: number;
	inbound: number;
	outbound: number;
	halted: boolean;
	warmupUntil: number | null;
	/** When the current warming ramp began, for rate interpolation. */
	warmupSince: number | null;
	sessions: Map<string, number>;
	/** Inbound counter since the last session-map sweep (bounds the Map). */
	sweepTick: number;
	dayStart: number;
	dayCount: number;
}

/** Box–Muller Gaussian sample, clamped to ≥ 0. */
function gaussian(mean: number, stddev: number): number {
	let u = 0;
	let v = 0;
	while (u === 0) u = Math.random();
	while (v === 0) v = Math.random();
	const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
	return Math.max(0, mean + z * stddev);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Local start-of-day epoch ms for "today" bookkeeping. */
function startOfDay(now = Date.now()): number {
	const d = new Date(now);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

/** The real, default-on safety controller for Baileys. */
export class BaileysSafety implements SafetyController {
	private readonly opts: FullDefaults;
	private readonly store: StateStore;
	private readonly logger: Logger;
	private readonly accounts = new Map<string, AccountState>();

	constructor(store: StateStore, logger: Logger, options?: SafetyOptions) {
		this.store = store;
		this.logger = logger;
		this.opts = {
			...DEFAULTS,
			...options,
			jitter: { ...DEFAULTS.jitter, ...options?.jitter },
			backoff: { ...DEFAULTS.backoff, ...options?.backoff },
			typing: { ...DEFAULTS.typing, ...options?.typing },
			maxPerDay: options?.maxPerDay ?? DEFAULTS.maxPerDay,
			activeHours: options?.activeHours ?? DEFAULTS.activeHours
		};
	}

	private state(account: string): AccountState {
		let s = this.accounts.get(account);
		if (!s) {
			s = { lastSendAt: 0, inbound: 0, outbound: 0, halted: false, warmupUntil: null, warmupSince: null, sessions: new Map(), sweepTick: 0, dayStart: startOfDay(), dayCount: 0 };
			this.accounts.set(account, s);
		}
		return s;
	}

	/** Namespace under which per-account session timestamps are persisted. */
	private sessionNs(account: string): string {
		return `wa-session:${account}`;
	}

	/**
	 * Is `userId` inside its session window? Checks the in-memory cache first, then
	 * falls back to the persisted timestamp (so the window survives a restart). A
	 * fresh persisted hit is promoted into the cache.
	 */
	private async withinSession(s: AccountState, account: string, userId: string): Promise<boolean> {
		const cached = s.sessions.get(userId);
		if (cached != null) {
			const live = Date.now() - cached < this.opts.sessionWindowMs;
			// Evict on access: an expired window is dead weight in the Map — dropping it
			// here keeps the cache bounded to peers still inside their session window.
			if (!live) s.sessions.delete(userId);
			return live;
		}
		try {
			const raw = await this.store.kvGet(this.sessionNs(account), userId);
			if (raw != null) {
				const ts = Number(raw);
				if (Number.isFinite(ts)) {
					s.sessions.set(userId, ts);
					return Date.now() - ts < this.opts.sessionWindowMs;
				}
			}
		} catch {
			// Session persistence is best-effort; a store miss just means "cold".
		}
		return false;
	}

	private rollDay(s: AccountState): void {
		const today = startOfDay();
		if (today !== s.dayStart) {
			s.dayStart = today;
			s.dayCount = 0;
		}
	}

	async gate(input: GateInput): Promise<void> {
		if (!this.opts.enabled) return;
		const s = this.state(input.account);
		this.rollDay(s);

		if (s.halted) {
			throw new SafetyError('halted', `Account ${input.account} is halted ("account at risk"); sends are paused.`);
		}

		if (this.opts.activeHours) {
			const hour = new Date().getHours();
			const { startHour, endHour } = this.opts.activeHours;
			const active = startHour <= endHour ? hour >= startHour && hour < endHour : hour >= startHour || hour < endHour;
			if (!active) {
				throw new SafetyError('quiet-hours', `Account ${input.account} is outside its active hours (${startHour}:00–${endHour}:00).`);
			}
		}

		if (this.opts.maxPerDay != null && s.dayCount >= this.opts.maxPerDay) {
			throw new SafetyError('daily-cap', `Account ${input.account} hit its daily cap of ${this.opts.maxPerDay} messages.`);
		}

		// A message is "in session" if it quotes an inbound, or the recipient has
		// messaged us within the session window. Only truly cold sends need opt-in.
		const inSession = input.isReply || (await this.withinSession(s, input.account, input.userId));

		const warming = s.warmupUntil != null && Date.now() < s.warmupUntil;
		if (warming && this.opts.blockColdDuringWarmup && !inSession) {
			throw new SafetyError('warming', `Account ${input.account} is warming up; only replies / in-session messages are allowed, not cold sends.`);
		}

		if (this.opts.requireOptIn && !inSession) {
			const optedIn = await this.store.isOptedIn(input.account, input.userId);
			if (!optedIn) {
				throw new SafetyError('opt-in', `Recipient ${input.userId} is out of session and has not opted in for business-initiated messages on ${input.account}.`);
			}
		}

		// Throttle: enforce a minimum interval, then add Gaussian jitter. During warming
		// the rate ramps from `warmupMaxPerSecond` up to `maxPerSecond` across the window,
		// rather than jumping straight to full speed the moment warming starts.
		const rate = warming ? this.warmupRate(s) : this.opts.maxPerSecond;
		const minInterval = rate > 0 ? 1000 / rate : 0;
		const now = Date.now();
		const elapsed = now - s.lastSendAt;
		const wait = Math.max(0, minInterval - elapsed) + gaussian(this.opts.jitter.meanMs, this.opts.jitter.stddevMs);
		if (wait > 0) await sleep(wait);

		s.lastSendAt = Date.now();
		s.outbound += 1;
		s.dayCount += 1;
		this.checkReplyRatio(input.account, s);
	}

	/**
	 * The effective send rate (msgs/sec) during warming — a linear ramp from
	 * `warmupMaxPerSecond` at `warmupSince` to `maxPerSecond` at `warmupUntil`. Falls
	 * back to the flat warmup rate if the window has no known start/span.
	 */
	private warmupRate(s: AccountState): number {
		const until = s.warmupUntil;
		const since = s.warmupSince;
		if (until == null || since == null || until <= since) return this.opts.warmupMaxPerSecond;
		const frac = Math.min(1, Math.max(0, (Date.now() - since) / (until - since)));
		return this.opts.warmupMaxPerSecond + frac * (this.opts.maxPerSecond - this.opts.warmupMaxPerSecond);
	}

	private checkReplyRatio(account: string, s: AccountState): void {
		if (s.outbound < this.opts.replyRatioSample) return;
		const ratio = s.inbound / s.outbound;
		if (ratio >= this.opts.minReplyRatio) return;
		const detail = { account, inbound: s.inbound, outbound: s.outbound, ratio: Number(ratio.toFixed(3)) };
		if (this.opts.haltOnLowReplyRatio && !s.halted) {
			this.flagAtRisk(account, `low reply ratio ${detail.ratio} — auto-halt (strong spam signal)`);
			return;
		}
		this.logger.warn('Low reply ratio — strong spam signal; consider reply-driven sending only', detail);
	}

	/** Drop session entries whose 24h window has elapsed — keeps the Map bounded. */
	private pruneSessions(s: AccountState): void {
		const cutoff = Date.now() - this.opts.sessionWindowMs;
		for (const [id, ts] of s.sessions) {
			if (ts < cutoff) s.sessions.delete(id);
		}
	}

	recordInbound(account: string, userId?: string, conversationId?: string): void {
		const s = this.state(account);
		s.inbound += 1;
		// Sweep the session Map periodically so a long-lived, high-traffic account does
		// not accumulate one dead entry per peer it has ever heard from.
		if (++s.sweepTick >= 256) {
			s.sweepTick = 0;
			this.pruneSessions(s);
		}
		const now = Date.now();
		// Record both identifiers: under LID the sender JID (`userId`) and the chat JID
		// (`conversationId`, what a send is gated on) can differ for the same peer.
		const ids = new Set([userId, conversationId].filter((id): id is string => Boolean(id)));
		for (const id of ids) {
			s.sessions.set(id, now);
			// Write-through so the window survives a restart. Best-effort: the in-memory
			// cache already covers the live process, so a failed persist never blocks.
			void this.store.kvSet(this.sessionNs(account), id, String(now)).catch(() => {});
		}
	}

	flagAtRisk(account: string, reason?: string): void {
		this.state(account).halted = true;
		this.logger.error('Account flagged at risk — halting sends', { account, reason });
	}

	clearRisk(account: string): void {
		this.state(account).halted = false;
		this.logger.info('Account risk cleared — sends resumed', { account });
	}

	isHalted(account: string): boolean {
		return this.state(account).halted;
	}

	setWarmup(account: string, until: number | null, since?: number): void {
		const s = this.state(account);
		s.warmupUntil = until;
		s.warmupSince = until == null ? null : (since ?? Date.now());
	}

	/** Exponential backoff with full jitter, bounded by `backoff.maxMs`. */
	backoffDelay(attempt: number): number {
		const { baseMs, maxMs } = this.opts.backoff;
		const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
		return Math.round(Math.random() * exp);
	}

	typingDurationFor(text: string): number {
		if (!this.opts.typing.enabled) return 0;
		const { perCharMs, minMs, maxMs } = this.opts.typing;
		const base = Math.min(maxMs, Math.max(minMs, (text?.length ?? 0) * perCharMs));
		return Math.round(gaussian(base, base * 0.15));
	}

	humanizers(): Humanizers {
		return {
			typing: this.opts.typing.enabled,
			readReceipts: this.opts.readReceipts,
			presence: this.opts.managePresence
		};
	}

	stats(account: string): SafetyStats {
		const s = this.state(account);
		this.rollDay(s);
		return {
			inbound: s.inbound,
			outbound: s.outbound,
			replyRatio: s.outbound ? s.inbound / s.outbound : 0,
			halted: s.halted,
			warming: s.warmupUntil != null && Date.now() < s.warmupUntil,
			today: s.dayCount
		};
	}
}

/** A safety controller that does nothing — injected for non-WhatsApp adapters. */
export const noopSafety: SafetyController = {
	async gate() {},
	recordInbound() {},
	flagAtRisk() {},
	clearRisk() {},
	isHalted() {
		return false;
	},
	setWarmup() {},
	backoffDelay(attempt: number) {
		return Math.min(60_000, 1000 * 2 ** Math.max(0, attempt));
	},
	stats() {
		return { inbound: 0, outbound: 0, replyRatio: 0, halted: false, warming: false, today: 0 };
	},
	typingDurationFor() {
		return 0;
	},
	humanizers() {
		return { typing: false, readReceipts: false, presence: false };
	}
};
