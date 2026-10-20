import type { Account, Capabilities, Conversation, Message, PlatformSpec, ButtonSpec, ListSectionSpec, OptionSpec } from './types';

function post<T>(path: string, body: unknown): Promise<T> {
	return fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => json<T>(r));
}

async function json<T>(res: Response): Promise<T> {
	if (!res.ok) {
		const body = await res.json().catch(() => null);
		throw new Error((body as { error?: string })?.error ?? `${res.status} ${res.statusText}`);
	}
	return (await res.json()) as T;
}

export interface AddChannelInput {
	platform: string;
	account?: string;
	label?: string;
	creds?: Record<string, string>;
}

export interface StartConversationInput {
	accountId: string;
	destination: string;
	title?: string;
	text: string;
}

export const api = {
	platformSpecs: () => fetch('/api/platform-specs').then((r) => json<PlatformSpec[]>(r)),
	accounts: () => fetch('/api/accounts').then((r) => json<Account[]>(r)),
	addAccount: (input: AddChannelInput) =>
		fetch('/api/accounts', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(input)
		}).then((r) => json<Account>(r)),
	removeAccount: (id: string) => fetch(`/api/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
	conversations: () => fetch('/api/conversations').then((r) => json<Conversation[]>(r)),
	messages: (id: string) =>
		fetch(`/api/conversations/${encodeURIComponent(id)}/messages`).then((r) => json<Message[]>(r)),
	markRead: (id: string) =>
		fetch(`/api/conversations/${encodeURIComponent(id)}/read`, { method: 'POST' }),
	startConversation: (input: StartConversationInput) =>
		fetch('/api/conversations/start', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(input)
		}).then((r) => json<{ conversation: Conversation; message: Message }>(r)),
	send: (conversationId: string, text: string, replyTo?: string) =>
		fetch('/api/send', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ conversationId, text, replyTo })
		}).then((r) => json<{ message: Message }>(r)),
	sendMedia: (conversationId: string, file: File, caption?: string) => {
		const form = new FormData();
		form.set('file', file);
		if (caption) form.set('caption', caption);
		return fetch(`/api/conversations/${encodeURIComponent(conversationId)}/media`, { method: 'POST', body: form }).then((r) => json<{ message: Message }>(r));
	},
	setTyping: (conversationId: string, on: boolean) =>
		fetch(`/api/conversations/${encodeURIComponent(conversationId)}/typing`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ on })
		}).catch(() => {}),
	react: (conversationId: string, targetMessageId: string, emoji: string) =>
		post<{ message: Message }>(`/api/conversations/${encodeURIComponent(conversationId)}/react`, { targetMessageId, emoji }),
	capabilities: (conversationId: string) =>
		fetch(`/api/conversations/${encodeURIComponent(conversationId)}/capabilities`).then((r) => json<{ platform: string; supports: Capabilities | null }>(r)),
	sendLocation: (conversationId: string, lat: number, lng: number, name?: string) =>
		post<{ message: Message }>(`/api/conversations/${encodeURIComponent(conversationId)}/location`, { lat, lng, name }),
	sendContact: (conversationId: string, name: string, phone: string) =>
		post<{ message: Message }>(`/api/conversations/${encodeURIComponent(conversationId)}/contact`, { name, phone }),
	sendButtons: (conversationId: string, body: string, buttons: ButtonSpec[]) =>
		post<{ message: Message }>(`/api/conversations/${encodeURIComponent(conversationId)}/interactive`, { kind: 'buttons', body, buttons }),
	sendList: (conversationId: string, body: string, buttonText: string, sections: ListSectionSpec[]) =>
		post<{ message: Message }>(`/api/conversations/${encodeURIComponent(conversationId)}/interactive`, { kind: 'list', body, buttonText, sections }),
	sendTemplate: (conversationId: string, name: string, language?: string) =>
		post<{ message: Message }>(`/api/conversations/${encodeURIComponent(conversationId)}/template`, { name, language }),
	sendCard: (conversationId: string, title: string, body: string) =>
		post<{ message: Message }>(`/api/conversations/${encodeURIComponent(conversationId)}/rich`, { title, body }),
	sendPoll: (conversationId: string, question: string, options: string[]) =>
		post<{ message: Message }>(`/api/conversations/${encodeURIComponent(conversationId)}/rich-message`, { kind: 'poll', question, options }),
	sendDice: (conversationId: string, emoji: string) =>
		post<{ message: Message }>(`/api/conversations/${encodeURIComponent(conversationId)}/rich-message`, { kind: 'dice', emoji }),
	sendVenue: (conversationId: string, lat: number, lng: number, title: string, addr: string) =>
		post<{ message: Message }>(`/api/conversations/${encodeURIComponent(conversationId)}/rich-message`, { kind: 'venue', lat, lng, title, address: addr }),
	sendEmbed: (conversationId: string, title: string, description: string, color: string, fields: OptionSpec[]) =>
		post<{ message: Message }>(`/api/conversations/${encodeURIComponent(conversationId)}/rich-message`, { kind: 'embed', title, description, color, fields }),
	sendSelect: (conversationId: string, prompt: string, placeholder: string, options: OptionSpec[]) =>
		post<{ message: Message }>(`/api/conversations/${encodeURIComponent(conversationId)}/rich-message`, { kind: 'select', prompt, placeholder, options }),
	sendCtaUrl: (conversationId: string, body: string, displayText: string, url: string) =>
		post<{ message: Message }>(`/api/conversations/${encodeURIComponent(conversationId)}/rich-message`, { kind: 'cta', body, displayText, url })
};

/** Parse a message's `meta` JSON into a typed `RichMeta`, or null if absent/invalid. */
export function richMeta(meta?: string | null): import('./types').RichMeta | null {
	if (!meta) return null;
	try {
		return JSON.parse(meta) as import('./types').RichMeta;
	} catch {
		return null;
	}
}

export interface StreamHandlers {
	onMessage: (payload: { conversation: Conversation; message: Message }) => void;
	onStatus: (payload: { message: Message }) => void;
	onQr: (payload: { account: string; dataUrl: string }) => void;
	onConnection: (payload: { platform: string; account: string; state: string; detail?: string }) => void;
	onPresence: (payload: { conversationId: string; user_id?: string; state: string }) => void;
	onOpen: () => void;
	onError: () => void;
}

/** Subscribe to the server's SSE stream. Auto-reconnects (EventSource default). */
export function connectStream(h: StreamHandlers): EventSource {
	const es = new EventSource('/events');
	es.addEventListener('open', h.onOpen);
	es.addEventListener('error', h.onError);
	es.addEventListener('message', (e) => h.onMessage(JSON.parse((e as MessageEvent).data)));
	es.addEventListener('status', (e) => h.onStatus(JSON.parse((e as MessageEvent).data)));
	es.addEventListener('qr', (e) => h.onQr(JSON.parse((e as MessageEvent).data)));
	es.addEventListener('connection', (e) => h.onConnection(JSON.parse((e as MessageEvent).data)));
	es.addEventListener('presence', (e) => h.onPresence(JSON.parse((e as MessageEvent).data)));
	return es;
}
