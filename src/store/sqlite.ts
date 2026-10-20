/**
 * Cross-runtime SQLite `StateStore`. A thin layer over whichever driver the
 * runtime offers, detected at open time:
 *
 *   1. `bun:sqlite`     — Bun (built in)
 *   2. `node:sqlite`    — Node ≥ 22.13 (built in, no flag)
 *
 * Both are built in, so nothing extra is installed. The supported runtimes
 * (Node >= 22.13, Bun >= 1.1 — see `src/runtime.ts`) always provide one.
 * The driver call surfaces are unified behind {@link SqliteDriver}.
 */

import type { StateStore } from './index.js';
import { codecFor } from './index.js';
import type { SecretCodec } from './crypto.js';

export interface SqliteStoreOptions {
	/** Database file path. Default `./chatkit.db`. Use `:memory:` for ephemeral. */
	path?: string;
	/** Passphrase for at-rest secret encryption (or set `CHATKIT_STATE_KEY`). */
	stateKey?: string;
}

interface SqliteStatement {
	run(...params: unknown[]): void;
	get(...params: unknown[]): any;
	all(...params: unknown[]): any[];
}

interface SqliteDriver {
	exec(sql: string): void;
	prepare(sql: string): SqliteStatement;
	close(): void;
	readonly name: string;
}

/** Hide the specifier from the bundler/TS so the module need not be installed. */
function loadModule(specifier: string): Promise<any> {
	return import(specifier);
}

async function openDriver(path: string): Promise<SqliteDriver> {
	const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
	if (isBun) {
		const { Database } = await loadModule('bun:sqlite');
		const db = new Database(path);
		return {
			name: 'bun:sqlite',
			exec: (sql) => db.run(sql),
			prepare: (sql) => {
				const stmt = db.query(sql);
				return {
					run: (...p) => void stmt.run(...p),
					get: (...p) => stmt.get(...p),
					all: (...p) => stmt.all(...p)
				};
			},
			close: () => db.close()
		};
	}

	try {
		const { DatabaseSync } = await loadModule('node:sqlite');
		const db = new DatabaseSync(path);
		return {
			name: 'node:sqlite',
			exec: (sql) => db.exec(sql),
			prepare: (sql) => {
				const stmt = db.prepare(sql);
				return {
					run: (...p) => void stmt.run(...p),
					get: (...p) => stmt.get(...p),
					all: (...p) => stmt.all(...p)
				};
			},
			close: () => db.close()
		};
	} catch {
		throw new Error(
			'No SQLite driver available. SqliteStore needs Bun >= 1.1 or Node >= 22.13 ' +
				'(built-in SQLite); on an older runtime use MemoryStore.'
		);
	}
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS seen (key TEXT PRIMARY KEY, expiry INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS mapping (
  account TEXT NOT NULL, chatkit_id TEXT NOT NULL, platform_message_id TEXT NOT NULL,
  PRIMARY KEY (account, chatkit_id)
);
CREATE INDEX IF NOT EXISTS mapping_rev ON mapping (account, platform_message_id);
CREATE TABLE IF NOT EXISTS optin (
  account TEXT NOT NULL, user_id TEXT NOT NULL, opted INTEGER NOT NULL,
  PRIMARY KEY (account, user_id)
);
CREATE TABLE IF NOT EXISTS kv (
  namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
  PRIMARY KEY (namespace, key)
);
CREATE TABLE IF NOT EXISTS secrets (
  namespace TEXT NOT NULL, key TEXT NOT NULL, token TEXT NOT NULL,
  PRIMARY KEY (namespace, key)
);
`;

export class SqliteStore implements StateStore {
	private readonly path: string;
	private readonly codec: SecretCodec | null;
	private driver: SqliteDriver | null = null;
	private ready: Promise<SqliteDriver> | null = null;

	constructor(options?: SqliteStoreOptions) {
		this.path = options?.path ?? './chatkit.db';
		this.codec = codecFor(options);
	}

	/** Which driver backs this store, once opened (for diagnostics). */
	driverName(): string | null {
		return this.driver?.name ?? null;
	}

	private db(): Promise<SqliteDriver> {
		if (!this.ready) {
			this.ready = openDriver(this.path).then((driver) => {
				driver.exec(SCHEMA);
				this.driver = driver;
				return driver;
			});
		}
		return this.ready;
	}

	async seen(key: string, ttlMs?: number): Promise<boolean> {
		const db = await this.db();
		const now = Date.now();
		const row = db.prepare('SELECT expiry FROM seen WHERE key = ?').get(key) as
			| { expiry: number }
			| undefined;
		if (row && row.expiry > now) return false;
		const expiry = ttlMs ? now + ttlMs : Number.MAX_SAFE_INTEGER;
		db.prepare('INSERT OR REPLACE INTO seen (key, expiry) VALUES (?, ?)').run(key, expiry);
		return true;
	}

	async putMapping(account: string, chatkitId: string, platformMessageId: string): Promise<void> {
		const db = await this.db();
		db.prepare(
			'INSERT OR REPLACE INTO mapping (account, chatkit_id, platform_message_id) VALUES (?, ?, ?)'
		).run(account, chatkitId, platformMessageId);
	}

	async getPlatformMessageId(account: string, chatkitId: string): Promise<string | null> {
		const db = await this.db();
		const row = db
			.prepare('SELECT platform_message_id AS v FROM mapping WHERE account = ? AND chatkit_id = ?')
			.get(account, chatkitId) as { v: string } | undefined;
		return row?.v ?? null;
	}

	async getChatkitId(account: string, platformMessageId: string): Promise<string | null> {
		const db = await this.db();
		const row = db
			.prepare('SELECT chatkit_id AS v FROM mapping WHERE account = ? AND platform_message_id = ?')
			.get(account, platformMessageId) as { v: string } | undefined;
		return row?.v ?? null;
	}

	async setOptIn(account: string, userId: string, optedIn: boolean): Promise<void> {
		const db = await this.db();
		db.prepare('INSERT OR REPLACE INTO optin (account, user_id, opted) VALUES (?, ?, ?)').run(
			account,
			userId,
			optedIn ? 1 : 0
		);
	}

	async isOptedIn(account: string, userId: string): Promise<boolean> {
		const db = await this.db();
		const row = db
			.prepare('SELECT opted AS v FROM optin WHERE account = ? AND user_id = ?')
			.get(account, userId) as { v: number } | undefined;
		return row?.v === 1;
	}

	async kvGet(namespace: string, key: string): Promise<string | null> {
		const db = await this.db();
		const row = db
			.prepare('SELECT value AS v FROM kv WHERE namespace = ? AND key = ?')
			.get(namespace, key) as { v: string } | undefined;
		return row?.v ?? null;
	}

	async kvSet(namespace: string, key: string, value: string): Promise<void> {
		const db = await this.db();
		db.prepare('INSERT OR REPLACE INTO kv (namespace, key, value) VALUES (?, ?, ?)').run(
			namespace,
			key,
			value
		);
	}

	async kvDelete(namespace: string, key: string): Promise<void> {
		const db = await this.db();
		db.prepare('DELETE FROM kv WHERE namespace = ? AND key = ?').run(namespace, key);
	}

	async kvList(namespace: string): Promise<Array<{ key: string; value: string }>> {
		const db = await this.db();
		return db.prepare('SELECT key, value FROM kv WHERE namespace = ?').all(namespace) as Array<{
			key: string;
			value: string;
		}>;
	}

	async secretGet(namespace: string, key: string): Promise<Uint8Array | null> {
		const db = await this.db();
		const row = db
			.prepare('SELECT token AS v FROM secrets WHERE namespace = ? AND key = ?')
			.get(namespace, key) as { v: string } | undefined;
		if (!row) return null;
		const codec = this.requireCodec();
		try {
			return codec.decrypt(row.v);
		} catch {
			// A token we can't decrypt (the state key was rotated or lost) is treated
			// as absent so callers self-heal — e.g. Baileys re-pairs via QR — instead
			// of crashing on a raw `Unsupported state...` crypto error. A *missing*
			// codec is still a hard error, thrown by requireCodec() above.
			return null;
		}
	}

	async secretSet(namespace: string, key: string, value: Uint8Array | string): Promise<void> {
		const db = await this.db();
		const token = this.requireCodec().encrypt(value);
		db.prepare('INSERT OR REPLACE INTO secrets (namespace, key, token) VALUES (?, ?, ?)').run(
			namespace,
			key,
			token
		);
	}

	async secretDelete(namespace: string, key: string): Promise<void> {
		const db = await this.db();
		db.prepare('DELETE FROM secrets WHERE namespace = ? AND key = ?').run(namespace, key);
	}

	async secretList(namespace: string): Promise<string[]> {
		const db = await this.db();
		const rows = db
			.prepare('SELECT key FROM secrets WHERE namespace = ?')
			.all(namespace) as Array<{ key: string }>;
		return rows.map((r) => r.key);
	}

	async close(): Promise<void> {
		if (this.driver) {
			this.driver.close();
			this.driver = null;
			this.ready = null;
		}
	}

	private requireCodec(): SecretCodec {
		if (!this.codec) {
			throw new Error(
				'Secret state requires a state key. Pass `stateKey` to SqliteStore/ChatKit ' +
					'or set CHATKIT_STATE_KEY.'
			);
		}
		return this.codec;
	}
}
