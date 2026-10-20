/**
 * Connection bookkeeping shared by the persistent adapters (Telegram long-poll,
 * Discord, Slack): the state machine behind `health()` and the `connection`
 * event, so each adapter reports the same shape and none re-implements it.
 */

import type { AdapterContext, ConnectionHealth } from '../../adapter.js';
import type { PlatformId } from '../../schema.js';

type ConnectionState = ConnectionHealth['state'];

export class ConnectionTracker {
	state: ConnectionState = 'closed';
	reconnects = 0;
	private connectedSince: number | null = null;
	private lastConnectedAt: number | null = null;

	constructor(
		private readonly platform: PlatformId,
		private readonly account: string
	) {}

	/** Record a transition and announce it on the `connection` event. */
	set(ctx: AdapterContext, state: ConnectionState, detail?: string): void {
		this.state = state;
		if (state === 'open') {
			const now = Date.now();
			this.connectedSince = now;
			this.lastConnectedAt = now;
		} else {
			this.connectedSince = null;
		}
		ctx.events.connection({ platform: this.platform, account: this.account, state, detail, timestamp: new Date().toISOString() });
	}

	/** A recoverable drop: count it and report `connecting`. */
	reconnecting(ctx: AdapterContext, detail?: string): void {
		this.reconnects += 1;
		this.set(ctx, 'connecting', detail);
	}

	/** Snapshot for `health()`. Self-healing transports never go `terminal`. */
	health(): ConnectionHealth {
		return {
			platform: this.platform,
			account: this.account,
			state: this.state,
			connectedSince: this.connectedSince != null ? new Date(this.connectedSince).toISOString() : null,
			lastConnectedAt: this.lastConnectedAt != null ? new Date(this.lastConnectedAt).toISOString() : null,
			reconnects: this.reconnects,
			terminal: false
		};
	}
}
