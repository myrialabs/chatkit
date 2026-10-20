export type Platform = 'telegram' | 'whatsapp_baileys' | 'whatsapp_cloud' | 'discord' | 'slack';

export type ConnState = 'connecting' | 'qr' | 'authenticated' | 'open' | 'closed' | 'unknown';

export interface Account {
	id: string;
	platform: Platform;
	account: string;
	label: string;
	connected: boolean;
	state: ConnState;
	webhookPath?: string;
	created_at?: string;
}

export interface FieldSpec {
	key: string;
	label: string;
	type: 'text' | 'password';
	required: boolean;
	placeholder?: string;
}

export interface PlatformSpec {
	platform: Platform;
	label: string;
	defaultAccount: string;
	accountLabel: string;
	accountPlaceholder: string;
	webhook: boolean;
	note?: string;
	fields: FieldSpec[];
}

export interface Conversation {
	id: string;
	platform: Platform;
	account: string;
	conversation_id: string;
	thread_id: string | null;
	title: string;
	last_preview: string;
	last_message_at: string;
	unread: number;
}

export interface Message {
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
	/** JSON string of structured rich content; parse with `richMeta()`. */
	meta?: string | null;
}

export interface ReplyTarget {
	messageId: string;
	platformMessageId: string;
	preview: string;
}

/** A tappable control echoed as a postback (or a link button when `url` is set). */
export interface ButtonSpec {
	text: string;
	data?: string;
	url?: string;
}

export interface ListRowSpec {
	id: string;
	title: string;
	description?: string;
}

export interface ListSectionSpec {
	title?: string;
	rows: ListRowSpec[];
}

/** One styled run of text — mirrors ChatKit's universal `TextRun`. */
export interface RunSpec {
	text: string;
	bold?: boolean;
	italic?: boolean;
	strike?: boolean;
	underline?: boolean;
	code?: boolean;
	pre?: boolean;
	spoiler?: boolean;
	link?: string;
	mention?: { id: string; display?: string };
}

/** An embed/select option pair. */
export interface OptionSpec {
	label: string;
	value: string;
}

/** Parsed `Message.meta` variants — mirrors what the server persists per rich type. */
export type RichMeta =
	| { kind: 'location'; lat: number; lng: number; name?: string | null }
	| { kind: 'contact'; name: string; phone: string }
	| { kind: 'buttons'; body: string; buttons: ButtonSpec[] }
	| { kind: 'list'; body: string; buttonText?: string | null; sections: ListSectionSpec[] }
	| { kind: 'template'; name: string; language?: string }
	| { kind: 'card'; title: string; body: string }
	| { kind: 'runs'; runs: RunSpec[] }
	| { kind: 'poll'; question: string; options: string[] }
	| { kind: 'dice'; emoji: string }
	| { kind: 'venue'; lat: number; lng: number; title: string; address: string }
	| { kind: 'embed'; title: string; description: string; color?: string; fields: OptionSpec[] }
	| { kind: 'select'; prompt: string; placeholder?: string; options: OptionSpec[] }
	| { kind: 'cta'; body: string; displayText: string; url: string };

/** Which rich features a platform supports — the honesty contract, surfaced to the UI. */
export interface Capabilities {
	delivery_receipt: boolean;
	read_receipt: boolean;
	reactions: boolean;
	threads: boolean;
	buttons: boolean;
	typing: boolean;
	rich_layout: boolean;
	templates: boolean;
	edit: boolean;
	location: boolean;
	contact: boolean;
	media: string[];
}
