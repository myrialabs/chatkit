import { test, expect, describe } from 'bun:test';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import { MemoryStateStore } from './memory.js';
import { SqliteStore } from './sqlite.js';
import { createSecretCodec } from './crypto.js';
import type { StateStore } from './index.js';

const KEY = 'test-state-key';

function suites(): Array<[string, () => StateStore]> {
	return [
		['MemoryStateStore', () => new MemoryStateStore({ stateKey: KEY })],
		['SqliteStore(:memory:)', () => new SqliteStore({ path: ':memory:', stateKey: KEY })]
	];
}

for (const [name, make] of suites()) {
	describe(name, () => {
		test('seen() is an atomic check-and-set (idempotency)', async () => {
			const s = make();
			expect(await s.seen('k1')).toBe(true);
			expect(await s.seen('k1')).toBe(false);
			expect(await s.seen('k2')).toBe(true);
			await s.close();
		});

		test('id mapping both directions', async () => {
			const s = make();
			await s.putMapping('acc', 'ck-1', 'native-1');
			expect(await s.getPlatformMessageId('acc', 'ck-1')).toBe('native-1');
			expect(await s.getChatkitId('acc', 'native-1')).toBe('ck-1');
			expect(await s.getPlatformMessageId('acc', 'missing')).toBeNull();
			await s.close();
		});

		test('opt-in tracking', async () => {
			const s = make();
			expect(await s.isOptedIn('acc', 'u1')).toBe(false);
			await s.setOptIn('acc', 'u1', true);
			expect(await s.isOptedIn('acc', 'u1')).toBe(true);
			await s.close();
		});

		test('kv get/set/delete/list', async () => {
			const s = make();
			await s.kvSet('ns', 'a', '1');
			await s.kvSet('ns', 'b', '2');
			expect(await s.kvGet('ns', 'a')).toBe('1');
			expect((await s.kvList('ns')).sort((x, y) => x.key.localeCompare(y.key))).toEqual([
				{ key: 'a', value: '1' },
				{ key: 'b', value: '2' }
			]);
			await s.kvDelete('ns', 'a');
			expect(await s.kvGet('ns', 'a')).toBeNull();
			await s.close();
		});

		test('secret store encrypts at rest and round-trips', async () => {
			const s = make();
			const secret = new TextEncoder().encode('creds-blob');
			await s.secretSet('wa-auth:1', 'creds', secret);
			const back = await s.secretGet('wa-auth:1', 'creds');
			expect(back).not.toBeNull();
			expect(new TextDecoder().decode(back!)).toBe('creds-blob');
			expect(await s.secretList('wa-auth:1')).toEqual(['creds']);
			await s.close();
		});

		test('secret store requires a state key', async () => {
			const s = name.startsWith('Memory')
				? new MemoryStateStore()
				: new SqliteStore({ path: ':memory:' });
			await expect(s.secretSet('ns', 'k', 'v')).rejects.toThrow();
			await s.close();
		});
	});
}

describe('SqliteStore key rotation', () => {
	test('a secret that no longer decrypts reads as absent, and the store still works', async () => {
		const path = `${tmpdir()}/chatkit-rotate-${process.pid}-${Date.now()}.db`;
		try {
			const a = new SqliteStore({ path, stateKey: 'key-a' });
			await a.secretSet('wa-auth:1', 'creds', 'blob');
			await a.close();

			// A different key can't decrypt the old token → treated as missing, not a
			// thrown `Unsupported state...` — so Baileys just re-pairs from scratch.
			const b = new SqliteStore({ path, stateKey: 'key-b' });
			expect(await b.secretGet('wa-auth:1', 'creds')).toBeNull();
			// The store stays usable: re-writing under the new key round-trips.
			await b.secretSet('wa-auth:1', 'creds', 'fresh');
			expect(new TextDecoder().decode((await b.secretGet('wa-auth:1', 'creds'))!)).toBe('fresh');
			await b.close();
		} finally {
			for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });
		}
	});
});

describe('crypto codec', () => {
	test('different keys cannot decrypt', () => {
		const a = createSecretCodec('key-a');
		const b = createSecretCodec('key-b');
		const token = a.encrypt('secret');
		expect(a.decryptString(token)).toBe('secret');
		expect(() => b.decrypt(token)).toThrow();
	});

	test('tampered token fails auth tag', () => {
		const c = createSecretCodec('k');
		const token = c.encrypt('hello');
		const tampered = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA');
		expect(() => c.decrypt(tampered)).toThrow();
	});
});
