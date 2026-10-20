/**
 * `@myrialabs/chatkit` — one unified, typed API to receive and send messages
 * across Telegram, WhatsApp (Baileys & Cloud), Discord and Slack.
 *
 * ```ts
 * import { ChatKit } from '@myrialabs/chatkit';
 * import { TelegramAdapter } from '@myrialabs/chatkit/adapters';
 *
 * const chat = new ChatKit();
 * chat.use(new TelegramAdapter({ token, account: 'bot:myshop' }));
 * chat.on('message', (m) => console.log(m.content));
 * await chat.start();
 * await chat.send({ to, content: text('hi') });
 * ```
 *
 * Adapters live behind one subpath, `@myrialabs/chatkit/adapters` (each still
 * dynamically imports its heavy SDK only when used). Pure verification is at
 * `/verify`, framework webhooks at `/middleware`, and the state/media ports at
 * `/store` and `/media`.
 */

// Core class & options.
export { ChatKit, type ChatKitOptions, type ChatKitErrorEvent, type AccountHealth } from './chatkit.js';

// Envelope, content builders, ids & reversible refs.
export {
	inbound,
	parseMessage,
	newId,
	messageKey,
	inboundKey,
	encodeRef,
	decodeRef,
	text,
	richText,
	rt,
	media,
	location,
	contact,
	reaction,
	passthrough,
	reply,
	type InboundInit,
	type NativeRef
} from './envelope.js';

// Universal rich-text renderers (runs → native markup / entities).
export {
	plainText,
	renderTelegramEntities,
	renderDiscord,
	renderSlackMrkdwn,
	renderWhatsApp,
	telegramEntitiesToRuns,
	type TelegramEntity
} from './format.js';

// Addressing helpers.
export {
	address,
	participant,
	accountKey,
	addressAccountKey,
	conversationKey,
	sameConversation
} from './address.js';

// Capability descriptors & gating.
export {
	capabilities,
	emptySupport,
	assertSupported,
	CapabilityError,
	CapabilityRegistry
} from './capability.js';

// Logger.
export {
	noopLogger,
	consoleLogger,
	prefixedLogger,
	type Logger,
	type LogLevel,
	type LogFields
} from './logger.js';

// Adapter contracts.
export type {
	Adapter,
	WhatsAppAdapter,
	AdapterContext,
	AdapterEvents,
	Connection,
	ConnectionHealth,
	ConnectionUpdate,
	PresenceUpdate,
	MessageTarget,
	EditTarget,
	InboundRequest,
	StatusUpdate
} from './adapter.js';

// Outbound dispatcher primitives.
export { OutboundQueue, retryable, DEFAULT_RETRY, type RetryPolicy, type RateLimit, type OutboundQueueOptions } from './queue/index.js';

// Safety layer.
export {
	BaileysSafety,
	noopSafety,
	SafetyError,
	type SafetyController,
	type SafetyOptions,
	type SafetyStats,
	type GateInput,
	type Humanizers
} from './safety/index.js';

// Generic UX helper.
export { splitMessage, TEXT_LIMITS, type SplitOptions } from './adapters/util/split-message.js';

// Markdown → universal runs (what an LLM writes, rendered natively everywhere), and a run-aware splitter.
export { markdownToRuns, inlineToRuns, splitRuns } from './markdown.js';

// Per-platform typed builders for rich / interactive messages. The full surface —
// embeds, Block Kit, reply keyboards, Flows, templates — lives at the
// `@myrialabs/chatkit/interactive` subpath; the common builders are re-exported here.
export {
	fragment,
	toRows,
	telegramButtons,
	telegramEditMessage,
	TELEGRAM_CALLBACK_DATA_MAX_BYTES,
	telegramReplyKeyboard,
	telegramRemoveKeyboard,
	telegramForceReply,
	telegramMediaGroup,
	telegramPoll,
	telegramDice,
	telegramVenue,
	telegramLinkPreview,
	discordButtons,
	discordSelect,
	discordEmbed,
	discordEmbeds,
	discordMessage,
	discordPoll,
	slack,
	slackBlocks,
	slackButtons,
	slackMessage,
	whatsappCloudButtons,
	whatsappCloudList,
	whatsappCloudCtaUrl,
	whatsappCloudLocationRequest,
	whatsappCloudFlow,
	whatsappCloudProduct,
	whatsappCloudProductList,
	whatsappCloudTemplate,
	whatsappCloudCarousel,
	waTemplate,
	whatsappBaileysPoll,
	whatsappBaileysContacts,
	whatsappBaileysLocation,
	whatsappBaileysEvent,
	type Button,
	type ButtonRows,
	type InteractiveFragment,
	type ListRow,
	type ListSection,
	type TelegramButton,
	type TelegramButtonRows,
	type TelegramKeyboardButton,
	type TelegramReplyKeyboardOptions,
	type TelegramMediaGroupItem,
	type TelegramPollOptions,
	type TelegramLinkPreviewOptions,
	type DiscordButton,
	type DiscordSelectInput,
	type DiscordSelectOption,
	type DiscordEmbedInput,
	type DiscordAllowedMentions,
	type SlackOption,
	type CloudChrome
} from './interactive/index.js';

// All shared schema types & zod schemas.
export * from './schema.js';
