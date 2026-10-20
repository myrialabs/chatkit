/**
 * WhatsApp Cloud API echo bot over a webhook server (Bun.serve). Point your
 * Meta app's webhook at https://<public-url>/webhook/whatsapp (use a tunnel for
 * local dev) with the same verify token.
 *
 *   WA_CLOUD_PHONE_NUMBER_ID=… WA_CLOUD_TOKEN=… WA_CLOUD_VERIFY_TOKEN=… \
 *   WA_CLOUD_APP_SECRET=… bun examples/snippets/whatsapp-cloud.ts
 */
import { ChatKit, text } from '@myrialabs/chatkit';
import { consoleLogger } from '@myrialabs/chatkit';
import { WhatsAppCloudAdapter } from '@myrialabs/chatkit/adapters';
import { processWebhook } from '@myrialabs/chatkit/middleware';

const phoneNumberId = process.env.WA_CLOUD_PHONE_NUMBER_ID;
const token = process.env.WA_CLOUD_TOKEN;
if (!phoneNumberId || !token) throw new Error('Set WA_CLOUD_PHONE_NUMBER_ID and WA_CLOUD_TOKEN');

const account = 'wa:cloud';
const chat = new ChatKit({ logger: consoleLogger('info') });
chat.use(
	new WhatsAppCloudAdapter({
		account,
		phoneNumberId,
		token,
		appSecret: process.env.WA_CLOUD_APP_SECRET,
		verifyToken: process.env.WA_CLOUD_VERIFY_TOKEN
	})
);

chat.on('message', async (m) => {
	if (m.content.type === 'text') await chat.send({ to: m.address, content: text(`echo: ${m.content.text}`) });
});
chat.on('status', (s) => console.log('status', s.platform_message_id, s.status));

const port = Number(process.env.PORT ?? 3000);
Bun.serve({
	port,
	async fetch(req) {
		const url = new URL(req.url);
		if (url.pathname !== '/webhook/whatsapp') return new Response('not found', { status: 404 });
		const result = await processWebhook(
			{ chat, platform: 'whatsapp_cloud', account },
			{
				method: req.method,
				headers: Object.fromEntries(req.headers),
				body: await req.text(),
				query: Object.fromEntries(url.searchParams)
			}
		);
		return new Response(result.body, { status: result.status });
	}
});
console.log(`WhatsApp Cloud webhook listening on :${port}/webhook/whatsapp`);
