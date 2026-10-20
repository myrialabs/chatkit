/**
 * Generic helper: split a long (optionally Markdown) message into chunks that fit
 * a platform's per-message character limit. Domain-agnostic — it knows nothing
 * about any particular consumer. Prefers to break on paragraph, then line, then
 * word boundaries, and keeps fenced code blocks (```) balanced across chunks.
 */

/** Well-known per-message text limits, for convenience. */
export const TEXT_LIMITS = {
	telegram: 4096,
	whatsapp_baileys: 65536,
	whatsapp_cloud: 4096,
	discord: 2000,
	slack: 40000
} as const;

export interface SplitOptions {
	/** Max characters per chunk. */
	limit: number;
	/** Keep fenced code blocks balanced when splitting. Default `true`. */
	preserveCodeFences?: boolean;
}

/** True if `text` opens an odd number of ``` fences (i.e. ends mid-block). */
function endsInsideFence(text: string): boolean {
	const fences = text.match(/```/g);
	return fences ? fences.length % 2 === 1 : false;
}

/**
 * Split `text` into chunks no longer than `limit`. Returns at least one chunk.
 * A single token longer than `limit` is hard-split as a last resort. When fence
 * preservation is on, a chunk that ends inside a code block is closed with
 * ```` ``` ```` and the next chunk reopens it.
 */
export function splitMessage(text: string, options: SplitOptions): string[] {
	const { limit } = options;
	const preserveFences = options.preserveCodeFences ?? true;
	if (limit <= 0) throw new Error('split limit must be positive');
	if (text.length <= limit) return [text];

	// Reserve room for the ``` reopen/close markers we may insert (only when the
	// limit is large enough to make fence preservation meaningful).
	const reserve = preserveFences && limit > 8;
	const budget = reserve ? limit - 4 : limit;
	const pieces = atomicPieces(text, budget);

	const chunks: string[] = [];
	let current = '';
	let reopenFence = false;

	const flush = () => {
		if (!current) return;
		let chunk = current;
		const insideFence = reserve && endsInsideFence((reopenFence ? '```\n' : '') + chunk);
		if (reopenFence) chunk = '```\n' + chunk;
		if (insideFence) chunk = chunk + '\n```';
		chunks.push(chunk);
		reopenFence = insideFence;
		current = '';
	};

	for (const piece of pieces) {
		const prefixLen = reopenFence ? 4 : 0;
		if (current.length + piece.length + prefixLen > limit) flush();
		current += piece;
	}
	flush();
	return chunks;
}

/** Break text into the smallest pieces (paragraph→line→word→char) that fit `limit`. */
function atomicPieces(text: string, limit: number): string[] {
	const out: string[] = [];
	for (const para of splitKeepingDelimiter(text, '\n\n')) {
		if (para.length <= limit) {
			out.push(para);
			continue;
		}
		for (const line of splitKeepingDelimiter(para, '\n')) {
			if (line.length <= limit) {
				out.push(line);
				continue;
			}
			for (const word of splitKeepingDelimiter(line, ' ')) {
				if (word.length <= limit) {
					out.push(word);
				} else {
					for (let i = 0; i < word.length; i += limit) out.push(word.slice(i, i + limit));
				}
			}
		}
	}
	return out;
}

/** Split on a delimiter but keep the delimiter attached to each piece. */
function splitKeepingDelimiter(text: string, delimiter: string): string[] {
	const parts = text.split(delimiter);
	const out: string[] = [];
	for (let i = 0; i < parts.length; i++) {
		const piece = i < parts.length - 1 ? parts[i]! + delimiter : parts[i]!;
		if (piece.length > 0) out.push(piece);
	}
	return out;
}
