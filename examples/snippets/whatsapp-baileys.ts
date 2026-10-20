/**
 * WhatsApp (Baileys) echo bot. Scan the QR with a TEST number — ban risk is real
 * (see docs/operations/runbook.md). Auth state is persisted encrypted in SQLite, so a restart
 * does not require re-pairing.
 *
 *   CHATKIT_STATE_KEY=… WA_ACCOUNT=wa:62… bun examples/snippets/whatsapp-baileys.ts
 */
import { ChatKit, text, reply } from '@myrialabs/chatkit';
import { consoleLogger } from '@myrialabs/chatkit';
import { SqliteStore } from '@myrialabs/chatkit/store';
import { WhatsAppBaileysAdapter } from '@myrialabs/chatkit/adapters';

const account = process.env.WA_ACCOUNT;
const stateKey = process.env.CHATKIT_STATE_KEY;
if (!account || !stateKey) throw new Error('Set WA_ACCOUNT and CHATKIT_STATE_KEY');

let renderQr: ((s: string, o: { small: boolean }) => void) | null = null;
try {
	// Keep `generate` bound to its module — it reads `this.error` for the
	// error-correction level, so a detached reference renders a broken QR.
	const qr = (await import('qrcode-terminal')).default;
	renderQr = (s, o) => qr.generate(s, o);
} catch {
	renderQr = null;
}

const chat = new ChatKit({
	store: new SqliteStore({ path: 'chatkit.db', stateKey }),
	logger: consoleLogger('info')
});

chat.use(
	new WhatsAppBaileysAdapter({
		account,
		onQR: (qr) => {
			console.log('Scan with WhatsApp → Linked Devices (TEST number):');
			if (renderQr) renderQr(qr, { small: true });
			else console.log(qr);
		}
	})
);

chat.on('message', async (m) => {
	if (m.content.type === 'text') {
		await chat.send(reply(m, text(`echo: ${m.content.text}`)));
	}
});
chat.on('error', (e) => console.error('error', e.error.message));

await chat.start();
console.log('Connected. Message the number from another WhatsApp. Ctrl+C to stop.');
process.on('SIGINT', () => void chat.stop().then(() => process.exit(0)));
