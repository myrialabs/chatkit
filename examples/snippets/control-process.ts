/**
 * Generic example: control a process from chat.
 *
 * ChatKit's honest core is a reliable two-way pipe for text + media with a stable
 * conversation identity. That makes it a transport for anything — a CS bot, an
 * automation, or (here) a system that drives a child process from chat. This is
 * deliberately vendor-neutral: it spawns a configurable COMMAND per conversation,
 * forwards inbound text to its stdin, and streams stdout/stderr back as messages.
 *
 *   COMMAND="cat" TELEGRAM_BOT_TOKEN=… bun examples/snippets/control-process.ts
 *
 * Swap the TelegramAdapter for any other adapter — the rest is unchanged.
 *
 * ⚠️ Spawning processes from inbound messages is powerful. Gate it behind your own
 * authorization: map (platform, account, user_id) to an identity you trust before
 * wiring a conversation to a process. ChatKit gives you the identity; the policy
 * is yours.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { ChatKit, text, splitMessage, TEXT_LIMITS, conversationKey } from '@myrialabs/chatkit';
import { consoleLogger } from '@myrialabs/chatkit';
import { TelegramAdapter } from '@myrialabs/chatkit/adapters';
import type { Address, UniversalMessage } from '@myrialabs/chatkit';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('Set TELEGRAM_BOT_TOKEN (or adapt this to another adapter)');
const command = process.env.COMMAND ?? 'cat';

const chat = new ChatKit({ logger: consoleLogger('info') });
chat.use(new TelegramAdapter({ token, account: 'bot:control', polling: true }));

/** One child process per conversation, spawned lazily. */
const sessions = new Map<string, ChildProcessWithoutNullStreams>();

function sessionFor(address: Address): ChildProcessWithoutNullStreams {
	const key = conversationKey(address);
	let child = sessions.get(key);
	if (child && !child.killed) return child;

	const [cmd, ...args] = command.split(' ');
	child = spawn(cmd!, args, { stdio: ['pipe', 'pipe', 'pipe'] });
	sessions.set(key, child);

	const stream = (chunk: Buffer) => {
		const out = chunk.toString('utf8').trimEnd();
		if (!out) return;
		for (const part of splitMessage(out, { limit: TEXT_LIMITS.telegram })) {
			void chat.send({ to: address, content: text(part) }).catch((e) => console.error('send failed', e));
		}
	};
	child.stdout.on('data', stream);
	child.stderr.on('data', stream);
	child.on('exit', (code) => {
		sessions.delete(key);
		void chat.send({ to: address, content: text(`[process exited: ${code}]`) });
	});
	return child;
}

chat.on('message', (m: UniversalMessage) => {
	if (m.content.type !== 'text') return;
	// AUTHORIZE HERE: decide if m.from is allowed to drive a process.
	const child = sessionFor(m.address);
	child.stdin.write(m.content.text + '\n');
});
chat.on('error', (e) => console.error('error', e.error.message));

await chat.start();
console.log(`Driving "${command}" from chat. Each conversation gets its own process. Ctrl+C to stop.`);
process.on('SIGINT', () => {
	for (const child of sessions.values()) child.kill();
	void chat.stop().then(() => process.exit(0));
});
