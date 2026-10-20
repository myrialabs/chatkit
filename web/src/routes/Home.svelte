<script lang="ts">
	import { navigate } from '../lib/router.svelte.js';
	import { reveal } from '../lib/reveal.js';
	import CodeWindow from '../components/CodeWindow.svelte';

	const heroCode = `import { ChatKit, text } from '@myrialabs/chatkit';
import { TelegramAdapter } from '@myrialabs/chatkit/adapters';

const chat = new ChatKit();
chat.use(new TelegramAdapter({ token, account: 'bot:myshop' }));

chat.on('message', (m) =>
  chat.send({ to: m.address, content: text('got it 👍') }));

await chat.start();   // same code for WhatsApp, Discord, Slack`;

	const platformBadges = [
		{ label: 'Telegram', color: '#26a5e4' },
		{ label: 'WhatsApp · Baileys', color: '#25d366' },
		{ label: 'WhatsApp · Cloud API', color: '#128c7e' },
		{ label: 'Discord', color: '#5865f2' },
		{ label: 'Slack', color: '#4a154b' }
	];

	const timeline = [
		{
			title: 'One envelope, four very different platforms',
			body: 'Inbound events from a persistent WebSocket (Baileys, Discord, Slack Socket Mode) or a signed webhook (Telegram, WhatsApp Cloud, Slack Events) all normalise to the same UniversalMessage. send() takes the matching shape back — the same handler runs unmodified on every platform.',
			file: 'receive.ts',
			code: `chat.use(new DiscordAdapter({ token }));
chat.use(new SlackAdapter({ botToken, appToken, socketMode: true }));

chat.on('message', (m) => {
  if (m.content.type === 'text')
    handle(m.from, m.content.text);
});

await chat.start();`
		},
		{
			title: 'Honest capabilities, gated automatically',
			body: "chat.capabilities(platform) tells you exactly what's real — media types, threads, buttons, editing. send() is gated by it, so asking a platform for something it can't do throws a clear CapabilityError instead of silently dropping your message.",
			file: 'capabilities.ts',
			code: `try {
  await chat.send({ to, content: location(lat, lng) });
} catch (e) {
  if (e instanceof CapabilityError) {
    console.log(\`\${e.platform} can't do this: \${e.feature}\`);
  }
}`
		},
		{
			title: 'Two WhatsApp paths, one interface',
			body: 'Baileys (free, self-hosted, real ban risk) and the official Cloud API both implement WhatsAppAdapter. Start on Baileys, move to Cloud when you need stability, or run both — one per number — without your send/receive code ever knowing which one it is.',
			file: 'whatsapp.ts',
			code: `const wa: WhatsAppAdapter = official
  ? new WhatsAppCloudAdapter({ account, phoneNumberId, token })
  : new WhatsAppBaileysAdapter({ account });

chat.use(wa);   // your code is identical either way`
		},
		{
			title: "A WhatsApp safety layer that's actually on",
			body: 'Baileys is unofficial — bans are real. The safety layer is mandatory, not opt-in: a 24-hour session window, typing simulation, read receipts, presence management, Gaussian-jittered throttling, a warming guard and reconnect backoff, all on by default.',
			file: 'safety.ts',
			code: `chat.use(new WhatsAppBaileysAdapter({
  account: 'wa:6281234567890',
  warmupUntil: Date.now() + 7 * 864e5,  // restrict cold sends for 7 days
  onQR: (qr) => renderQrSomehow(qr)
}));
// throttle + jitter + typing + read receipts: on by default`
		}
	];

	const features = [
		{
			title: 'Interactive & passthrough',
			desc: 'Typed builders for buttons, lists, embeds and Block Kit per platform; presses come back as one universal postback. Or drop into platform_meta for raw native richness.'
		},
		{
			title: 'Secure by construction',
			desc: 'Pure, constant-time inbound verifiers for every platform family (HMAC, secret token, Ed25519), AES-256-GCM at-rest encryption for auth state, never a credential in the logs.'
		},
		{
			title: 'No infra required',
			desc: 'In-memory and SQLite for state, in-memory and filesystem for media — no Postgres, Redis or S3. The backends are ports; bring your own when you outgrow the defaults.'
		},
		{
			title: 'In-process dispatcher',
			desc: 'Outbound is ordered per account, rate-limited per platform, and retried with backoff — with end-to-end idempotency via an idempotency_key. No external broker.'
		},
		{
			title: 'Webhooks made easy',
			desc: 'Pure verify functions, plus drop-in handlers for Hono, Express, Fastify and Elysia that verify, answer handshakes, and route — all in one line.'
		},
		{
			title: 'Rich text, universally',
			desc: 'A text message can carry an optional rich array of styled runs; every adapter renders it to native markup. Unsupported marks degrade gracefully — formatting never throws.'
		}
	];

	function goDocs(): void {
		navigate('/docs/getting-started/quickstart');
	}
</script>

<div class="glow-orb glow-orb-1"></div>
<div class="glow-orb glow-orb-2"></div>
<div class="glow-orb glow-orb-3"></div>

<!-- HERO -->
<section class="hero">
	<div class="container">
		<div class="hero-badge">Open Source &middot; One Envelope &middot; TypeScript</div>
		<h1>Every chat platform.<br /><span class="grad-text">One API.</span></h1>
		<p class="hero-desc">
			Receive and send messages across Telegram, WhatsApp (Baileys &amp; Cloud API),
			Discord and Slack through one typed API — a <strong>universal message envelope</strong>,
			honest capability descriptors, and a built-in <strong>WhatsApp safety layer</strong>.
			A library you embed, on Node 22.13+ and Bun.
		</p>
		<div class="platform-badges">
			{#each platformBadges as p (p.label)}
				<span class="platform-badge"><span class="platform-dot" style="background:{p.color}"></span>{p.label}</span>
			{/each}
		</div>
		<div class="hero-cta">
			<button class="btn-primary" onclick={goDocs}>
				<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2v8M5 7l3 3 3-3M2 12h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
				Get Started
			</button>
			<a href="https://github.com/myrialabs/chatkit" class="btn-secondary">
				<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" /></svg>
				View on GitHub
			</a>
		</div>
		<div class="hero-mockup-wrap">
			<CodeWindow title="quick-start.ts" code={heroCode} lang="typescript" />
		</div>
	</div>
</section>

<!-- TIMELINE -->
<section id="showcase" class="timeline-section">
	<div class="container">
		<div class="section-header">
			<div class="section-tag">See It In Action</div>
			<h2 class="section-title">Four platforms,<br /><span class="grad-text">one honest core</span></h2>
		</div>

		<div class="timeline">
			{#each timeline as row, i (row.title)}
				<div class="timeline-row" use:reveal={{ delay: (i % 3) * 100 }}>
					<div class="timeline-marker">
						<div class="dot"></div>
						{#if i < timeline.length - 1}<div class="line"></div>{/if}
					</div>
					<div class="timeline-content">
						<div class="timeline-text">
							<h3>{row.title}</h3>
							<p>{row.body}</p>
						</div>
						<div class="timeline-code">
							<CodeWindow title={row.file} code={row.code} lang="typescript" />
						</div>
					</div>
				</div>
			{/each}
		</div>
	</div>
</section>

<!-- FEATURES -->
<section id="features" class="features-section">
	<div class="container">
		<div class="section-header">
			<div class="section-tag">Everything Else</div>
			<h2 class="section-title">The rest of the<br /><span class="grad-text">typed surface</span></h2>
		</div>
		<div class="features-grid">
			{#each features as f, i (f.title)}
				<div class="feature-card" use:reveal={{ delay: (i % 3) * 60 }}>
					<div class="feature-title">{f.title}</div>
					<div class="feature-desc">{f.desc}</div>
				</div>
			{/each}
		</div>
	</div>
</section>

<!-- INSTALL + CTA -->
<section id="install" class="install-section">
	<div class="container">
		<div class="section-header">
			<div class="section-tag">Installation</div>
			<h2 class="section-title">Install &amp; <span class="grad-text">start chatting</span></h2>
			<p class="section-desc">Requires Node.js 22.13+ or Bun 1.1+. Platform SDKs load dynamically — you only pull in the adapters you use.</p>
		</div>
		<CodeWindow title="terminal" lang="bash" code={`$ npm install @myrialabs/chatkit
$ npm install -g @myrialabs/chatkit   # optional: the chatkit CLI

> chat.on('message', m => chat.send({ to: m.address, content: text('hi') }))`} />
		<p class="install-footnote">
			Operating WhatsApp? <code>npm install -g @myrialabs/chatkit</code> &middot; then
			<code>chatkit pair --account wa:62…</code>
		</p>
		<div class="install-cta">
			<button class="btn-primary" onclick={goDocs}>Read the docs</button>
			<a href="https://github.com/myrialabs/chatkit" class="btn-secondary">Star on GitHub</a>
		</div>
	</div>
</section>

<style>
	.hero {
		min-height: 100vh;
		display: flex; flex-direction: column;
		align-items: center; justify-content: center;
		text-align: center;
		padding: 120px 24px 80px;
		position: relative;
	}
	.hero-badge {
		display: inline-flex; align-items: center; gap: 8px;
		background: rgba(99, 102, 241, 0.1);
		border: 1px solid rgba(99, 102, 241, 0.3);
		border-radius: 100px;
		padding: 6px 16px;
		font-size: 12px; font-weight: 500;
		color: var(--accent-2);
		margin-bottom: 32px;
		letter-spacing: 0.5px;
		text-transform: uppercase;
	}
	.hero h1 { font-size: clamp(42px, 7vw, 80px); font-weight: 700; line-height: 1.08; letter-spacing: -2px; margin-bottom: 24px; max-width: 900px; margin-left: auto; margin-right: auto; }
	.hero-desc { font-size: clamp(16px, 2vw, 20px); color: var(--text-1); max-width: 680px; margin: 0 auto 28px; line-height: 1.7; text-align: center; }
	.hero-desc strong { color: var(--text-0); font-weight: 600; }

	.platform-badges { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; max-width: 660px; margin: 0 auto 40px; }
	.platform-badge {
		display: inline-flex; align-items: center; gap: 7px;
		font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--text-1);
		background: var(--bg-2); border: 1px solid var(--border); border-radius: 100px; padding: 5px 12px 5px 10px;
	}
	.platform-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }

	.hero-cta { display: flex; gap: 14px; flex-wrap: wrap; justify-content: center; margin-bottom: 64px; }
	.hero-mockup-wrap { width: 100%; max-width: 880px; position: relative; min-width: 0; margin: 0 auto; }

	/* ---- TIMELINE ---- */
	.timeline-section { padding: 0 0 100px; }
	.timeline { display: flex; flex-direction: column; }
	.timeline-row { display: flex; gap: 24px; }
	.timeline-marker { width: 20px; flex-shrink: 0; display: flex; flex-direction: column; align-items: center; }
	.dot { width: 14px; height: 14px; border-radius: 50%; background: var(--accent-1); box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.15); flex-shrink: 0; margin-top: 6px; }
	.line { width: 2px; flex: 1; background: var(--border-bright); margin: 4px 0; min-height: 40px; }
	.timeline-content { flex: 1; min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 40px; align-items: start; padding-bottom: 56px; }
	.timeline-text { min-width: 0; }
	.timeline-text h3 { font-size: 24px; font-weight: 700; letter-spacing: -0.5px; margin-bottom: 14px; }
	.timeline-text p { font-size: 15px; color: var(--text-1); line-height: 1.7; }
	.timeline-code { min-width: 0; }

	/* ---- FEATURES ---- */
	.features-section { padding: 0 0 100px; }
	.features-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
	.feature-card {
		background: var(--bg-1); border: 1px solid var(--border); border-radius: 16px;
		padding: 24px; transition: border-color 0.25s, background 0.25s; min-width: 0;
	}
	.feature-card:hover { border-color: rgba(99, 102, 241, 0.38); background: var(--bg-2); }
	.feature-title { font-size: 15px; font-weight: 600; margin-bottom: 8px; }
	.feature-desc { font-size: 13px; color: var(--text-1); line-height: 1.65; }

	/* ---- INSTALL + CTA ---- */
	.install-section { padding: 0 0 120px; }
	.install-section .container { max-width: 780px; }
	.install-footnote { text-align: center; margin-top: 24px; font-size: 14px; color: var(--text-2); }
	.install-footnote code { color: var(--accent-2); font-family: 'JetBrains Mono', monospace; font-size: 13px; }
	.install-cta { display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; margin-top: 40px; }

	@media (max-width: 900px) {
		.features-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
		.timeline-content { grid-template-columns: minmax(0, 1fr); gap: 20px; }
	}
	@media (max-width: 640px) {
		.hero { padding: 110px 16px 60px; }
		.hero h1 { font-size: 36px; letter-spacing: -1px; }
		.features-grid { grid-template-columns: minmax(0, 1fr); }
		.timeline-row { gap: 14px; }
	}
</style>
