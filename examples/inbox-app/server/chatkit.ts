/**
 * The ChatKit instance. No adapters are wired here — channels are configured at
 * runtime through the UI (see accounts.ts). The store is encrypted at rest with
 * the app's master key (same key that protects UI-entered credentials), and
 * inbound media resolves to same-origin `/media/<id>` URLs the server streams.
 */

import { ChatKit, consoleLogger } from '@myrialabs/chatkit';
import { SqliteStore } from '@myrialabs/chatkit/store';
import { FileMediaStore } from '@myrialabs/chatkit/media';

export function createChat(stateKey: string): ChatKit {
	return new ChatKit({
		store: new SqliteStore({ path: process.env.CHATKIT_DB ?? 'chatkit.db', stateKey }),
		media: new FileMediaStore({ dir: process.env.MEDIA_DIR ?? 'media-store', baseUrl: '/media' }),
		logger: consoleLogger('info')
	});
}
