/**
 * Capability descriptors are ChatKit's "honesty contract": each adapter declares
 * exactly what its platform supports, and `send()` is gated by it so unsupported
 * features fail with a clear error instead of a silent no-op.
 */

import {
	capabilityDescriptorSchema,
	type CapabilityDescriptor,
	type CapabilitySupport,
	type MediaType,
	type OutboundContent,
	type PlatformId
} from './schema.js';

export type { CapabilityDescriptor, CapabilitySupport } from './schema.js';

/** Thrown when an outbound message asks for a feature the platform can't do. */
export class CapabilityError extends Error {
	readonly platform: PlatformId;
	readonly feature: string;
	constructor(platform: PlatformId, feature: string, detail?: string) {
		super(
			`Platform "${platform}" does not support ${feature}${detail ? `: ${detail}` : ''}. ` +
				`Check chat.capabilities('${platform}') before sending, or use platform_meta passthrough.`
		);
		this.name = 'CapabilityError';
		this.platform = platform;
		this.feature = feature;
	}
}

/** Build and validate a capability descriptor (adapters use this). */
export function capabilities(platform: PlatformId, supports: CapabilitySupport): CapabilityDescriptor {
	return capabilityDescriptorSchema.parse({ platform, supports });
}

/** A descriptor with every feature off — a safe base to override from. */
export function emptySupport(): CapabilitySupport {
	return {
		delivery_receipt: false,
		read_receipt: false,
		reactions: false,
		threads: false,
		buttons: false,
		typing: false,
		rich_layout: false,
		templates: false,
		edit: false,
		location: false,
		contact: false,
		media: []
	};
}

/**
 * In-process registry mapping a platform to its capability descriptor. `ChatKit`
 * populates it from each registered adapter so consumers can query
 * `chat.capabilities(platform)` and the dispatcher can gate sends.
 */
export class CapabilityRegistry {
	private readonly map = new Map<PlatformId, CapabilityDescriptor>();

	set(descriptor: CapabilityDescriptor): void {
		this.map.set(descriptor.platform, descriptor);
	}

	get(platform: PlatformId): CapabilityDescriptor | undefined {
		return this.map.get(platform);
	}

	delete(platform: PlatformId): void {
		this.map.delete(platform);
	}

	has(platform: PlatformId): boolean {
		return this.map.has(platform);
	}

	all(): CapabilityDescriptor[] {
		return [...this.map.values()];
	}
}

/**
 * Assert that a descriptor can carry the given outbound content. Throws a
 * {@link CapabilityError} on the first violation. Passthrough is always allowed
 * (the adapter validates the native payload itself).
 */
export function assertSupported(descriptor: CapabilityDescriptor, content: OutboundContent): void {
	const { platform, supports } = descriptor;
	switch (content.type) {
		case 'text':
		case 'passthrough':
			return;
		case 'media': {
			const m = content.media_type as MediaType;
			if (!supports.media.includes(m)) {
				throw new CapabilityError(platform, `media type "${m}"`, `supported: [${supports.media.join(', ')}]`);
			}
			return;
		}
		case 'location':
			if (!supports.location) throw new CapabilityError(platform, 'location messages');
			return;
		case 'contact':
			if (!supports.contact) throw new CapabilityError(platform, 'contact messages');
			return;
		case 'reaction':
			if (!supports.reactions) throw new CapabilityError(platform, 'reactions');
			return;
	}
}
