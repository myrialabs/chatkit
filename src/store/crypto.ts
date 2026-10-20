/**
 * At-rest encryption for secret state (Baileys auth creds & signal keys, tokens).
 * AES-256-GCM via `node:crypto`. Credentials grant full access to a WhatsApp
 * number, so they are never stored in plaintext and never logged.
 *
 * The key comes from the `ChatKit`/store constructor or `CHATKIT_STATE_KEY`. Any
 * string is accepted and stretched to 32 bytes with scrypt over a fixed salt
 * (the salt only needs to be stable, not secret — a single deployment uses one
 * passphrase). Token format: `v1.<iv>.<tag>.<ciphertext>`, each part base64url.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const VERSION = 'v1';
const KEY_SALT = 'chatkit/state-key/v1';
const IV_BYTES = 12;

/** Reversibly encrypt/decrypt secret values for a {@link StateStore}. */
export interface SecretCodec {
	encrypt(plaintext: Uint8Array | string): string;
	decrypt(token: string): Uint8Array;
	/** Convenience: decrypt straight back to a UTF-8 string. */
	decryptString(token: string): string;
}

function toBytes(value: Uint8Array | string): Uint8Array {
	return typeof value === 'string' ? new TextEncoder().encode(value) : value;
}

/** Build a codec from a passphrase. Throws if the passphrase is empty. */
export function createSecretCodec(passphrase: string): SecretCodec {
	if (!passphrase) throw new Error('A non-empty state key is required for at-rest encryption.');
	const key = scryptSync(passphrase, KEY_SALT, 32);

	return {
		encrypt(plaintext) {
			const iv = randomBytes(IV_BYTES);
			const cipher = createCipheriv('aes-256-gcm', key, iv);
			const ct = Buffer.concat([cipher.update(toBytes(plaintext)), cipher.final()]);
			const tag = cipher.getAuthTag();
			return [
				VERSION,
				iv.toString('base64url'),
				tag.toString('base64url'),
				ct.toString('base64url')
			].join('.');
		},
		decrypt(token) {
			const parts = token.split('.');
			if (parts.length !== 4 || parts[0] !== VERSION) {
				throw new Error('Malformed or unsupported secret token.');
			}
			const iv = Buffer.from(parts[1]!, 'base64url');
			const tag = Buffer.from(parts[2]!, 'base64url');
			const ct = Buffer.from(parts[3]!, 'base64url');
			const decipher = createDecipheriv('aes-256-gcm', key, iv);
			decipher.setAuthTag(tag);
			const out = Buffer.concat([decipher.update(ct), decipher.final()]);
			return new Uint8Array(out);
		},
		decryptString(token) {
			return new TextDecoder().decode(this.decrypt(token));
		}
	};
}

/** Resolve a codec from an explicit key or `CHATKIT_STATE_KEY`, else `null`. */
export function resolveSecretCodec(explicitKey?: string): SecretCodec | null {
	const key = explicitKey ?? process.env.CHATKIT_STATE_KEY;
	return key ? createSecretCodec(key) : null;
}
