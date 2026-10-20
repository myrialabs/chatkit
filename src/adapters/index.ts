/**
 * All platform adapters behind one subpath: `@myrialabs/chatkit/adapters`.
 * Each adapter still dynamically imports its heavy SDK only when used, so this
 * barrel stays cheap to load — importing it does not pull in Baileys, discord.js
 * or the Slack SDK.
 */

export {
	TelegramAdapter,
	TELEGRAM_DEFAULT_ALLOWED_UPDATES,
	type TelegramAdapterOptions,
	type TelegramBotInfo,
	type TelegramWebhookInfo,
	type TelegramSetWebhookOptions,
	type TelegramBotCommand
} from './telegram.js';
export { WhatsAppBaileysAdapter, type WhatsAppBaileysAdapterOptions } from './whatsapp.js';
export {
	WhatsAppCloudAdapter,
	type WhatsAppCloudAdapterOptions,
	type WhatsAppCloudPhoneNumber,
	type WhatsAppCloudTemplate,
	type WhatsAppCloudTemplateDraft
} from './whatsapp-cloud.js';
export {
	DiscordAdapter,
	type DiscordAdapterOptions,
	type DiscordBotInfo,
	type DiscordCommand,
	type DiscordInteraction,
	type DiscordInteractionResponse
} from './discord.js';
export { SlackAdapter, slackTeamId, type SlackAdapterOptions, type SlackAuthInfo } from './slack.js';
