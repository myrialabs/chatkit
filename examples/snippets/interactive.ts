/**
 * Interactive buttons + rich text on Telegram, and handling the press. Rich controls
 * are built with per-platform typed helpers (the `/interactive` subpath); formatted
 * text uses the universal `richText`/`rt` builders. The press comes back as a
 * universal `postback` message so your handler stays platform-agnostic.
 *
 *   TELEGRAM_BOT_TOKEN=123:abc bun examples/snippets/interactive.ts
 */
import { ChatKit, reply, richText, rt } from '@myrialabs/chatkit';
import { consoleLogger } from '@myrialabs/chatkit';
import { telegramButtons } from '@myrialabs/chatkit/interactive';
import { TelegramAdapter } from '@myrialabs/chatkit/adapters';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('Set TELEGRAM_BOT_TOKEN');

const chat = new ChatKit({ logger: consoleLogger('info') });
chat.use(new TelegramAdapter({ token, account: 'bot', polling: true }));

chat.on('message', async (m) => {
	if (m.content.type === 'text') {
		// Offer two buttons; `data` is echoed back as a postback when tapped.
		await chat.send({
			to: m.address,
			...telegramButtons('Do you like ChatKit?', [
				[
					{ text: '👍 Yes', data: 'like' },
					{ text: '👎 No', data: 'dislike' }
				]
			])
		});
	} else if (m.content.type === 'postback') {
		// Reply with formatted text — bold + a link, rendered natively per platform.
		const answer =
			m.content.data === 'like'
				? richText([rt.bold('Glad to hear it!'), rt.plain(' 🎉 ')])
				: richText([rt.plain('We will do better. 🙏 '), rt.link('Tell us more', 'https://x.io')]);
		await chat.send(reply(m, answer));
	}
});
chat.on('error', (e) => console.error('error', e.error.message));

await chat.start();
console.log('Listening. Message your bot, then tap a button. Ctrl+C to stop.');
process.on('SIGINT', () => void chat.stop().then(() => process.exit(0)));
