/**
 * WhatsApp **Cloud API** rich / interactive builders. Each emits a
 * `platform_meta.whatsapp_cloud` payload merged into the Graph API `messages` call.
 * Interactive replies (buttons / lists) normalise back to universal `postback`s.
 * Mind the 24-hour customer-service window: outside it, only templates send.
 * Baileys builders live in `./whatsapp.js`.
 */

import { fragment, type Button, type InteractiveFragment, type ListSection } from './shared.js';

interface CloudInteractive {
	type: string;
	header?: Record<string, unknown>;
	body?: { text: string };
	footer?: { text: string };
	action: Record<string, unknown>;
}

/** An optional header/footer shared by several interactive message kinds. */
export interface CloudChrome {
	headerText?: string;
	footer?: string;
}

function chrome(interactive: CloudInteractive, c?: CloudChrome): CloudInteractive {
	if (c?.headerText) interactive.header = { type: 'text', text: c.headerText };
	if (c?.footer) interactive.footer = { text: c.footer };
	return interactive;
}

function cloud(interactive: CloudInteractive): InteractiveFragment {
	return fragment('whatsapp_cloud', { type: 'interactive', interactive });
}

/** Interactive reply buttons (max 3). `data` → reply id (echoed as postback). */
export function whatsappCloudButtons(body: string, buttons: Button[], opts?: CloudChrome): InteractiveFragment {
	return cloud(
		chrome(
			{
				type: 'button',
				body: { text: body },
				action: { buttons: buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.data ?? b.text, title: b.text } })) }
			},
			opts
		)
	);
}

/** Interactive list. Selecting a row echoes its `id` as a postback. */
export function whatsappCloudList(body: string, buttonText: string, sections: ListSection[], opts?: CloudChrome): InteractiveFragment {
	return cloud(chrome({ type: 'list', body: { text: body }, action: { button: buttonText, sections } }, opts));
}

/** Call-to-action URL button (renders a tappable link button under the body text). */
export function whatsappCloudCtaUrl(body: string, displayText: string, url: string, opts?: CloudChrome): InteractiveFragment {
	return cloud(chrome({ type: 'cta_url', body: { text: body }, action: { name: 'cta_url', parameters: { display_text: displayText, url } } }, opts));
}

/** Request the user's location via an interactive prompt. */
export function whatsappCloudLocationRequest(body: string): InteractiveFragment {
	return cloud({ type: 'location_request_message', body: { text: body }, action: { name: 'send_location' } });
}

/** Launch a WhatsApp Flow. `flowToken`/`flowId` come from your Flow configuration. */
export function whatsappCloudFlow(
	body: string,
	input: { flowId: string; flowToken: string; ctaText: string; screen?: string; flowActionData?: Record<string, unknown> },
	opts?: CloudChrome
): InteractiveFragment {
	return cloud(
		chrome(
			{
				type: 'flow',
				body: { text: body },
				action: {
					name: 'flow',
					parameters: {
						flow_message_version: '3',
						flow_token: input.flowToken,
						flow_id: input.flowId,
						flow_cta: input.ctaText,
						flow_action: input.screen ? 'navigate' : 'data_exchange',
						...(input.screen
							? { flow_action_payload: { screen: input.screen, ...(input.flowActionData ? { data: input.flowActionData } : {}) } }
							: {})
					}
				}
			},
			opts
		)
	);
}

/** Single-product message from your catalog. */
export function whatsappCloudProduct(body: string, catalogId: string, productRetailerId: string, opts?: CloudChrome): InteractiveFragment {
	return cloud(chrome({ type: 'product', body: { text: body }, action: { catalog_id: catalogId, product_retailer_id: productRetailerId } }, opts));
}

/** Multi-product message: sections of product ids from one catalog. */
export function whatsappCloudProductList(
	headerText: string,
	body: string,
	catalogId: string,
	sections: Array<{ title: string; productRetailerIds: string[] }>,
	opts?: { footer?: string }
): InteractiveFragment {
	return cloud({
		type: 'product_list',
		header: { type: 'text', text: headerText },
		body: { text: body },
		...(opts?.footer ? { footer: { text: opts.footer } } : {}),
		action: {
			catalog_id: catalogId,
			sections: sections.map((s) => ({ title: s.title, product_items: s.productRetailerIds.map((id) => ({ product_retailer_id: id })) }))
		}
	});
}

/** Pre-approved template message (works outside the 24-hour window). */
export function whatsappCloudTemplate(name: string, languageCode: string, components?: unknown[]): InteractiveFragment {
	return fragment('whatsapp_cloud', {
		type: 'template',
		template: { name, language: { code: languageCode }, ...(components ? { components } : {}) }
	});
}

/**
 * Typed constructors for the `components` array of {@link whatsappCloudTemplate}.
 * Build a header/body/button component list and pass it to the template.
 */
export const waTemplate = {
	headerText: (...params: string[]): Record<string, unknown> => ({
		type: 'header',
		parameters: params.map((text) => ({ type: 'text', text }))
	}),
	headerMedia: (kind: 'image' | 'video' | 'document', link: string): Record<string, unknown> => ({
		type: 'header',
		parameters: [{ type: kind, [kind]: { link } }]
	}),
	headerLocation: (lat: string, lng: string, name?: string, address?: string): Record<string, unknown> => ({
		type: 'header',
		parameters: [{ type: 'location', location: { latitude: lat, longitude: lng, name, address } }]
	}),
	body: (...params: string[]): Record<string, unknown> => ({
		type: 'body',
		parameters: params.map((text) => ({ type: 'text', text }))
	}),
	/** A quick-reply button component; `index` is its 0-based position. */
	quickReply: (index: number, payload: string): Record<string, unknown> => ({
		type: 'button',
		sub_type: 'quick_reply',
		index,
		parameters: [{ type: 'payload', payload }]
	}),
	/** A dynamic-URL button component (fills the URL variable). */
	urlButton: (index: number, urlSuffix: string): Record<string, unknown> => ({
		type: 'button',
		sub_type: 'url',
		index,
		parameters: [{ type: 'text', text: urlSuffix }]
	}),
	/** A copy-code button component (e.g. coupon codes). */
	copyCode: (index: number, code: string): Record<string, unknown> => ({
		type: 'button',
		sub_type: 'copy_code',
		index,
		parameters: [{ type: 'coupon_code', coupon_code: code }]
	})
};

/** A carousel template (product/media cards the user can swipe). */
export function whatsappCloudCarousel(name: string, languageCode: string, cards: unknown[]): InteractiveFragment {
	return fragment('whatsapp_cloud', {
		type: 'template',
		template: { name, language: { code: languageCode }, components: [{ type: 'carousel', cards }] }
	});
}
