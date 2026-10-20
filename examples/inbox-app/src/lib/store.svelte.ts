import type { Account, Conversation, Message, Platform, PlatformSpec, ReplyTarget } from './types';

/** The whole client state, one reactive tree (Svelte 5 runes). */
export const inbox = $state({
	accounts: [] as Account[],
	platformSpecs: [] as PlatformSpec[],
	conversations: [] as Conversation[],
	messagesByConv: {} as Record<string, Message[]>,
	activeId: null as string | null,
	filter: null as Platform | null,
	reply: null as ReplyTarget | null,
	qr: null as { account: string; dataUrl: string } | null,
	settingsOpen: false,
	newChatOpen: false,
	connected: false,
	/** conversationId → whether the peer is currently typing (for the indicator). */
	typing: {} as Record<string, boolean>
});

/** Auto-expiry timers so a stuck "typing" clears itself even without a stop signal. */
const typingTimers: Record<string, ReturnType<typeof setTimeout>> = {};

/**
 * Record a typing signal. `active` sets a reactive flag that auto-clears after a
 * few seconds; a `paused` signal (active=false) clears it at once. We key on a
 * boolean (not a timestamp) so the derived indicator updates without polling the
 * clock — a timestamp read isn't reactive and would leave the dots stuck on.
 */
export function markTyping(conversationId: string, active: boolean): void {
	if (typingTimers[conversationId]) {
		clearTimeout(typingTimers[conversationId]);
		delete typingTimers[conversationId];
	}
	if (active) {
		inbox.typing[conversationId] = true;
		typingTimers[conversationId] = setTimeout(() => {
			delete inbox.typing[conversationId];
			delete typingTimers[conversationId];
		}, 6000);
	} else {
		delete inbox.typing[conversationId];
	}
}

/** True while the peer is typing in this conversation. */
export function isTyping(conversationId: string): boolean {
	return inbox.typing[conversationId] === true;
}

function sortConversations(): void {
	inbox.conversations.sort((a, b) => b.last_message_at.localeCompare(a.last_message_at));
}

export function upsertConversation(c: Conversation): void {
	const i = inbox.conversations.findIndex((x) => x.id === c.id);
	if (i === -1) inbox.conversations.push(c);
	else inbox.conversations[i] = c;
	sortConversations();
}

/** Conversations whose full history has been fetched from the server at least once. */
const historyLoaded = new Set<string>();

export function isHistoryLoaded(conversationId: string): boolean {
	return historyLoaded.has(conversationId);
}

/**
 * Merge server-fetched history into a conversation, keeping any messages that
 * arrived live over SSE while the fetch was in flight (deduped by id). Without
 * this, opening a brand-new conversation would replace its just-received first
 * message with a history snapshot taken before that message was stored — the
 * message then lingers in the nav list but vanishes from the open thread.
 */
export function mergeMessages(conversationId: string, fetched: Message[]): void {
	const live = inbox.messagesByConv[conversationId] ?? [];
	const seen = new Set(fetched.map((m) => m.id));
	const merged = [...fetched, ...live.filter((m) => !seen.has(m.id))];
	merged.sort((a, b) => a.created_at.localeCompare(b.created_at));
	inbox.messagesByConv[conversationId] = merged;
	historyLoaded.add(conversationId);
}

export function appendMessage(m: Message): void {
	const list = (inbox.messagesByConv[m.conversation_id] ??= []);
	const i = list.findIndex((x) => x.id === m.id);
	if (i === -1) list.push(m);
	else list[i] = m;
	list.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export function applyStatus(m: Message): void {
	const list = inbox.messagesByConv[m.conversation_id];
	if (!list) return;
	const i = list.findIndex(
		(x) => x.id === m.id || (m.platform_message_id && x.platform_message_id === m.platform_message_id)
	);
	if (i !== -1) list[i] = { ...list[i], status: m.status };
}

export function activeConversation(): Conversation | null {
	return inbox.conversations.find((c) => c.id === inbox.activeId) ?? null;
}
