/**
 * The app-owned message store. ChatKit deliberately does *not* keep conversation
 * history — it streams live events and sends. An inbox needs history, a
 * conversation list and unread counts, so the app owns that in its own SQLite
 * database (separate from ChatKit's `StateStore`, which is infra: dedup, id
 * mapping, auth). This is the "map an inbound event to a row" layer every real
 * integration ends up writing.
 */

import { Database } from 'bun:sqlite';

export interface ConversationRow {
	id: string;
	platform: string;
	account: string;
	conversation_id: string;
	thread_id: string | null;
	title: string;
	last_preview: string;
	last_message_at: string;
	unread: number;
}

export interface AccountRow {
	id: string;
	platform: string;
	account: string;
	label: string;
	/** Encrypted JSON of the credential fields. */
	secret: string;
	created_at: string;
}

/** An account without its secret — safe to send to the client. */
export type PublicAccountRow = Omit<AccountRow, 'secret'>;

export interface MessageRow {
	id: string;
	conversation_id: string;
	platform_message_id: string | null;
	direction: 'inbound' | 'outbound';
	sender_name: string | null;
	content_type: string;
	text: string | null;
	media_url: string | null;
	media_type: string | null;
	caption: string | null;
	reply_to: string | null;
	status: string | null;
	created_at: string;
	/** JSON blob of structured rich content (location, contact, interactive buttons). */
	meta: string | null;
}

export class InboxDb {
	private readonly db: Database;

	constructor(path: string) {
		this.db = new Database(path);
		this.db.exec('PRAGMA journal_mode = WAL;');
		this.migrate();
	}

	private migrate(): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS accounts (
				id         TEXT PRIMARY KEY,
				platform   TEXT NOT NULL,
				account    TEXT NOT NULL,
				label      TEXT NOT NULL,
				secret     TEXT NOT NULL,
				created_at TEXT NOT NULL,
				UNIQUE (platform, account)
			);
			CREATE TABLE IF NOT EXISTS conversations (
				id              TEXT PRIMARY KEY,
				platform        TEXT NOT NULL,
				account         TEXT NOT NULL,
				conversation_id TEXT NOT NULL,
				thread_id       TEXT,
				title           TEXT NOT NULL,
				last_preview    TEXT NOT NULL DEFAULT '',
				last_message_at TEXT NOT NULL,
				unread          INTEGER NOT NULL DEFAULT 0
			);
			CREATE TABLE IF NOT EXISTS messages (
				id                  TEXT PRIMARY KEY,
				conversation_id     TEXT NOT NULL,
				platform_message_id TEXT,
				direction           TEXT NOT NULL,
				sender_name         TEXT,
				content_type        TEXT NOT NULL,
				text                TEXT,
				media_url           TEXT,
				media_type          TEXT,
				caption             TEXT,
				reply_to            TEXT,
				status              TEXT,
				created_at          TEXT NOT NULL,
				meta                TEXT
			);
			CREATE INDEX IF NOT EXISTS idx_messages_conversation
				ON messages (conversation_id, created_at);
		`);
		// Additive migration for databases created before the rich-content `meta` column.
		const cols = this.db.query(`PRAGMA table_info(messages)`).all() as Array<{ name: string }>;
		if (!cols.some((c) => c.name === 'meta')) this.db.exec(`ALTER TABLE messages ADD COLUMN meta TEXT`);
	}

	/** Insert-or-update the conversation an event belongs to. */
	upsertConversation(row: {
		id: string;
		platform: string;
		account: string;
		conversation_id: string;
		thread_id: string | null;
		title: string;
		preview: string;
		at: string;
		bumpUnread: boolean;
	}): ConversationRow {
		this.db
			.query(
				`INSERT INTO conversations (id, platform, account, conversation_id, thread_id, title, last_preview, last_message_at, unread)
				 VALUES ($id, $platform, $account, $conversation_id, $thread_id, $title, $preview, $at, $unread)
				 ON CONFLICT(id) DO UPDATE SET
				   last_preview = $preview,
				   last_message_at = $at,
				   title = CASE WHEN excluded.title != '' THEN excluded.title ELSE conversations.title END,
				   unread = conversations.unread + $unread`
			)
			.run({
				$id: row.id,
				$platform: row.platform,
				$account: row.account,
				$conversation_id: row.conversation_id,
				$thread_id: row.thread_id,
				$title: row.title,
				$preview: row.preview,
				$at: row.at,
				$unread: row.bumpUnread ? 1 : 0
			});
		return this.getConversation(row.id)!;
	}

	insertMessage(row: MessageRow): void {
		this.db
			.query(
				`INSERT OR IGNORE INTO messages
				 (id, conversation_id, platform_message_id, direction, sender_name, content_type, text, media_url, media_type, caption, reply_to, status, created_at, meta)
				 VALUES ($id, $conversation_id, $platform_message_id, $direction, $sender_name, $content_type, $text, $media_url, $media_type, $caption, $reply_to, $status, $created_at, $meta)`
			)
			.run({
				$id: row.id,
				$conversation_id: row.conversation_id,
				$platform_message_id: row.platform_message_id,
				$direction: row.direction,
				$sender_name: row.sender_name,
				$content_type: row.content_type,
				$text: row.text,
				$media_url: row.media_url,
				$media_type: row.media_type,
				$caption: row.caption,
				$reply_to: row.reply_to,
				$status: row.status,
				$created_at: row.created_at,
				$meta: row.meta ?? null
			});
	}

	updateStatusByPlatformId(platformMessageId: string, status: string): MessageRow | null {
		this.db
			.query(`UPDATE messages SET status = $status WHERE platform_message_id = $pid`)
			.run({ $status: status, $pid: platformMessageId });
		return (
			(this.db
				.query(`SELECT * FROM messages WHERE platform_message_id = $pid LIMIT 1`)
				.get({ $pid: platformMessageId }) as MessageRow | null) ?? null
		);
	}

	getConversation(id: string): ConversationRow | null {
		return (this.db.query(`SELECT * FROM conversations WHERE id = $id`).get({ $id: id }) as ConversationRow | null) ?? null;
	}

	listConversations(): ConversationRow[] {
		return this.db.query(`SELECT * FROM conversations ORDER BY last_message_at DESC`).all() as ConversationRow[];
	}

	listMessages(conversationId: string, limit = 200): MessageRow[] {
		return this.db
			.query(`SELECT * FROM messages WHERE conversation_id = $id ORDER BY created_at ASC LIMIT $limit`)
			.all({ $id: conversationId, $limit: limit }) as MessageRow[];
	}

	markRead(conversationId: string): void {
		this.db.query(`UPDATE conversations SET unread = 0 WHERE id = $id`).run({ $id: conversationId });
	}

	/**
	 * Distinct (account, peer) pairs for conversations on a platform that already
	 * have inbound history — used to backfill WhatsApp opt-in on boot so replies to
	 * pre-existing conversations aren't refused as cold, business-initiated sends.
	 */
	inboundPeers(platform: string): Array<{ account: string; conversation_id: string }> {
		return this.db
			.query(
				`SELECT DISTINCT c.account AS account, c.conversation_id AS conversation_id
				 FROM conversations c
				 JOIN messages m ON m.conversation_id = c.id AND m.direction = 'inbound'
				 WHERE c.platform = $platform`
			)
			.all({ $platform: platform }) as Array<{ account: string; conversation_id: string }>;
	}

	/** Native id of the most recent inbound message (for read receipts). */
	lastInboundPlatformId(conversationId: string): string | null {
		const row = this.db
			.query(
				`SELECT platform_message_id FROM messages
				 WHERE conversation_id = $id AND direction = 'inbound' AND platform_message_id IS NOT NULL
				 ORDER BY created_at DESC LIMIT 1`
			)
			.get({ $id: conversationId }) as { platform_message_id: string } | null;
		return row?.platform_message_id ?? null;
	}

	// --- accounts -------------------------------------------------------------

	insertAccount(row: AccountRow): void {
		this.db
			.query(
				`INSERT INTO accounts (id, platform, account, label, secret, created_at)
				 VALUES ($id, $platform, $account, $label, $secret, $created_at)`
			)
			.run({
				$id: row.id,
				$platform: row.platform,
				$account: row.account,
				$label: row.label,
				$secret: row.secret,
				$created_at: row.created_at
			});
	}

	deleteAccount(id: string): void {
		this.db.query(`DELETE FROM accounts WHERE id = $id`).run({ $id: id });
	}

	getAccount(id: string): AccountRow | null {
		return (this.db.query(`SELECT * FROM accounts WHERE id = $id`).get({ $id: id }) as AccountRow | null) ?? null;
	}

	/** All rows including secrets — for decrypting and starting on boot. */
	allAccounts(): AccountRow[] {
		return this.db.query(`SELECT * FROM accounts ORDER BY created_at ASC`).all() as AccountRow[];
	}

	/** Public rows (no secrets) — for the client. */
	listAccounts(): PublicAccountRow[] {
		return this.db
			.query(`SELECT id, platform, account, label, created_at FROM accounts ORDER BY created_at ASC`)
			.all() as PublicAccountRow[];
	}
}
