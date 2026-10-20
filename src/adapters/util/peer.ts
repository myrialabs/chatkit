/**
 * Load a platform SDK on first use. The SDKs ship as regular dependencies but
 * are imported lazily so unused adapters never load them. If one is missing
 * anyway (pruned install, stripped bundle), say what to install rather than
 * surfacing a bare module-resolution error.
 */
export async function loadPeer(specifier: string, platform: string): Promise<any> {
	try {
		return await import(specifier);
	} catch (error) {
		const code = (error as { code?: string })?.code;
		const message = String((error as Error)?.message ?? error);
		if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND' || /Cannot find (module|package)/i.test(message)) {
			throw new Error(`The ${platform} adapter needs "${specifier}". Install it alongside ChatKit: bun add ${specifier}`);
		}
		throw error;
	}
}
