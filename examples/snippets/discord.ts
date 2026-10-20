/**
 * Discord echo bot. Enable the Message Content Intent in the Developer Portal,
 * or message.content will be empty.
 *
 *   DISCORD_BOT_TOKEN=… bun examples/snippets/discord.ts
 */
import { ChatKit, text } from '@myrialabs/chatkit';
import { consoleLogger } from '@myrialabs/chatkit';
import { DiscordAdapter } from '@myrialabs/chatkit/adapters';

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) throw new Error('Set DISCORD_BOT_TOKEN');

const chat = new ChatKit({ logger: consoleLogger('info') });
chat.use(new DiscordAdapter({ token, account: 'bot:example' }));

chat.on('message', async (m) => {
	if (m.content.type === 'text') await chat.send({ to: m.address, content: text(`echo: ${m.content.text}`) });
});
chat.on('reaction', (m) => console.log('reaction', m.content));
chat.on('error', (e) => console.error('error', e.error.message));

await chat.start();
console.log('Connected. Message a channel the bot can see. Ctrl+C to stop.');
process.on('SIGINT', () => void chat.stop().then(() => process.exit(0)));
