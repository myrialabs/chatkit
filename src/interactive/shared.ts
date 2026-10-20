/**
 * Shared types and helpers for the per-platform rich / interactive builders. Each
 * builder produces an {@link InteractiveFragment} — a `passthrough` content plus a
 * `platform_meta.<platform>` payload the matching adapter renders natively. Inbound
 * presses/selections normalise back to a universal `postback`, so handlers stay
 * platform-agnostic even though the outbound builder is platform-specific.
 */

import { passthrough } from '../envelope.js';
import type { OutboundContent } from '../schema.js';

/** The fragment to spread into `chat.send({ to, ...fragment })`. */
export interface InteractiveFragment {
	content: OutboundContent;
	platform_meta: Record<string, unknown>;
}

/** Wrap a native payload as a passthrough fragment for one platform. */
export function fragment(platform: string, payload: unknown): InteractiveFragment {
	return { content: passthrough(), platform_meta: { [platform]: payload } };
}

/** A tappable control. `data` is echoed back as a `postback`; `url` opens a link. */
export interface Button {
	text: string;
	data?: string;
	url?: string;
}

/** A row of buttons, or a flat list rendered as a single column. */
export type ButtonRows = Button[] | Button[][];

/** Normalise a flat list into single-column rows, or pass rows through. */
export function toRows<T>(items: T[] | T[][]): T[][] {
	return Array.isArray(items[0]) ? (items as T[][]) : (items as T[]).map((i) => [i]);
}

export interface ListRow {
	id: string;
	title: string;
	description?: string;
}
export interface ListSection {
	title?: string;
	rows: ListRow[];
}
