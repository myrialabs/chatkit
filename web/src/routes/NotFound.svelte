<script lang="ts">
	import { navigate } from '../lib/router.svelte.js';
</script>

<div class="not-found container">
	<div class="code">404</div>
	<h1>Page not found</h1>
	<p>That page doesn't exist — or moved when the docs were reorganized.</p>
	<div class="actions">
		<button class="btn-primary" onclick={() => navigate('/')}>Go home</button>
		<button class="btn-secondary" onclick={() => navigate('/docs')}>Browse docs</button>
	</div>
</div>

<style>
	.not-found {
		min-height: 70vh; display: flex; flex-direction: column;
		align-items: center; justify-content: center; text-align: center;
		padding-top: 90px;
	}
	.code { font-family: 'JetBrains Mono', monospace; font-size: 15px; color: var(--accent-2); margin-bottom: 16px; letter-spacing: 2px; }
	h1 { font-size: clamp(28px, 5vw, 44px); font-weight: 700; letter-spacing: -1px; margin-bottom: 12px; }
	p { color: var(--text-1); margin-bottom: 32px; max-width: 420px; }
	.actions { display: flex; gap: 14px; flex-wrap: wrap; justify-content: center; }
</style>
