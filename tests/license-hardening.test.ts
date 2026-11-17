import { afterEach, describe, expect, it, vi } from 'vitest';

// Hardening: the verifier takes WebCrypto once at load and must reject an all-zero signature,
// so a console patch of crypto.subtle cannot make a forged code pass; and a license that
// expires while Obsidian runs locks again without a restart.
vi.mock('obsidian', () => ({
	requestUrl: async () => ({ status: 200, json: {} }),
	Notice: class {},
	setIcon: () => undefined,
}));

function forgedCode(): string {
	const payload = Buffer.from(
		JSON.stringify({ product: 'Crisp Suite', features: ['all'], expiresAt: '2999-01-01T00:00:00Z' }),
	).toString('base64url');
	return `${payload}.${Buffer.alloc(64).toString('base64url')}`;
}

describe('license hardening', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
		vi.resetModules();
	});

	it('replacing crypto.subtle.verify after load cannot pass a forged code', async () => {
		const { verifyLicense } = await import('../src/license');
		vi.spyOn(globalThis.crypto.subtle, 'verify').mockResolvedValue(true);
		expect((await verifyLicense(forgedCode(), 'crisp-base', { skipOnlineCheck: true })).valid).toBe(false);
	});

	it('a verifier that accepts everything at load is not trusted, so no code passes', async () => {
		vi.spyOn(globalThis.crypto.subtle, 'verify').mockResolvedValue(true);
		const { verifyLicense } = await import('../src/license');
		expect((await verifyLicense(forgedCode(), 'crisp-base', { skipOnlineCheck: true })).valid).toBe(false);
	});

	it('a license that expires while running locks again', async () => {
		vi.useFakeTimers({ now: Date.parse('2030-01-01T00:00:00Z') });
		const state = await import('../src/license-state');
		state.setLicense(true, 'code', {
			product: 'Crisp Suite', features: ['all'], expiresAt: '2030-01-01T00:00:10Z',
		} as never);
		expect(state.isLicensed()).toBe(true);
		vi.setSystemTime(Date.parse('2030-01-01T00:00:11Z'));
		expect(state.isLicensed()).toBe(false);
	});
});
