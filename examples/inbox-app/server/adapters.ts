/**
 * Turns a saved channel config into a ChatKit adapter, and describes the fields
 * each platform needs so the UI can render an "add channel" form generically.
 */

import type { Adapter, PlatformId } from '@myrialabs/chatkit';
import { TelegramAdapter, WhatsAppBaileysAdapter, WhatsAppCloudAdapter, DiscordAdapter, SlackAdapter } from '@myrialabs/chatkit/adapters';

export interface FieldSpec {
	key: string;
	label: string;
	type: 'text' | 'password';
	required: boolean;
	placeholder?: string;
}

export interface PlatformSpec {
	platform: PlatformId;
	label: string;
	defaultAccount: string;
	accountLabel: string;
	accountPlaceholder: string;
	/** Needs a public webhook URL (shown to the user after adding). */
	webhook: boolean;
	note?: string;
	fields: FieldSpec[];
}

export const PLATFORM_SPECS: Record<PlatformId, PlatformSpec> = {
	telegram: {
		platform: 'telegram',
		label: 'Telegram',
		defaultAccount: 'bot',
		accountLabel: 'Connection name (optional)',
		accountPlaceholder: 'e.g. support-bot',
		webhook: false,
		note: 'Create a bot with @BotFather and paste its token below — the token identifies which bot this is. The connection name is just a label you choose (leave blank for a default). Runs in long-polling; no public URL needed.',
		fields: [{ key: 'token', label: 'Bot token (from @BotFather)', type: 'password', required: true, placeholder: '123456:ABC-DEF…' }]
	},
	whatsapp_baileys: {
		platform: 'whatsapp_baileys',
		label: 'WhatsApp (Baileys)',
		defaultAccount: 'wa:6281234567890',
		accountLabel: 'WhatsApp number (wa:E164) — required',
		accountPlaceholder: 'wa:6281234567890',
		webhook: false,
		note: 'Enter your number as wa:<country><number> (this IS the account, so it matters). Use a TEST number — Baileys is unofficial and carries a ban risk. A QR appears here to link the device; the status dot turns green once it connects.',
		fields: []
	},
	whatsapp_cloud: {
		platform: 'whatsapp_cloud',
		label: 'WhatsApp (Cloud API)',
		defaultAccount: 'wa:cloud',
		accountLabel: 'Connection name (optional)',
		accountPlaceholder: 'e.g. wa:cloud',
		webhook: true,
		note: 'Official Cloud API. Point your Meta app webhook at the URL shown after you add it.',
		fields: [
			{ key: 'phoneNumberId', label: 'Phone number id', type: 'text', required: true },
			{ key: 'token', label: 'Access token', type: 'password', required: true },
			{ key: 'appSecret', label: 'App secret', type: 'password', required: false },
			{ key: 'verifyToken', label: 'Verify token', type: 'text', required: false }
		]
	},
	discord: {
		platform: 'discord',
		label: 'Discord',
		defaultAccount: 'bot',
		accountLabel: 'Connection name (optional)',
		accountPlaceholder: 'e.g. bot',
		webhook: false,
		note: 'Enable the Message Content Intent on the bot, or inbound text is empty. The connection name is just a label you choose.',
		fields: [{ key: 'token', label: 'Bot token', type: 'password', required: true }]
	},
	slack: {
		platform: 'slack',
		label: 'Slack',
		defaultAccount: 'workspace',
		accountLabel: 'Connection name (optional)',
		accountPlaceholder: 'e.g. workspace',
		webhook: false,
		note: 'Set an App token (xapp-…) for Socket Mode (no public URL). A signing secret instead uses the Events API webhook. The connection name is just a label you choose.',
		fields: [
			{ key: 'botToken', label: 'Bot token (xoxb-…)', type: 'password', required: true },
			{ key: 'appToken', label: 'App token (xapp-…)', type: 'password', required: false },
			{ key: 'signingSecret', label: 'Signing secret', type: 'password', required: false }
		]
	}
};

export interface ChannelConfig {
	platform: PlatformId;
	account: string;
	creds: Record<string, string>;
}

const clean = (v?: string) => (v && v.trim() ? v.trim() : undefined);

/** Build a live adapter from a channel config. */
export function buildAdapter(cfg: ChannelConfig, onQR: (qr: string) => void): Adapter {
	const c = cfg.creds;
	switch (cfg.platform) {
		case 'telegram':
			return new TelegramAdapter({ token: c.token!, account: cfg.account, polling: true });
		case 'whatsapp_baileys':
			return new WhatsAppBaileysAdapter({ account: cfg.account, onQR });
		case 'whatsapp_cloud':
			return new WhatsAppCloudAdapter({
				account: cfg.account,
				phoneNumberId: c.phoneNumberId!,
				token: c.token!,
				appSecret: clean(c.appSecret),
				verifyToken: clean(c.verifyToken)
			});
		case 'discord':
			return new DiscordAdapter({ token: c.token!, account: cfg.account });
		case 'slack':
			return new SlackAdapter({
				botToken: c.botToken!,
				appToken: clean(c.appToken),
				signingSecret: clean(c.signingSecret),
				socketMode: Boolean(clean(c.appToken)),
				account: cfg.account
			});
	}
}
