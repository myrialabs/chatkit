import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

// The Elysia API runs on :3000; Vite serves the client on :5173 and proxies the
// API, media and SSE stream through so the browser sees one origin.
const API = 'http://localhost:3000';

export default defineConfig({
	plugins: [svelte(), tailwindcss()],
	server: {
		port: 5173,
		proxy: {
			'/api': API,
			'/media': API,
			'/webhook': API,
			'/events': { target: API, changeOrigin: true }
		}
	},
	build: { outDir: 'dist/client', emptyOutDir: true }
});
