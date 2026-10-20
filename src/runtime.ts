/**
 * Runtime guard. ChatKit supports Node >= 22.13 and Bun >= 1.1. Both floors come
 * from the built-in SQLite the persistent store relies on, so no native driver is
 * installed: `node:sqlite` is only available without a flag from Node 22.13, and
 * Bun 1.0.x's `bun:sqlite` cannot run a multi-statement `exec`. `engines` in package.json is only a hint
 * to the package manager, so the same floor is enforced here with a message that
 * says what to upgrade instead of a failure deep inside an SDK.
 */

export const MIN_NODE = '22.13.0';
export const MIN_BUN = '1.1.0';

function parse(version: string): [number, number, number] {
	const [major = 0, minor = 0, patch = 0] = version.split('.').map((part) => Number.parseInt(part, 10) || 0);
	return [major, minor, patch];
}

/** True when `version` (e.g. `18.2.0`) is >= `minimum`. */
export function versionAtLeast(version: string, minimum: string): boolean {
	const a = parse(version);
	const b = parse(minimum);
	for (let i = 0; i < 3; i++) {
		if (a[i]! !== b[i]!) return a[i]! > b[i]!;
	}
	return true;
}

/**
 * Throw if the running Node/Bun is older than supported. `versions` is injectable
 * for tests; by default it reads `process.versions`. Unknown runtimes (Deno,
 * edge/workers) are not blocked — only a known-too-old Node or Bun is.
 */
export function assertSupportedRuntime(versions: { node?: string; bun?: string } | undefined = globalThis.process?.versions): void {
	if (!versions) return;
	if (versions.bun) {
		if (!versionAtLeast(versions.bun, MIN_BUN)) {
			throw new Error(`ChatKit requires Bun >= ${MIN_BUN} (running ${versions.bun}). Upgrade with \`bun upgrade\`.`);
		}
		return;
	}
	if (versions.node && !versionAtLeast(versions.node, MIN_NODE)) {
		throw new Error(`ChatKit requires Node >= ${MIN_NODE} (running ${versions.node}). Upgrade Node, or run on Bun >= ${MIN_BUN}.`);
	}
}
