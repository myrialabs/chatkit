import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
	plugins: [svelte()],
	server: {
		// The site reads docs/**/*.md and examples/**/README.md raw from the
		// repo root, one level above this package.
		fs: { allow: ['..'] },
		allowedHosts: ['.trycloudflare.com']
	},
	build: {
		outDir: 'dist',
		emptyOutDir: true,
		chunkSizeWarningLimit: 1200
	}
});
