/**
 * The `StateStore` port and its built-in implementations. A state store holds
 * everything a long-lived connection needs to survive a restart: inbound dedup
 * keys, the `chatkit_id ↔ platform_message_id` mapping, opt-in records, a plain
 * namespaced key/value area, and an *encrypted* secret area for Baileys auth
 * state. Defaults are in-memory (tests) and SQLite (persist); a consumer can
 * supply any backend (Postgres, Redis) by implementing this interface.

 */

import { createSecretCodec, resolveSecretCodec, type SecretCodec } from './crypto.js';

export type { SecretCodec } from './crypto.js';
export { createSecretCodec, resolveSecretCodec } from './crypto.js';

export interface StateStore {
	/**
	 * Atomic check-and-set for idempotency: returns `true` the first time a key is
	 * seen and `false` for every redelivery. Optional TTL in milliseconds.
	 */
	seen(key: string, ttlMs?: number): Promise<boolean>;

	/** Record the mapping between a ChatKit id and a native message id. */
	putMapping(account: string, chatkitId: string, platformMessageId: string): Promise<void>;
	getPlatformMessageId(account: string, chatkitId: string): Promise<string | null>;
	getChatkitId(account: string, platformMessageId: string): Promise<string | null>;

	/** Opt-in tracking, enforced before WhatsApp business-initiated sends. */
	setOptIn(account: string, userId: string, optedIn: boolean): Promise<void>;
	isOptedIn(account: string, userId: string): Promise<boolean>;

	/** Plain namespaced key/value (non-secret adapter state, e.g. Discord resume). */
	kvGet(namespace: string, key: string): Promise<string | null>;
	kvSet(namespace: string, key: string, value: string): Promise<void>;
	kvDelete(namespace: string, key: string): Promise<void>;
	kvList(namespace: string): Promise<Array<{ key: string; value: string }>>;

	/**
	 * Encrypted secret store for credentials/auth state. Requires a state key to
	 * be configured; throws otherwise. Values are encrypted at rest.
	 */
	secretGet(namespace: string, key: string): Promise<Uint8Array | null>;
	secretSet(namespace: string, key: string, value: Uint8Array | string): Promise<void>;
	secretDelete(namespace: string, key: string): Promise<void>;
	secretList(namespace: string): Promise<string[]>;

	/** Release any held resources (file handles, sockets). */
	close(): Promise<void>;
}

export { MemoryStateStore } from './memory.js';
export { SqliteStore, type SqliteStoreOptions } from './sqlite.js';

/** Options shared by the built-in stores. */
export interface StoreOptions {
	/** Passphrase for at-rest secret encryption (or set `CHATKIT_STATE_KEY`). */
	stateKey?: string;
}

/** Internal helper: resolve a codec for a store, or `null` if no key is set. */
export function codecFor(options?: StoreOptions): SecretCodec | null {
	if (options?.stateKey) return createSecretCodec(options.stateKey);
	return resolveSecretCodec();
}
