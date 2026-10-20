import js from '@eslint/js';
import ts from 'typescript-eslint';
import globals from 'globals';

/** @type {import('eslint').Linter.Config[]} */
export default [
	js.configs.recommended,
	...ts.configs.recommended,

	{
		languageOptions: {
			globals: {
				...globals.node,
				...globals.browser,
				NodeJS: 'readonly',
				Bun: 'readonly'
			}
		},
		rules: {
			// `any` is used deliberately at the platform-SDK / runtime boundary
			// (dynamically imported Baileys/discord.js/Slack shapes, framework
			// middleware request/response objects, SQLite driver variants).
			'@typescript-eslint/no-explicit-any': 'off',
			'no-empty': ['error', { allowEmptyCatch: true }],
			'prefer-const': 'error'
		}
	},

	{
		ignores: ['dist/', 'examples/', 'web/']
	}
];
