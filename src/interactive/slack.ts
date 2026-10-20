/**
 * Slack Block Kit builders. `platform_meta.slack` is spread into `chat.postMessage`,
 * so any Block Kit layout is reachable. Block/element constructors return plain
 * objects; compose them and hand the array to {@link slackMessage} (or the legacy
 * {@link slackBlocks}). Interactions arrive back as universal `postback`s.
 */

import { fragment, type Button, type InteractiveFragment } from './shared.js';

type Block = Record<string, unknown>;
type Element = Record<string, unknown>;

const plain = (text: string): Record<string, unknown> => ({ type: 'plain_text', text, emoji: true });
const mrkdwn = (text: string): Record<string, unknown> => ({ type: 'mrkdwn', text });

/** Send a message from raw Block Kit blocks (+ optional fallback text). */
export function slackBlocks(text: string, blocks: unknown[]): InteractiveFragment {
	return fragment('slack', { text, blocks });
}

/** Send a message from composed blocks; `text` is the notification fallback. */
export function slackMessage(text: string, blocks: Block[]): InteractiveFragment {
	return fragment('slack', { text, blocks });
}

/** Actions block of buttons. `data` → the action `value` (echoed as postback). */
export function slackButtons(text: string, buttons: Array<Button & { style?: 'primary' | 'danger' }>): InteractiveFragment {
	const elements = buttons.map((b, i) => ({
		type: 'button',
		text: plain(b.text),
		action_id: b.data ?? `action_${i}`,
		...(b.style ? { style: b.style } : {}),
		...(b.url ? { url: b.url } : { value: b.data ?? b.text })
	}));
	return fragment('slack', { text, blocks: [{ type: 'section', text: mrkdwn(text) }, { type: 'actions', elements }] });
}

/** A Block Kit option (for selects, overflow, radio, checkboxes). */
export interface SlackOption {
	text: string;
	value: string;
	description?: string;
}
const option = (o: SlackOption): Record<string, unknown> => ({
	text: plain(o.text),
	value: o.value,
	...(o.description ? { description: plain(o.description) } : {})
});

/**
 * Namespaced Block Kit constructors. Every function returns a plain block or element
 * object — assemble them into an array and pass to {@link slackMessage}.
 */
export const slack = {
	message: slackMessage,

	// --- blocks ---
	section: (text: string, opts?: { accessory?: Element; blockId?: string }): Block => ({
		type: 'section',
		text: mrkdwn(text),
		...(opts?.accessory ? { accessory: opts.accessory } : {}),
		...(opts?.blockId ? { block_id: opts.blockId } : {})
	}),
	fields: (fields: string[], opts?: { accessory?: Element }): Block => ({
		type: 'section',
		fields: fields.map(mrkdwn),
		...(opts?.accessory ? { accessory: opts.accessory } : {})
	}),
	header: (text: string): Block => ({ type: 'header', text: plain(text) }),
	divider: (): Block => ({ type: 'divider' }),
	image: (url: string, alt: string, opts?: { title?: string }): Block => ({
		type: 'image',
		image_url: url,
		alt_text: alt,
		...(opts?.title ? { title: plain(opts.title) } : {})
	}),
	context: (elements: Array<string | { imageUrl: string; alt: string }>): Block => ({
		type: 'context',
		elements: elements.map((e) => (typeof e === 'string' ? mrkdwn(e) : { type: 'image', image_url: e.imageUrl, alt_text: e.alt }))
	}),
	actions: (elements: Element[]): Block => ({ type: 'actions', elements }),
	input: (label: string, element: Element, opts?: { blockId?: string; hint?: string; optional?: boolean }): Block => ({
		type: 'input',
		label: plain(label),
		element,
		...(opts?.blockId ? { block_id: opts.blockId } : {}),
		...(opts?.hint ? { hint: plain(opts.hint) } : {}),
		...(opts?.optional ? { optional: true } : {})
	}),

	// --- elements ---
	button: (b: Button & { style?: 'primary' | 'danger' }): Element => ({
		type: 'button',
		text: plain(b.text),
		action_id: b.data ?? b.text,
		...(b.style ? { style: b.style } : {}),
		...(b.url ? { url: b.url } : { value: b.data ?? b.text })
	}),
	staticSelect: (actionId: string, options: SlackOption[], opts?: { placeholder?: string }): Element => ({
		type: 'static_select',
		action_id: actionId,
		...(opts?.placeholder ? { placeholder: plain(opts.placeholder) } : {}),
		options: options.map(option)
	}),
	multiStaticSelect: (actionId: string, options: SlackOption[], opts?: { placeholder?: string }): Element => ({
		type: 'multi_static_select',
		action_id: actionId,
		...(opts?.placeholder ? { placeholder: plain(opts.placeholder) } : {}),
		options: options.map(option)
	}),
	externalSelect: (actionId: string, opts?: { placeholder?: string; minQueryLength?: number }): Element => ({
		type: 'external_select',
		action_id: actionId,
		...(opts?.placeholder ? { placeholder: plain(opts.placeholder) } : {}),
		...(opts?.minQueryLength != null ? { min_query_length: opts.minQueryLength } : {})
	}),
	usersSelect: (actionId: string, opts?: { placeholder?: string }): Element => ({
		type: 'users_select',
		action_id: actionId,
		...(opts?.placeholder ? { placeholder: plain(opts.placeholder) } : {})
	}),
	channelsSelect: (actionId: string, opts?: { placeholder?: string }): Element => ({
		type: 'channels_select',
		action_id: actionId,
		...(opts?.placeholder ? { placeholder: plain(opts.placeholder) } : {})
	}),
	conversationsSelect: (actionId: string, opts?: { placeholder?: string }): Element => ({
		type: 'conversations_select',
		action_id: actionId,
		...(opts?.placeholder ? { placeholder: plain(opts.placeholder) } : {})
	}),
	overflow: (actionId: string, options: SlackOption[]): Element => ({ type: 'overflow', action_id: actionId, options: options.map(option) }),
	datePicker: (actionId: string, opts?: { placeholder?: string; initialDate?: string }): Element => ({
		type: 'datepicker',
		action_id: actionId,
		...(opts?.placeholder ? { placeholder: plain(opts.placeholder) } : {}),
		...(opts?.initialDate ? { initial_date: opts.initialDate } : {})
	}),
	timePicker: (actionId: string, opts?: { placeholder?: string; initialTime?: string }): Element => ({
		type: 'timepicker',
		action_id: actionId,
		...(opts?.placeholder ? { placeholder: plain(opts.placeholder) } : {}),
		...(opts?.initialTime ? { initial_time: opts.initialTime } : {})
	}),
	radio: (actionId: string, options: SlackOption[]): Element => ({ type: 'radio_buttons', action_id: actionId, options: options.map(option) }),
	checkboxes: (actionId: string, options: SlackOption[]): Element => ({ type: 'checkboxes', action_id: actionId, options: options.map(option) }),
	textInput: (actionId: string, opts?: { placeholder?: string; multiline?: boolean; initialValue?: string }): Element => ({
		type: 'plain_text_input',
		action_id: actionId,
		...(opts?.placeholder ? { placeholder: plain(opts.placeholder) } : {}),
		...(opts?.multiline ? { multiline: true } : {}),
		...(opts?.initialValue ? { initial_value: opts.initialValue } : {})
	}),
	option
};
