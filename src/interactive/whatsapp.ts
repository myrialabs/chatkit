/**
 * WhatsApp **Baileys** rich builders. Interactive *buttons* and *lists* are
 * intentionally **not** offered here: WhatsApp has deprecated the legacy
 * `buttonsMessage`/`listMessage` types and restricts the modern native-flow
 * `interactiveMessage` to the official Business/Cloud API — from an unofficial
 * Baileys (personal) connection they are silently dropped. Use the WhatsApp **Cloud**
 * adapter (`./whatsapp-cloud.js`) for reliable buttons/lists.
 *
 * What Baileys *does* send dependably is covered below: polls, shared contacts,
 * locations and event cards. All are plain `sendMessage` content.
 */

import { fragment, type InteractiveFragment } from './shared.js';

/**
 * A native poll (`pollCreationMessage`). `selectableCount` is how many options a
 * voter may pick (1 = single choice). Poll votes arrive on Baileys as encrypted
 * update events — surfaced through the adapter's `raw` payload.
 */
export function whatsappBaileysPoll(name: string, options: string[], opts?: { selectableCount?: number }): InteractiveFragment {
	return fragment('whatsapp_baileys', {
		poll: { name, values: options, selectableCount: opts?.selectableCount ?? 1 }
	});
}

/** A contact (or several) shared as vCards (`contactsArrayMessage`). */
export function whatsappBaileysContacts(contacts: Array<{ name: string; phone: string; organization?: string }>): InteractiveFragment {
	const cards = contacts.map((c) => ({
		vcard:
			`BEGIN:VCARD\nVERSION:3.0\nFN:${c.name}\n` +
			(c.organization ? `ORG:${c.organization}\n` : '') +
			`TEL;type=CELL;type=VOICE;waid=${c.phone}:${c.phone}\nEND:VCARD`
	}));
	return fragment('whatsapp_baileys', {
		contacts: { displayName: contacts.length === 1 ? contacts[0]!.name : `${contacts.length} contacts`, contacts: cards }
	});
}

/** A location pin, optionally with a name + street address (`locationMessage`). */
export function whatsappBaileysLocation(lat: number, lng: number, opts?: { name?: string; address?: string }): InteractiveFragment {
	return fragment('whatsapp_baileys', {
		location: { degreesLatitude: lat, degreesLongitude: lng, ...(opts?.name ? { name: opts.name } : {}), ...(opts?.address ? { address: opts.address } : {}) }
	});
}

/** An event message (`eventMessage`) — a scheduled event card with an optional location. */
export function whatsappBaileysEvent(input: {
	name: string;
	description?: string;
	startTimeSeconds: number;
	location?: { lat: number; lng: number; name?: string };
}): InteractiveFragment {
	return fragment('whatsapp_baileys', {
		event: {
			name: input.name,
			...(input.description ? { description: input.description } : {}),
			startTime: input.startTimeSeconds,
			...(input.location
				? { location: { degreesLatitude: input.location.lat, degreesLongitude: input.location.lng, name: input.location.name } }
				: {})
		}
	});
}
