/**
 * Channel manager: the glue between the UI, the encrypted account store, and
 * ChatKit's runtime `add()`/`remove()`. Adding a channel builds an adapter, tries
 * to start it, and only persists (encrypted) if it started; removing stops and
 * forgets it. On boot, every saved channel is decrypted and started.
 */

import { newId, type ChatKit, type PlatformId } from '@myrialabs/chatkit';
import type { SecretCodec } from '@myrialabs/chatkit/store';
import QRCode from 'qrcode';
import { InboxDb, type PublicAccountRow } from './db';
import { buildAdapter, PLATFORM_SPECS, type PlatformSpec } from './adapters';
import { broadcast } from './events';
import { getStatus, clearStatus, type ConnState } from './status';

export interface AddChannelInput {
	platform: PlatformId;
	account?: string;
	label?: string;
	creds?: Record<string, string>;
}

export interface PublicAccount extends PublicAccountRow {
	connected: boolean;
	state: ConnState | 'unknown';
	webhookPath?: string;
}

export class AccountManager {
	constructor(
		private readonly chat: ChatKit,
		private readonly db: InboxDb,
		private readonly codec: SecretCodec
	) {}

	private onQR(account: string): (qr: string) => void {
		return async (qr: string) => {
			try {
				const dataUrl = await QRCode.toDataURL(qr);
				broadcast('qr', { account, dataUrl });
			} catch {
				/* ignore render failure */
			}
		};
	}

	/**
	 * Decrypt and start every saved channel. Two failure modes, handled apart:
	 *
	 * - **Undecryptable secret** — the master key that encrypted this row is gone
	 *   (`.inbox-key` was deleted/regenerated). The credentials are unrecoverable,
	 *   so the row is pruned and the UI told to re-add it, instead of crashing the
	 *   boot on a cryptic `Unsupported state...` crypto error.
	 * - **Start failure** — creds decrypt fine but the adapter couldn't connect
	 *   (network, bad token, etc.). The row is kept for a later retry.
	 */
	async loadOnBoot(): Promise<void> {
		for (const row of this.db.allAccounts()) {
			let creds: Record<string, string>;
			try {
				creds = JSON.parse(this.codec.decryptString(row.secret)) as Record<string, string>;
			} catch {
				this.db.deleteAccount(row.id);
				clearStatus(row.platform, row.account);
				broadcast('account-removed', { id: row.id, platform: row.platform, account: row.account, reason: 'key-mismatch' });
				console.warn(
					`[accounts] dropped ${row.platform}:${row.account} — its stored credentials can no longer be ` +
						`decrypted (the master key in .inbox-key changed or was lost). Re-add this channel from the UI.`
				);
				continue;
			}
			try {
				const adapter = buildAdapter({ platform: row.platform as PlatformId, account: row.account, creds }, this.onQR(row.account));
				await this.chat.add(adapter);
			} catch (error) {
				console.error('[accounts] failed to start', row.platform, row.account, (error as Error).message);
			}
		}
	}

	list(): PublicAccount[] {
		return this.db.listAccounts().map((r) => this.decorate(r));
	}

	async add(input: AddChannelInput): Promise<PublicAccount> {
		const spec: PlatformSpec | undefined = PLATFORM_SPECS[input.platform];
		if (!spec) throw new Error(`Unknown platform: ${input.platform}`);
		const account = input.account?.trim() || spec.defaultAccount;
		const creds = input.creds ?? {};
		for (const f of spec.fields) {
			if (f.required && !creds[f.key]?.trim()) throw new Error(`Missing required field: ${f.label}`);
		}

		// Build + start first; only persist if the adapter came up.
		const adapter = buildAdapter({ platform: input.platform, account, creds }, this.onQR(account));
		await this.chat.add(adapter);

		const row = {
			id: newId(),
			platform: input.platform,
			account,
			label: input.label?.trim() || spec.label,
			secret: this.codec.encrypt(JSON.stringify(creds)),
			created_at: new Date().toISOString()
		};
		this.db.insertAccount(row);
		const { secret, ...pub } = row;
		void secret;
		return this.decorate(pub);
	}

	async remove(id: string): Promise<boolean> {
		const row = this.db.getAccount(id);
		if (!row) return false;
		await this.chat.remove(row.platform as PlatformId, row.account);
		clearStatus(row.platform, row.account);
		this.db.deleteAccount(id);
		return true;
	}

	private decorate(r: PublicAccountRow): PublicAccount {
		const spec = PLATFORM_SPECS[r.platform as PlatformId];
		const state = getStatus(r.platform, r.account) ?? (this.chat.adapterFor(r.platform as PlatformId, r.account) ? 'connecting' : 'unknown');
		return {
			...r,
			state,
			connected: state === 'open',
			webhookPath: spec?.webhook ? `/webhook/${r.id}` : undefined
		};
	}
}
