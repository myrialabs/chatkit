<script lang="ts">
	import { navigate } from '../lib/router.svelte.js';

	let mobileOpen = $state(false);

	function go(to: string): void {
		mobileOpen = false;
		navigate(to);
	}
</script>

<nav>
	<div class="nav-inner container">
		<a href="/" class="nav-logo" onclick={(e) => { e.preventDefault(); go('/'); }}>
			<span class="nav-logo-icon"><img src="/favicon.svg" alt="" width="32" height="32" /></span>
			ChatKit
		</a>
		<div class="nav-links">
			<a href="/docs" onclick={(e) => { e.preventDefault(); go('/docs'); }}>Docs</a>
			<a href="/docs/examples" onclick={(e) => { e.preventDefault(); go('/docs/examples'); }}>Examples</a>
			<a href="https://github.com/myrialabs/chatkit" class="btn-nav">GitHub &rarr;</a>
		</div>
		<button class="nav-hamburger" aria-label="Toggle menu" onclick={() => (mobileOpen = !mobileOpen)}>
			<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
				<line x1="2" y1="5" x2="18" y2="5" /><line x1="2" y1="10" x2="18" y2="10" /><line x1="2" y1="15" x2="18" y2="15" />
			</svg>
		</button>
	</div>
	{#if mobileOpen}
		<div class="nav-mobile-menu">
			<a href="/docs" onclick={(e) => { e.preventDefault(); go('/docs'); }}>Docs</a>
			<a href="/docs/examples" onclick={(e) => { e.preventDefault(); go('/docs/examples'); }}>Examples</a>
			<a href="https://github.com/myrialabs/chatkit">GitHub &rarr;</a>
		</div>
	{/if}
</nav>

<style>
	nav {
		position: fixed; top: 0; left: 0; right: 0; z-index: 100;
		padding: 14px 0;
		background: rgba(6, 6, 8, 0.75);
		backdrop-filter: blur(20px);
		border-bottom: 1px solid var(--border);
	}
	.nav-inner { display: flex; align-items: center; justify-content: space-between; }
	.nav-logo {
		display: flex; align-items: center; gap: 10px;
		font-size: 18px; font-weight: 700; color: var(--text-0);
		text-decoration: none; letter-spacing: -0.3px;
	}
	.nav-logo-icon { width: 32px; height: 32px; border-radius: 8px; overflow: hidden; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
	.nav-logo-icon img { width: 100%; height: 100%; display: block; }
	.nav-links { display: flex; align-items: center; gap: 8px; }
	.nav-links a { color: var(--text-1); text-decoration: none; font-size: 14px; font-weight: 500; padding: 7px 14px; border-radius: 8px; transition: all 0.2s; }
	.nav-links a:hover { color: var(--text-0); background: var(--bg-3); }
	:global(.btn-nav) {
		padding: 8px 18px !important;
		background: linear-gradient(135deg, var(--accent-1), var(--accent-dark)) !important;
		color: white !important;
		border-radius: 8px;
	}
	:global(.btn-nav:hover) { opacity: 0.9; transform: translateY(-1px); box-shadow: 0 4px 20px var(--accent-glow); }

	.nav-hamburger {
		display: none; background: none; border: none; color: var(--text-0);
		cursor: pointer; padding: 8px;
	}
	.nav-mobile-menu {
		display: none;
	}

	@media (max-width: 640px) {
		.nav-links { display: none; }
		.nav-hamburger { display: flex; }
		.nav-mobile-menu {
			display: flex; flex-direction: column; gap: 4px;
			padding: 12px 16px 16px;
			border-top: 1px solid var(--border);
		}
		.nav-mobile-menu a {
			color: var(--text-1); text-decoration: none; font-size: 15px; font-weight: 500;
			padding: 10px 12px; border-radius: 8px;
		}
		.nav-mobile-menu a:hover { background: var(--bg-3); color: var(--text-0); }
	}
</style>
