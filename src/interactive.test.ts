import { test, expect, describe } from 'bun:test';
import {
	telegramButtons,
	telegramReplyKeyboard,
	telegramMediaGroup,
	telegramPoll,
	slackButtons,
	slack,
	discordButtons,
	discordEmbeds,
	discordSelect,
	whatsappCloudButtons,
	whatsappCloudList,
	whatsappCloudCtaUrl,
	whatsappCloudFlow,
	whatsappCloudTemplate,
	waTemplate,
	whatsappBaileysPoll,
	whatsappBaileysContacts,
	whatsappBaileysLocation
} from './interactive/index.js';

describe('interactive builders', () => {
	test('telegramButtons builds an inline keyboard passthrough', () => {
		const f = telegramButtons('Pick', [[{ text: 'A', data: 'a' }, { text: 'B', data: 'b' }]]);
		expect(f.content).toEqual({ type: 'passthrough' });
		const params = (f.platform_meta.telegram as any).params;
		expect(params.text).toBe('Pick');
		expect(params.reply_markup.inline_keyboard[0]).toEqual([
			{ text: 'A', callback_data: 'a' },
			{ text: 'B', callback_data: 'b' }
		]);
	});

	test('flat button list becomes single-column rows', () => {
		const f = telegramButtons('x', [{ text: 'A', data: 'a' }, { text: 'B', data: 'b' }]);
		const kb = (f.platform_meta.telegram as any).params.reply_markup.inline_keyboard;
		expect(kb).toHaveLength(2);
		expect(kb[0]).toHaveLength(1);
	});

	test('slackButtons emits actions block with values', () => {
		const f = slackButtons('Choose', [{ text: 'Yes', data: 'yes' }]);
		const blocks = (f.platform_meta.slack as any).blocks;
		expect(blocks[1].type).toBe('actions');
		expect(blocks[1].elements[0].value).toBe('yes');
	});

	test('discordButtons emits an action row', () => {
		const f = discordButtons('Choose', [{ text: 'Yes', data: 'yes' }]);
		const components = (f.platform_meta.discord as any).components;
		expect(components[0].type).toBe(1);
		expect(components[0].components[0].custom_id).toBe('yes');
	});

	test('whatsappCloudButtons caps at three reply buttons', () => {
		const f = whatsappCloudButtons('Body', [
			{ text: '1', data: 'a' },
			{ text: '2', data: 'b' },
			{ text: '3', data: 'c' },
			{ text: '4', data: 'd' }
		]);
		const buttons = (f.platform_meta.whatsapp_cloud as any).interactive.action.buttons;
		expect(buttons).toHaveLength(3);
		expect(buttons[0].reply.id).toBe('a');
	});

	test('whatsappCloudList builds a list interactive', () => {
		const f = whatsappCloudList('Body', 'Open', [{ title: 'S', rows: [{ id: 'r1', title: 'Row 1' }] }]);
		const interactive = (f.platform_meta.whatsapp_cloud as any).interactive;
		expect(interactive.type).toBe('list');
		expect(interactive.action.button).toBe('Open');
	});
});

describe('extended interactive builders', () => {
	test('telegram inline buttons support url / web_app / copy_text', () => {
		const f = telegramButtons('x', [[{ text: 'Link', url: 'https://x.io' }, { text: 'App', webApp: 'https://app.io' }, { text: 'Copy', copyText: 'CODE' }]]);
		const kb = (f.platform_meta.telegram as any).params.reply_markup.inline_keyboard[0];
		expect(kb[0]).toEqual({ text: 'Link', url: 'https://x.io' });
		expect(kb[1]).toEqual({ text: 'App', web_app: { url: 'https://app.io' } });
		expect(kb[2]).toEqual({ text: 'Copy', copy_text: { text: 'CODE' } });
	});

	test('telegramReplyKeyboard sets request flags and options', () => {
		const f = telegramReplyKeyboard('x', [[{ text: 'Share', requestContact: true }]], { resize: true, oneTime: true });
		const rm = (f.platform_meta.telegram as any).params.reply_markup;
		expect(rm.keyboard[0][0]).toEqual({ text: 'Share', request_contact: true });
		expect(rm.resize_keyboard).toBe(true);
		expect(rm.one_time_keyboard).toBe(true);
	});

	test('telegramMediaGroup and telegramPoll pick the right method', () => {
		expect((telegramMediaGroup([{ type: 'photo', media: 'https://x/1.jpg' }]).platform_meta.telegram as any).method).toBe('sendMediaGroup');
		const poll = telegramPoll('Q?', ['a', 'b'], { type: 'quiz', correctOptionId: 1 });
		const params = (poll.platform_meta.telegram as any).params;
		expect(params.type).toBe('quiz');
		expect(params.correct_option_id).toBe(1);
	});

	test('discordButtons honour styles and link buttons', () => {
		const f = discordButtons('x', [{ text: 'Danger', data: 'd', style: 'danger' }, { text: 'Site', url: 'https://x.io' }]);
		const comps = (f.platform_meta.discord as any).components[0].components;
		expect(comps[0]).toMatchObject({ style: 4, custom_id: 'd' });
		expect(comps[1]).toMatchObject({ style: 5, url: 'https://x.io' });
	});

	test('discordEmbeds builds an embed payload', () => {
		const f = discordEmbeds({ title: 'T', color: 0x5865f2, fields: [{ name: 'a', value: 'b' }] }, { text: 'hi' });
		const meta = f.platform_meta.discord as any;
		expect(meta.content).toBe('hi');
		expect(meta.embeds[0]).toMatchObject({ title: 'T', color: 0x5865f2 });
		expect(meta.embeds[0].fields[0]).toEqual({ name: 'a', value: 'b', inline: false });
	});

	test('discordSelect emits a select menu action row', () => {
		const f = discordSelect('Pick', { data: 'sel', type: 'string', options: [{ label: 'A', value: 'a' }] });
		const sel = (f.platform_meta.discord as any).components[0].components[0];
		expect(sel).toMatchObject({ type: 3, custom_id: 'sel' });
		expect(sel.options[0]).toMatchObject({ label: 'A', value: 'a' });
	});

	test('slack namespace composes blocks', () => {
		const f = slack.message('fallback', [slack.header('Title'), slack.section('*hi*', { accessory: slack.button({ text: 'Go', data: 'go' }) }), slack.divider()]);
		const blocks = (f.platform_meta.slack as any).blocks;
		expect(blocks[0].type).toBe('header');
		expect(blocks[1].accessory).toMatchObject({ type: 'button', value: 'go' });
		expect(blocks[2].type).toBe('divider');
	});

	test('slackButtons carry style', () => {
		const f = slackButtons('x', [{ text: 'Del', data: 'del', style: 'danger' }]);
		expect((f.platform_meta.slack as any).blocks[1].elements[0].style).toBe('danger');
	});

	test('whatsappCloudCtaUrl builds a cta_url interactive', () => {
		const f = whatsappCloudCtaUrl('Body', 'Visit', 'https://x.io', { headerText: 'H', footer: 'F' });
		const i = (f.platform_meta.whatsapp_cloud as any).interactive;
		expect(i.type).toBe('cta_url');
		expect(i.action.parameters).toEqual({ display_text: 'Visit', url: 'https://x.io' });
		expect(i.header).toEqual({ type: 'text', text: 'H' });
		expect(i.footer).toEqual({ text: 'F' });
	});

	test('whatsappCloudFlow builds a flow interactive', () => {
		const f = whatsappCloudFlow('Body', { flowId: 'F1', flowToken: 'tok', ctaText: 'Start' });
		const params = (f.platform_meta.whatsapp_cloud as any).interactive.action.parameters;
		expect(params.flow_id).toBe('F1');
		expect(params.flow_token).toBe('tok');
	});

	test('whatsappCloudTemplate assembles typed components', () => {
		const f = whatsappCloudTemplate('welcome', 'en_US', [waTemplate.body('Andi'), waTemplate.quickReply(0, 'YES')]);
		const t = (f.platform_meta.whatsapp_cloud as any).template;
		expect(t.name).toBe('welcome');
		expect(t.components[0]).toEqual({ type: 'body', parameters: [{ type: 'text', text: 'Andi' }] });
		expect(t.components[1]).toMatchObject({ type: 'button', sub_type: 'quick_reply', index: 0 });
	});

	test('whatsappBaileysPoll builds a poll payload', () => {
		const f = whatsappBaileysPoll('Lunch?', ['Sate', 'Bakso'], { selectableCount: 1 });
		expect((f.platform_meta.whatsapp_baileys as any).poll).toEqual({ name: 'Lunch?', values: ['Sate', 'Bakso'], selectableCount: 1 });
	});

	test('whatsappBaileysContacts and Location build native content', () => {
		const c = whatsappBaileysContacts([{ name: 'Andi', phone: '628123' }]);
		expect((c.platform_meta.whatsapp_baileys as any).contacts.contacts[0].vcard).toContain('waid=628123');
		const l = whatsappBaileysLocation(-6.2, 106.8, { name: 'HQ', address: 'Jakarta' });
		expect((l.platform_meta.whatsapp_baileys as any).location).toMatchObject({ degreesLatitude: -6.2, degreesLongitude: 106.8, name: 'HQ', address: 'Jakarta' });
	});
});
