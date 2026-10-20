/**
 * Telegram rich / interactive builders. All produce a `platform_meta.telegram`
 * payload of `{ method, params }` that the adapter POSTs to the Bot API — so the
 * full Bot API surface is reachable without ChatKit modelling each feature in its
 * universal core. Inline-button presses arrive back as universal `postback`s.
 */

import { renderTelegramEntities } from '../format.js';
import { fragment, toRows, type InteractiveFragment } from './shared.js';
import type { TextRun } from '../schema.js';

/** An inline-keyboard button. Exactly one action kind should be set. */
export interface TelegramButton {
	text: string;
	/** `callback_data` — echoed back as a `postback`. */
	data?: string;
	/** Opens a URL. */
	url?: string;
	/** Launches a Web App (`web_app.url`). */
	webApp?: string;
	/** Seamless login (`login_url.url`). */
	loginUrl?: string;
	/** Prompt inline query in another chat (`switch_inline_query`). */
	switchInline?: string;
	/** Prompt inline query in the current chat. */
	switchInlineCurrent?: string;
	/** A copy-to-clipboard button (`copy_text.text`). */
	copyText?: string;
	/** A Telegram Payments pay button. */
	pay?: boolean;
}

export type TelegramButtonRows = TelegramButton[] | TelegramButton[][];

function inlineButton(b: TelegramButton): Record<string, unknown> {
	if (b.url) return { text: b.text, url: b.url };
	if (b.webApp) return { text: b.text, web_app: { url: b.webApp } };
	if (b.loginUrl) return { text: b.text, login_url: { url: b.loginUrl } };
	if (b.switchInline != null) return { text: b.text, switch_inline_query: b.switchInline };
	if (b.switchInlineCurrent != null) return { text: b.text, switch_inline_query_current_chat: b.switchInlineCurrent };
	if (b.copyText != null) return { text: b.text, copy_text: { text: b.copyText } };
	if (b.pay) return { text: b.text, pay: true };
	const data = b.data ?? b.text;
	// Telegram rejects the whole message with `BUTTON_DATA_INVALID` past 64 BYTES
	// (not characters) — fail here, where the offending button is still known.
	const bytes = new TextEncoder().encode(data).byteLength;
	if (bytes < 1 || bytes > TELEGRAM_CALLBACK_DATA_MAX_BYTES) {
		throw new RangeError(
			`Telegram callback_data must be 1-${TELEGRAM_CALLBACK_DATA_MAX_BYTES} bytes; button "${b.text}" carries ${bytes}. ` +
				'Keep a short id in the button and look the rest up server-side.'
		);
	}
	return { text: b.text, callback_data: data };
}

/** Telegram's hard ceiling on a button's `callback_data`, in UTF-8 bytes. */
export const TELEGRAM_CALLBACK_DATA_MAX_BYTES = 64;

/** Telegram inline keyboard. Supports every inline button kind (url/web_app/login/…). */
export function telegramButtons(text: string, buttons: TelegramButtonRows, options?: { rich?: TextRun[] }): InteractiveFragment {
	const inline_keyboard = toRows(buttons).map((row) => row.map(inlineButton));
	const entities = options?.rich ? renderTelegramEntities(options.rich).entities : undefined;
	return fragment('telegram', {
		method: 'sendMessage',
		params: { text, ...(entities?.length ? { entities } : {}), reply_markup: { inline_keyboard } }
	});
}

/**
 * Rewrite a message the bot already sent — its text AND its inline keyboard.
 * Pass `buttons` to replace the keyboard (e.g. to tick a toggled option), or
 * omit it to remove the keyboard entirely (e.g. once a question is answered).
 * `chat.edit()` is the universal text-only edit; this is the native one.
 */
export function telegramEditMessage(
	messageId: string | number,
	text: string,
	options?: { buttons?: TelegramButtonRows; rich?: TextRun[] }
): InteractiveFragment {
	const entities = options?.rich ? renderTelegramEntities(options.rich).entities : undefined;
	const inline_keyboard = options?.buttons ? toRows(options.buttons).map((row) => row.map(inlineButton)) : [];
	return fragment('telegram', {
		method: 'editMessageText',
		params: {
			message_id: Number(messageId),
			text,
			...(entities?.length ? { entities } : {}),
			reply_markup: { inline_keyboard }
		}
	});
}

/** A button on a custom reply keyboard (below the input field). */
export interface TelegramKeyboardButton {
	text: string;
	requestContact?: boolean;
	requestLocation?: boolean;
	/** Ask the user to create a poll; `true` for any type, or pin the type. */
	requestPoll?: boolean | 'quiz' | 'regular';
	/** Launch a Web App from the keyboard. */
	webApp?: string;
}

export interface TelegramReplyKeyboardOptions {
	resize?: boolean;
	oneTime?: boolean;
	selective?: boolean;
	isPersistent?: boolean;
	placeholder?: string;
}

function keyboardButton(b: TelegramKeyboardButton): Record<string, unknown> {
	const out: Record<string, unknown> = { text: b.text };
	if (b.requestContact) out.request_contact = true;
	if (b.requestLocation) out.request_location = true;
	if (b.requestPoll) out.request_poll = b.requestPoll === true ? {} : { type: b.requestPoll };
	if (b.webApp) out.web_app = { url: b.webApp };
	return out;
}

/** Custom reply keyboard (persistent buttons below the composer). */
export function telegramReplyKeyboard(
	text: string,
	rows: TelegramKeyboardButton[] | TelegramKeyboardButton[][],
	options?: TelegramReplyKeyboardOptions
): InteractiveFragment {
	const keyboard = toRows(rows).map((row) => row.map(keyboardButton));
	const reply_markup: Record<string, unknown> = { keyboard };
	if (options?.resize) reply_markup.resize_keyboard = true;
	if (options?.oneTime) reply_markup.one_time_keyboard = true;
	if (options?.selective) reply_markup.selective = true;
	if (options?.isPersistent) reply_markup.is_persistent = true;
	if (options?.placeholder) reply_markup.input_field_placeholder = options.placeholder;
	return fragment('telegram', { method: 'sendMessage', params: { text, reply_markup } });
}

/** Remove a previously-shown custom reply keyboard. */
export function telegramRemoveKeyboard(text: string, options?: { selective?: boolean }): InteractiveFragment {
	return fragment('telegram', {
		method: 'sendMessage',
		params: { text, reply_markup: { remove_keyboard: true, ...(options?.selective ? { selective: true } : {}) } }
	});
}

/** Force the user to reply to this message. */
export function telegramForceReply(text: string, options?: { placeholder?: string; selective?: boolean }): InteractiveFragment {
	const reply_markup: Record<string, unknown> = { force_reply: true };
	if (options?.placeholder) reply_markup.input_field_placeholder = options.placeholder;
	if (options?.selective) reply_markup.selective = true;
	return fragment('telegram', { method: 'sendMessage', params: { text, reply_markup } });
}

/** One item of a media group (album). `media` is a URL or a `file_id`. */
export interface TelegramMediaGroupItem {
	type: 'photo' | 'video' | 'audio' | 'document';
	media: string;
	caption?: string;
}

/** Send 2–10 media as a single album (`sendMediaGroup`). */
export function telegramMediaGroup(items: TelegramMediaGroupItem[]): InteractiveFragment {
	return fragment('telegram', {
		method: 'sendMediaGroup',
		params: { media: items.map((i) => ({ type: i.type, media: i.media, caption: i.caption })) }
	});
}

export interface TelegramPollOptions {
	isAnonymous?: boolean;
	type?: 'regular' | 'quiz';
	allowsMultipleAnswers?: boolean;
	/** 0-based index of the correct option (quiz only). */
	correctOptionId?: number;
	explanation?: string;
	openPeriod?: number;
	closeDate?: number;
}

/** Send a poll or quiz (`sendPoll`). */
export function telegramPoll(question: string, options: string[], opts?: TelegramPollOptions): InteractiveFragment {
	const params: Record<string, unknown> = { question, options };
	if (opts?.isAnonymous != null) params.is_anonymous = opts.isAnonymous;
	if (opts?.type) params.type = opts.type;
	if (opts?.allowsMultipleAnswers) params.allows_multiple_answers = true;
	if (opts?.correctOptionId != null) params.correct_option_id = opts.correctOptionId;
	if (opts?.explanation) params.explanation = opts.explanation;
	if (opts?.openPeriod != null) params.open_period = opts.openPeriod;
	if (opts?.closeDate != null) params.close_date = opts.closeDate;
	return fragment('telegram', { method: 'sendPoll', params });
}

/** Send an animated dice / dart / basketball / etc. (`sendDice`). */
export function telegramDice(emoji?: '🎲' | '🎯' | '🏀' | '⚽' | '🎳' | '🎰'): InteractiveFragment {
	return fragment('telegram', { method: 'sendDice', params: emoji ? { emoji } : {} });
}

/** Send a venue (a named point on the map) via `sendVenue`. */
export function telegramVenue(input: {
	lat: number;
	lng: number;
	title: string;
	address: string;
	foursquareId?: string;
	googlePlaceId?: string;
}): InteractiveFragment {
	return fragment('telegram', {
		method: 'sendVenue',
		params: {
			latitude: input.lat,
			longitude: input.lng,
			title: input.title,
			address: input.address,
			...(input.foursquareId ? { foursquare_id: input.foursquareId } : {}),
			...(input.googlePlaceId ? { google_place_id: input.googlePlaceId } : {})
		}
	});
}

export interface TelegramLinkPreviewOptions {
	disabled?: boolean;
	url?: string;
	preferSmallMedia?: boolean;
	preferLargeMedia?: boolean;
	showAboveText?: boolean;
}

/** Send text with explicit link-preview control (`link_preview_options`). */
export function telegramLinkPreview(text: string, preview: TelegramLinkPreviewOptions, options?: { rich?: TextRun[] }): InteractiveFragment {
	const link_preview_options: Record<string, unknown> = {};
	if (preview.disabled) link_preview_options.is_disabled = true;
	if (preview.url) link_preview_options.url = preview.url;
	if (preview.preferSmallMedia) link_preview_options.prefer_small_media = true;
	if (preview.preferLargeMedia) link_preview_options.prefer_large_media = true;
	if (preview.showAboveText) link_preview_options.show_above_text = true;
	const entities = options?.rich ? renderTelegramEntities(options.rich).entities : undefined;
	return fragment('telegram', {
		method: 'sendMessage',
		params: { text, ...(entities?.length ? { entities } : {}), link_preview_options }
	});
}
