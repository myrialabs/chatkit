#!/usr/bin/env node

/**
 * chatkit CLI — a thin command line over the library for operational tasks:
 *
 *   chatkit pair --account wa:62...           Pair a WhatsApp (Baileys) number via QR
 *   chatkit send --platform telegram --token T --to ID --text "hi"
 *   chatkit capabilities <platform>           Print a platform's capability descriptor
 *   chatkit version | help
 *
 * The CLI is the only place ChatKit writes to the terminal; the library core is
 * silent (diagnostics flow through an injected Logger).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChatKit } from './chatkit.js';
import { assertSupportedRuntime } from './runtime.js';
import { consoleLogger } from './logger.js';
import { text } from './envelope.js';
import { SqliteStore } from './store/sqlite.js';
import { TelegramAdapter } from './adapters/telegram.js';
import { WhatsAppBaileysAdapter } from './adapters/whatsapp.js';
import { WhatsAppCloudAdapter } from './adapters/whatsapp-cloud.js';
import { DiscordAdapter } from './adapters/discord.js';
import { SlackAdapter } from './adapters/slack.js';
import type { Adapter } from './adapter.js';
import type { PlatformId } from './schema.js';

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const c = { bold: wrap('1'), dim: wrap('2'), red: wrap('31'), green: wrap('32'), cyan: wrap('36'), accent: wrap('35') };
const out = (s = '') => process.stdout.write(s + '\n');
const err = (s = '') => process.stderr.write(s + '\n');

function fail(message: string): never {
	err(c.red(message));
	err(c.dim('Run `chatkit help` for usage.'));
	process.exit(1);
}

function readVersion(): string {
	try {
		const here = dirname(fileURLToPath(import.meta.url));
		return JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')).version ?? '0.0.0';
	} catch {
		return '0.0.0';
	}
}

function parseArgs(argv: string[]): { positional: string[]; flags: Record<string, string | boolean> } {
	const positional: string[] = [];
	const flags: Record<string, string | boolean> = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]!;
		if (a.startsWith('--')) {
			const key = a.slice(2);
			const next = argv[i + 1];
			if (next && !next.startsWith('-')) {
				flags[key] = next;
				i++;
			} else {
				flags[key] = true;
			}
		} else if (a.startsWith('-') && a.length === 2) {
			const next = argv[i + 1];
			if (next && !next.startsWith('-')) {
				flags[a.slice(1)] = next;
				i++;
			} else {
				flags[a.slice(1)] = true;
			}
		} else {
			positional.push(a);
		}
	}
	return { positional, flags };
}

function usage(): void {
	out(c.bold('chatkit') + c.dim(` v${readVersion()}`));
	out('Unified messaging across Telegram, WhatsApp, Discord and Slack.\n');
	out(c.bold('Usage'));
	out('  chatkit pair --account wa:62...   [--db chatkit.db] [--state-key KEY]');
	out('  chatkit send --platform telegram --token T --to ID --text "hello"');
	out('  chatkit capabilities <platform>');
	out('  chatkit version | help\n');
	out(c.bold('Platforms') + ': telegram, whatsapp_baileys, whatsapp_cloud, discord, slack');
}

function capabilitiesCmd(platform: string): void {
	const dummy: Record<PlatformId, () => Adapter> = {
		telegram: () => new TelegramAdapter({ token: 'x' }),
		whatsapp_baileys: () => new WhatsAppBaileysAdapter({ account: 'x' }),
		whatsapp_cloud: () => new WhatsAppCloudAdapter({ account: 'x', phoneNumberId: 'x', token: 'x' }),
		discord: () => new DiscordAdapter({ token: 'x' }),
		slack: () => new SlackAdapter({ botToken: 'x' })
	};
	const make = dummy[platform as PlatformId];
	if (!make) fail(`Unknown platform: ${platform}`);
	out(JSON.stringify(make().capabilities(), null, 2));
}

async function pairCmd(flags: Record<string, string | boolean>): Promise<void> {
	const account = String(flags.account ?? '');
	if (!account) fail('pair requires --account (e.g. wa:6281234567890)');
	const stateKey = flags['state-key'] ? String(flags['state-key']) : process.env.CHATKIT_STATE_KEY;
	if (!stateKey) fail('pair requires a state key (--state-key or CHATKIT_STATE_KEY) to encrypt auth state.');

	const store = new SqliteStore({ path: flags.db ? String(flags.db) : './chatkit.db', stateKey });
	const chat = new ChatKit({ store, logger: consoleLogger('info') });
	let printQR: ((s: string, o: { small: boolean }) => void) | null = null;
	try {
		// Keep `generate` bound to its module — it reads `this.error` for the
		// error-correction level, so a detached reference renders a broken QR.
		const qr = (await import('qrcode-terminal' as string)).default;
		printQR = qr ? (s, o) => qr.generate(s, o) : null;
	} catch {
		printQR = null;
	}

	const adapter = new WhatsAppBaileysAdapter({
		account,
		onQR: (qr) => {
			out(c.cyan('\nScan this QR with WhatsApp → Linked Devices (use a TEST number):\n'));
			if (printQR) printQR(qr, { small: true });
			else out(qr);
		}
	});
	chat.use(adapter);
	chat.on('message', (m) => out(c.green('inbound ') + JSON.stringify(m.content)));
	chat.on('error', (e) => err(c.red('error ') + (e.error?.message ?? String(e))));

	out(c.dim(`Pairing ${account}. Press Ctrl+C to stop.`));
	await chat.start();
	process.on('SIGINT', () => {
		out('\nStopping…');
		void chat.stop().then(() => process.exit(0));
	});
	await new Promise(() => {}); // keep alive
}

async function sendCmd(flags: Record<string, string | boolean>): Promise<void> {
	const platform = String(flags.platform ?? '');
	const to = String(flags.to ?? '');
	const body = String(flags.text ?? '');
	if (platform !== 'telegram') fail('send currently supports --platform telegram only.');
	if (!flags.token || !to || !body) fail('send requires --token, --to and --text.');

	const chat = new ChatKit({ logger: consoleLogger('warn') });
	const adapter = new TelegramAdapter({ token: String(flags.token), account: String(flags.account ?? 'bot') });
	chat.use(adapter);
	const res = await chat.send({
		to: { platform: 'telegram', account: adapter.account, conversation_id: to },
		content: text(body)
	});
	out(c.green('sent ') + JSON.stringify(res));
	await chat.stop();
}

async function main(): Promise<void> {
	assertSupportedRuntime();
	const { positional, flags } = parseArgs(process.argv.slice(2));
	const command = positional[0] ?? 'help';
	switch (command) {
		case 'help':
		case '--help':
		case '-h':
			usage();
			break;
		case 'version':
		case '--version':
		case '-v':
			out(readVersion());
			break;
		case 'capabilities':
			capabilitiesCmd(positional[1] ?? '');
			break;
		case 'pair':
			await pairCmd(flags);
			break;
		case 'send':
			await sendCmd(flags);
			break;
		default:
			fail(`Unknown command: ${command}`);
	}
}

main().catch((e) => {
	err(c.red(String(e?.stack ?? e)));
	process.exit(1);
});
