/**
 * Slack echo bot via Socket Mode (no public URL needed). For the Events API
 * webhook path, see examples/server/index.ts.
 *
 *   SLACK_BOT_TOKEN=xoxb-… SLACK_APP_TOKEN=xapp-… bun examples/snippets/slack.ts
 */
import { ChatKit, text } from '@myrialabs/chatkit';
import { consoleLogger } from '@myrialabs/chatkit';
import { SlackAdapter } from '@myrialabs/chatkit/adapters';

const botToken = process.env.SLACK_BOT_TOKEN;
const appToken = process.env.SLACK_APP_TOKEN;
if (!botToken || !appToken) throw new Error('Set SLACK_BOT_TOKEN and SLACK_APP_TOKEN');

const chat = new ChatKit({ logger: consoleLogger('info') });
chat.use(new SlackAdapter({ botToken, appToken, socketMode: true, account: 'workspace' }));

chat.on('message', async (m) => {
	if (m.content.type === 'text') await chat.send({ to: m.address, content: text(`echo: ${m.content.text}`) });
});
chat.on('error', (e) => console.error('error', e.error.message));

await chat.start();
console.log('Connected via Socket Mode. Message a channel the bot is in. Ctrl+C to stop.');
process.on('SIGINT', () => void chat.stop().then(() => process.exit(0)));
