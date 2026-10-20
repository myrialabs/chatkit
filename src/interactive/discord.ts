/**
 * Discord rich / interactive builders. Produce a `platform_meta.discord` payload
 * that the adapter passes straight to `channel.send()`. Covers embeds, all button
 * styles, select menus (string/user/role/channel/mentionable), allowed-mentions,
 * flags and polls. Button/select interactions arrive back as universal `postback`s.
 */

import { fragment, type InteractiveFragment } from './shared.js';

const BUTTON_STYLE: Record<string, number> = { primary: 1, secondary: 2, success: 3, danger: 4, link: 5 };

/** A Discord button. Link buttons carry `url`; the rest echo `data` as a postback. */
export interface DiscordButton {
	text: string;
	data?: string;
	url?: string;
	style?: 'primary' | 'secondary' | 'success' | 'danger' | 'link';
	emoji?: string;
	disabled?: boolean;
}

function button(b: DiscordButton): Record<string, unknown> {
	const isLink = Boolean(b.url) || b.style === 'link';
	const out: Record<string, unknown> = {
		type: 2,
		style: BUTTON_STYLE[b.style ?? (isLink ? 'link' : 'primary')],
		label: b.text
	};
	if (b.emoji) out.emoji = { name: b.emoji };
	if (b.disabled) out.disabled = true;
	if (isLink) out.url = b.url;
	else out.custom_id = b.data ?? b.text;
	return out;
}

/** Action row of buttons (max 5 per row). */
export function discordButtons(text: string, buttons: DiscordButton[]): InteractiveFragment {
	return fragment('discord', { content: text, components: [{ type: 1, components: buttons.map(button) }] });
}

/** An option in a string select menu. */
export interface DiscordSelectOption {
	label: string;
	value: string;
	description?: string;
	emoji?: string;
	default?: boolean;
}

export interface DiscordSelectInput {
	/** `custom_id` — echoed back (with the chosen values) as a postback. */
	data: string;
	placeholder?: string;
	minValues?: number;
	maxValues?: number;
	/** `string` needs `options`; the others resolve their entities automatically. */
	type?: 'string' | 'user' | 'role' | 'channel' | 'mentionable';
	options?: DiscordSelectOption[];
	disabled?: boolean;
}

const SELECT_TYPE: Record<string, number> = { string: 3, user: 5, role: 6, mentionable: 7, channel: 8 };

function select(s: DiscordSelectInput): Record<string, unknown> {
	const out: Record<string, unknown> = { type: SELECT_TYPE[s.type ?? 'string'], custom_id: s.data };
	if (s.placeholder) out.placeholder = s.placeholder;
	if (s.minValues != null) out.min_values = s.minValues;
	if (s.maxValues != null) out.max_values = s.maxValues;
	if (s.disabled) out.disabled = true;
	if ((s.type ?? 'string') === 'string' && s.options) {
		out.options = s.options.map((o) => ({
			label: o.label,
			value: o.value,
			...(o.description ? { description: o.description } : {}),
			...(o.emoji ? { emoji: { name: o.emoji } } : {}),
			...(o.default ? { default: true } : {})
		}));
	}
	return out;
}

/** A select menu (each select occupies its own action row). */
export function discordSelect(text: string, menu: DiscordSelectInput): InteractiveFragment {
	return fragment('discord', { content: text, components: [{ type: 1, components: [select(menu)] }] });
}

/** A rich embed. All fields are optional; `color` is an integer (e.g. `0x5865f2`). */
export interface DiscordEmbedInput {
	title?: string;
	description?: string;
	url?: string;
	color?: number;
	timestamp?: string;
	author?: { name: string; url?: string; iconUrl?: string };
	footer?: { text: string; iconUrl?: string };
	image?: string;
	thumbnail?: string;
	fields?: Array<{ name: string; value: string; inline?: boolean }>;
}

/** Build a single embed object (compose several with {@link discordEmbeds}). */
export function discordEmbed(input: DiscordEmbedInput): Record<string, unknown> {
	const embed: Record<string, unknown> = {};
	if (input.title) embed.title = input.title;
	if (input.description) embed.description = input.description;
	if (input.url) embed.url = input.url;
	if (input.color != null) embed.color = input.color;
	if (input.timestamp) embed.timestamp = input.timestamp;
	if (input.author) embed.author = { name: input.author.name, url: input.author.url, icon_url: input.author.iconUrl };
	if (input.footer) embed.footer = { text: input.footer.text, icon_url: input.footer.iconUrl };
	if (input.image) embed.image = { url: input.image };
	if (input.thumbnail) embed.thumbnail = { url: input.thumbnail };
	if (input.fields) embed.fields = input.fields.map((f) => ({ name: f.name, value: f.value, inline: f.inline ?? false }));
	return embed;
}

/** Send one or more embeds, optionally with leading text. */
export function discordEmbeds(embeds: DiscordEmbedInput | DiscordEmbedInput[], options?: { text?: string }): InteractiveFragment {
	const list = Array.isArray(embeds) ? embeds : [embeds];
	return fragment('discord', { ...(options?.text ? { content: options.text } : {}), embeds: list.map(discordEmbed) });
}

/** Control which mentions in a message actually ping. */
export interface DiscordAllowedMentions {
	parse?: Array<'roles' | 'users' | 'everyone'>;
	users?: string[];
	roles?: string[];
	repliedUser?: boolean;
}

/** Send text with explicit allowed-mentions and/or message flags (e.g. suppress embeds). */
export function discordMessage(
	text: string,
	options?: { allowedMentions?: DiscordAllowedMentions; suppressEmbeds?: boolean; tts?: boolean }
): InteractiveFragment {
	const payload: Record<string, unknown> = { content: text };
	if (options?.allowedMentions) {
		const am = options.allowedMentions;
		payload.allowed_mentions = {
			...(am.parse ? { parse: am.parse } : {}),
			...(am.users ? { users: am.users } : {}),
			...(am.roles ? { roles: am.roles } : {}),
			...(am.repliedUser != null ? { replied_user: am.repliedUser } : {})
		};
	}
	if (options?.suppressEmbeds) payload.flags = 4; // SUPPRESS_EMBEDS
	if (options?.tts) payload.tts = true;
	return fragment('discord', payload);
}

/** Send a native Discord poll. */
export function discordPoll(
	question: string,
	answers: Array<{ text: string; emoji?: string }>,
	options?: { durationHours?: number; allowMultiselect?: boolean }
): InteractiveFragment {
	return fragment('discord', {
		poll: {
			question: { text: question },
			answers: answers.map((a) => ({ poll_media: { text: a.text, ...(a.emoji ? { emoji: { name: a.emoji } } : {}) } })),
			duration: options?.durationHours ?? 24,
			allow_multiselect: options?.allowMultiselect ?? false
		}
	});
}
