import { describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';

vi.mock('obsidian', () => ({
	requestUrl: async () => ({ status: 200, json: {} }),
}));

import { verifyLicense } from '../src/license';

describe('verifyLicense', () => {
	it('rejects empty codes', async () => {
		const result = await verifyLicense('', 'crisp-base');
		expect(result.valid).toBe(false);
		expect(result.reason).toBe('授权码为空');
	});

	it('rejects codes without a payload.signature shape', async () => {
		const result = await verifyLicense('no-dot-here', 'crisp-base');
		expect(result.valid).toBe(false);
		expect(result.reason).toContain('格式无效');
	});

	it('rejects payloads that are not Crisp products', async () => {
		const payload = Buffer.from('{}').toString('base64url');
		const result = await verifyLicense(`${payload}.${payload}`, 'crisp-base');
		expect(result.valid).toBe(false);
		expect(result.reason).toContain('不属于 Crisp 系列');
	});

	it('rejects malformed base64 payloads', async () => {
		const result = await verifyLicense('!!!.!!!', 'crisp-base');
		expect(result.valid).toBe(false);
	});

	it('accepts a properly signed Crisp Base license', async () => {
		const { publicKey, privateKey } = generateKeyPairSync('ed25519');
		const publicKeyPem = publicKey
			.export({ type: 'spki', format: 'pem' })
			.toString();
		const payload = {
			product: 'Crisp Base',
			features: ['all'],
			expiresAt: '2999-01-01T00:00:00Z',
		};
		const payloadB64 = Buffer.from(JSON.stringify(payload)).toString(
			'base64url',
		);
		const signature = sign(
			null,
			Buffer.from(payloadB64),
			privateKey,
		).toString('base64url');
		const code = `${payloadB64}.${signature}`;

		const result = await verifyLicense(code, 'crisp-base', {
			publicKeyPem,
			request: async () => ({ status: 200, json: { valid: true, message: 'ok' } }),
		});
		expect(result.valid).toBe(true);
		expect(result.payload?.product).toBe('Crisp Base');
		expect(result.payload?.features).toContain('all');
	});

	it('rejects expired licenses', async () => {
		const { publicKey, privateKey } = generateKeyPairSync('ed25519');
		const payload = {
			product: 'Crisp Base',
			features: ['all'],
			expiresAt: '2020-01-01T00:00:00Z',
		};
		const payloadB64 = Buffer.from(JSON.stringify(payload)).toString(
			'base64url',
		);
		const signature = sign(
			null,
			Buffer.from(payloadB64),
			privateKey,
		).toString('base64url');

		const result = await verifyLicense(`${payloadB64}.${signature}`, 'crisp-base', {
			publicKeyPem: publicKey
				.export({ type: 'spki', format: 'pem' })
				.toString(),
			request: async () => ({ status: 200, json: { valid: true } }),
		});
		expect(result.valid).toBe(false);
		expect(result.reason).toContain('到期');
	});
});
