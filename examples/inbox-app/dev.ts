/**
 * Dev launcher: runs the Elysia API (watch) and the Vite client together, so
 * `bun run dev` is the single command. Bun auto-loads `.env` into both.
 */

export {};

const procs = [
	Bun.spawn(['bun', '--watch', 'server/index.ts'], { stdio: ['inherit', 'inherit', 'inherit'] }),
	Bun.spawn(['bunx', 'vite'], { stdio: ['inherit', 'inherit', 'inherit'] })
];

function shutdown(): void {
	for (const p of procs) p.kill();
	process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await Promise.all(procs.map((p) => p.exited));
