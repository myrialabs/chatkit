<script lang="ts">
	import { navigate } from '../lib/router.svelte.js';
</script>

<footer>
	<div class="container">
		<div class="footer-inner">
			<div class="footer-brand">
				<span class="nav-logo-icon"><img src="/favicon.svg" alt="" width="28" height="28" /></span>
				<span class="footer-brand-name">ChatKit</span>
			</div>
			<div class="footer-links-row">
				<a href="/docs" onclick={(e) => { e.preventDefault(); navigate('/docs'); }}>Docs</a>
				<a href="/docs/examples" onclick={(e) => { e.preventDefault(); navigate('/docs/examples'); }}>Examples</a>
				<a href="https://github.com/myrialabs/chatkit">GitHub</a>
				<a href="https://www.npmjs.com/package/@myrialabs/chatkit">npm</a>
				<a href="https://github.com/myrialabs/chatkit/issues">Issues</a>
				<a href="https://github.com/myrialabs/chatkit/blob/main/LICENSE">License</a>
			</div>
		</div>
		<div class="footer-bottom">
			<div class="footer-bottom-text">&copy; 2026 MyriaLabs. Open source under MIT License.</div>
			<div class="footer-tagline">// one api, every conversation</div>
		</div>
	</div>
</footer>

<style>
	footer { border-top: 1px solid var(--border); padding: 40px 0 32px; }
	.footer-inner { display: flex; justify-content: space-between; align-items: center; gap: 24px; flex-wrap: wrap; margin-bottom: 28px; }
	.footer-brand { display: flex; align-items: center; gap: 10px; }
	.footer-brand-name { font-size: 16px; font-weight: 700; }
	.nav-logo-icon { width: 28px; height: 28px; border-radius: 8px; overflow: hidden; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
	.nav-logo-icon img { width: 100%; height: 100%; display: block; }
	.footer-links-row { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
	.footer-links-row a { color: var(--text-2); text-decoration: none; font-size: 14px; padding: 6px 12px; border-radius: 8px; transition: color 0.2s; }
	.footer-links-row a:hover { color: var(--text-1); }
	.footer-bottom { display: flex; justify-content: space-between; align-items: center; padding-top: 20px; border-top: 1px solid var(--border); flex-wrap: wrap; gap: 12px; }
	.footer-bottom-text { font-size: 13px; color: var(--text-2); }
	.footer-tagline { font-size: 12px; color: var(--text-2); font-family: 'JetBrains Mono', monospace; }

	@media (max-width: 640px) {
		.footer-inner { flex-direction: column; align-items: flex-start; }
	}
</style>
