/**
 * Telegram echo bot via long polling — the simplest full ChatKit loop.
 *
 *   TELEGRAM_BOT_TOKEN=123:abc bun examples/snippets/telegram.ts
 */
import { ChatKit, text, reply } from '@myrialabs/chatkit';
import { consoleLogger } from '@myrialabs/chatkit';
import { TelegramAdapter } from '@myrialabs/chatkit/adapters';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('Set TELEGRAM_BOT_TOKEN');

const chat = new ChatKit({ logger: consoleLogger('info') });
chat.use(new TelegramAdapter({ token, account: 'bot:example', polling: true }));

chat.on('message', async (m) => {
	console.log('inbound', m.from?.display_name, '→', m.content);
	if (m.content.type === 'text') {
		await chat.send(reply(m, text(`echo: ${m.content.text}`)));
	}
});
chat.on('error', (e) => console.error('error', e.error.message));

await chat.start();
console.log('Listening. Message your bot on Telegram. Ctrl+C to stop.');
process.on('SIGINT', () => void chat.stop().then(() => process.exit(0)));
