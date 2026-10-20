/**
 * The master key for at-rest encryption. Credentials entered in the UI are
 * stored encrypted, and Baileys auth state is encrypted by ChatKit's SqliteStore
 * with the same key. The key is generated once and kept in a gitignored file —
 * so the app is zero-config (no `.env`) yet never stores secrets in plaintext.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createSecretCodec, type SecretCodec } from '@myrialabs/chatkit/store';

/** Load the master key, generating and persisting one on first run. */
export function loadMasterKey(path = '.inbox-key'): string {
	if (existsSync(path)) return readFileSync(path, 'utf8').trim();
	const key = randomBytes(32).toString('base64');
	writeFileSync(path, key, { mode: 0o600 });
	return key;
}

export function loadSecrets(path = '.inbox-key'): { key: string; codec: SecretCodec; generated: boolean } {
	// `generated` = the key file was missing and a fresh random key was just minted.
	// If saved channels already exist, that means the previous key was lost and those
	// channels can no longer be decrypted (see index.ts / accounts.ts self-heal).
	const generated = !existsSync(path);
	const key = loadMasterKey(path);
	return { key, codec: createSecretCodec(key), generated };
}
