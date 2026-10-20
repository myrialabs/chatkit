/**
 * Per-platform typed builders for rich / interactive messages, exported as the
 * `@myrialabs/chatkit/interactive` subpath (and re-exported from the package root).
 * ChatKit keeps its universal core small; these helpers produce
 * `platform_meta.<platform>` passthrough that the matching adapter renders natively,
 * while inbound presses/selections normalise back to a universal `postback`.
 *
 * ```ts
 * import { telegramButtons } from '@myrialabs/chatkit/interactive';
 * chat.send({ to, ...telegramButtons('Pick one', [[{ text: 'A', data: 'a' }, { text: 'B', data: 'b' }]]) });
 * chat.on('message', (m) => { if (m.content.type === 'postback') handle(m.content.data); });
 * ```
 */

export { fragment, toRows, type Button, type ButtonRows, type InteractiveFragment, type ListRow, type ListSection } from './shared.js';

export {
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
	type TelegramButton,
	type TelegramButtonRows,
	type TelegramKeyboardButton,
	type TelegramReplyKeyboardOptions,
	type TelegramMediaGroupItem,
	type TelegramPollOptions,
	type TelegramLinkPreviewOptions
} from './telegram.js';

export {
	discordButtons,
	discordSelect,
	discordEmbed,
	discordEmbeds,
	discordMessage,
	discordPoll,
	type DiscordButton,
	type DiscordSelectInput,
	type DiscordSelectOption,
	type DiscordEmbedInput,
	type DiscordAllowedMentions
} from './discord.js';

export { slack, slackBlocks, slackButtons, slackMessage, type SlackOption } from './slack.js';

export {
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
	type CloudChrome
} from './whatsapp-cloud.js';

export {
	whatsappBaileysPoll,
	whatsappBaileysContacts,
	whatsappBaileysLocation,
	whatsappBaileysEvent
} from './whatsapp.js';
