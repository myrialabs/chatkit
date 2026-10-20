/**
 * Addressing helpers. The address model is three layers —
 * `(platform, account, conversation_id[, thread_id])` — with native ids kept
 * verbatim so they stay reversible for replies.
 */

import {
	addressSchema,
	participantSchema,
	type Address,
	type Participant,
	type PlatformId
} from './schema.js';

export type { Address, Participant } from './schema.js';

/** Build and validate a conversation address. */
export function address(input: {
	platform: PlatformId;
	account: string;
	conversationId: string;
	threadId?: string | null;
}): Address {
	return addressSchema.parse({
		platform: input.platform,
		account: input.account,
		conversation_id: input.conversationId,
		thread_id: input.threadId ?? null
	});
}

/** Build and validate a participant address. */
export function participant(input: {
	platform: PlatformId;
	account: string;
	userId: string;
	displayName?: string | null;
	isSelf?: boolean;
}): Participant {
	return participantSchema.parse({
		platform: input.platform,
		account: input.account,
		user_id: input.userId,
		display_name: input.displayName ?? null,
		is_self: input.isSelf ?? false
	});
}

/**
 * A stable string key for an account on a platform, used to route outbound
 * messages to the adapter that owns the connection. Format: `platform:account`.
 */
export function accountKey(platform: PlatformId, account: string): string {
	return `${platform}:${account}`;
}

/** The account key an address belongs to. */
export function addressAccountKey(addr: Pick<Address, 'platform' | 'account'>): string {
	return accountKey(addr.platform, addr.account);
}

/**
 * A stable key for a single conversation, including thread. Useful for ordering
 * (one outbound queue per conversation) and dedup buckets.
 */
export function conversationKey(addr: Address): string {
	const base = `${addr.platform}:${addr.account}:${addr.conversation_id}`;
	return addr.thread_id ? `${base}:${addr.thread_id}` : base;
}

/** True when two addresses point at the same conversation (thread included). */
export function sameConversation(a: Address, b: Address): boolean {
	return conversationKey(a) === conversationKey(b);
}
