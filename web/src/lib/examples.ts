/**
 * Raw-imports examples/README.md and every snippet in examples/snippets/, so
 * the showcase page always matches what's actually in examples/ — never a
 * copy. The full inbox-app example is a whole Svelte+Elysia app, too large to
 * inline as a code panel — its README.md link stays pointed at GitHub.
 */

const readmeGlob = import.meta.glob('../../../examples/README.md', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

const sourceGlob = import.meta.glob('../../../examples/snippets/*.ts', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

const GITHUB_EXAMPLES_BASE = 'https://github.com/myrialabs/chatkit/blob/main/examples';
const GITHUB_EXAMPLES_TREE_BASE = 'https://github.com/myrialabs/chatkit/tree/main/examples';

/**
 * examples/README.md links are relative to `examples/` on GitHub, but this
 * content renders at the `/docs/examples` route — a different path, so plain
 * browser relative-URL resolution doesn't apply here (unlike doc pages, whose
 * URLs mirror their source folder 1:1). Rewrite `./snippets/foo.ts` to an
 * in-page anchor (each snippet gets its own code panel below); anything else
 * relative (`./snippets`, `./inbox-app`, `./inbox-app/README.md`) has no
 * in-page panel, so it goes to the real GitHub path instead.
 */
function linkifyReadme(raw: string): string {
	return raw
		.replace(/\]\(\.\/snippets\/([\w-]+)\.ts\)/g, (_match, name: string) => `](#example-${name})`)
		.replace(/\]\(\.\/([\w./-]+)\)/g, (match, relPath: string) => {
			const isDir = !relPath.includes('.') || relPath.endsWith('/');
			const base = isDir ? GITHUB_EXAMPLES_TREE_BASE : GITHUB_EXAMPLES_BASE;
			return `](${base}/${relPath.replace(/\/$/, '')})`;
		});
}

export const examplesReadme: string = linkifyReadme(Object.values(readmeGlob)[0] ?? '');

export interface ExampleFile {
	name: string;
	code: string;
}

export const exampleFiles: ExampleFile[] = Object.entries(sourceGlob)
	.map(([path, code]) => ({ name: path.split('/').pop()!.replace(/\.ts$/, ''), code }))
	.sort((a, b) => a.name.localeCompare(b.name));

export function findExample(name: string): ExampleFile | undefined {
	return exampleFiles.find((e) => e.name === name);
}
