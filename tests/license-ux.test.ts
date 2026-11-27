import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { requestUrlMock } = vi.hoisted(() => ({ requestUrlMock: vi.fn() }));

const NBSP = String.fromCharCode(0xa0);
const FULLWIDTH = String.fromCharCode(0x3000);
const ZWSP = String.fromCharCode(0x200b);

vi.mock('obsidian', () => {
	class Stub {}
	class PluginStub {
		app: unknown;
		manifest: unknown;
		stored: unknown = undefined;
		constructor(app: unknown, manifest: unknown) {
			this.app = app;
			this.manifest = manifest;
		}
		async loadData(): Promise<unknown> { return this.stored; }
		async saveData(data: unknown): Promise<void> { this.stored = JSON.parse(JSON.stringify(data)); }
		addSettingTab(): void {}
		registerBasesView(): boolean { return true; }
	}
	return {
		Plugin: PluginStub, PluginSettingTab: Stub, Setting: Stub, Notice: Stub, BasesView: Stub, Component: Stub,
		HoverPopover: Stub, Keymap: Stub, MarkdownRenderer: Stub, Menu: Stub, Platform: {}, TFile: Stub,
		setIcon: () => undefined, parsePropertyId: () => ({ type: 'note' }),
		requestUrl: requestUrlMock,
	};
});

const trusted = generateKeyPairSync('ed25519');
const untrusted = generateKeyPairSync('ed25519');
const publicKeyPem = trusted.publicKey.export({ type: 'spki', format: 'pem' }).toString();

function code(overrides: Record<string, unknown> = {}, key = trusted.privateKey): string {
	const payload = Buffer.from(JSON.stringify({
		product: 'Crisp Suite', features: ['all'], expiresAt: '2999-01-01T00:00:00Z', userName: 't', ...overrides,
	})).toString('base64url');
	return `${payload}.${sign(null, Buffer.from(payload), key).toString('base64url')}`;
}

function fakeApp(files: Record<string, string>, loaded: Record<string, unknown> = {}) {
	return {
		vault: {
			configDir: '.cfg',
			adapter: {
				exists: async (path: string) => path in files,
				read: async (path: string) => files[path],
			},
		},
		plugins: { plugins: loaded },
		workspace: { onLayoutReady: (cb: () => void) => { layoutReady.push(cb); }, trigger: () => undefined },
	};
}
let layoutReady: Array<() => void> = [];
const sent: string[] = [];
let denied = new Set<string>();
const request = async (options: { body: string }) => {
	const licenseCode = JSON.parse(options.body).licenseCode as string;
	sent.push(licenseCode);
	return { status: 200, json: denied.has(licenseCode) ? { valid: false, reason: 'revoked' } : { valid: true } };
};
const opts = { publicKeyPem, request };

afterEach(() => {
	vi.restoreAllMocks();
});

beforeEach(() => {
	layoutReady = [];
	sent.length = 0;
	denied = new Set();
	vi.resetModules();
});

describe('paste normalization', () => {
	it('verifies mangled pastes like the clean code and sends the clean code to the server', async () => {
		const { verifyLicense } = await import('../src/license');
		const clean = code();
		const mid = Math.floor(clean.length / 2);
		const variants = [
			`${clean.slice(0, mid)}\n${clean.slice(mid)}`,
			`${clean.slice(0, mid)}\r\n${clean.slice(mid)}`,
			`${clean.slice(0, 20)} ${clean.slice(20)}`,
			`${clean.slice(0, 20)}${FULLWIDTH}${clean.slice(20)}`,
			`${clean.slice(0, 20)}${NBSP}${clean.slice(20)}`,
			`${clean.slice(0, 20)}${ZWSP}${clean.slice(20)}`,
			`卡密：${clean}。`,
			`${clean}\n复制卡密发送给买家`,
		];
		for (const variant of variants) {
			sent.length = 0;
			expect((await verifyLicense(variant, 'crisp-base', opts)).valid).toBe(true);
			expect(sent).toEqual([clean]);
		}
	});

	it('keeps a clean code unchanged and junk invalid with the same reasons', async () => {
		const { verifyLicense, normalizeLicenseCode } = await import('../src/license');
		const clean = code();
		expect(normalizeLicenseCode(clean)).toBe(clean);
		expect(normalizeLicenseCode(undefined)).toBe('');
		expect((await verifyLicense('', 'crisp-base', opts)).reason).toBe('授权码为空');
		expect((await verifyLicense(' \n ', 'crisp-base', opts)).reason).toBe('授权码为空');
		expect((await verifyLicense('hello world', 'crisp-base', opts)).reason).toContain('格式无效');
		expect((await verifyLicense(code({}, untrusted.privateKey), 'crisp-base', opts)).valid).toBe(false);
	});
});

describe('sibling inheritance in the plugin', () => {
	type PluginLike = {
		stored: unknown;
		onload(): Promise<void>;
		onunload(): void;
		inheritSiblingLicenseOnce(): Promise<void>;
	};

	// Local trust anchor: the embedded key is swapped for the test key at import time; the rest is the real verifier.
	async function boot(files: Record<string, string>, stored?: Record<string, unknown>) {
		const subtle = globalThis.crypto.subtle;
		const original = subtle.importKey.bind(subtle) as (...args: unknown[]) => Promise<CryptoKey>;
		const spki = trusted.publicKey.export({ type: 'spki', format: 'der' });
		vi.spyOn(subtle, 'importKey').mockImplementation(((format: unknown, keyData: unknown, ...rest: unknown[]) =>
			original(format, format === 'spki' ? spki : keyData, ...rest)) as unknown as typeof subtle.importKey);
		requestUrlMock.mockReset();
		requestUrlMock.mockImplementation(async (options: { body: string }) => request(options));
		const [{ default: Plugin }, state] = await Promise.all([import('../src/main'), import('../src/license-state')]);
		state.clearLicense();
		const app = fakeApp(files);
		const plugin = new (Plugin as unknown as new (app: unknown, manifest: unknown) => PluginLike)(
			app, { id: 'crisp-base', dir: '.cfg/plugins/crisp-base' },
		);
		plugin.stored = stored;
		files['.cfg/plugins/crisp-base/data.json'] = JSON.stringify(stored ?? {});
		const saveData = (plugin as unknown as { saveData(d: unknown): Promise<void> }).saveData.bind(plugin);
		(plugin as unknown as { saveData(d: unknown): Promise<void> }).saveData = async (data) => {
			await saveData(data);
			files['.cfg/plugins/crisp-base/data.json'] = JSON.stringify(data);
		};
		await plugin.onload();
		return { plugin, state };
	}

	it('plugin: no own code, sibling holds a valid one -> saved clean and licensed', async () => {
		const sibling = code({ licenseId: 'SIB' });
		const { plugin, state } = await boot({ '.cfg/plugins/crisp-tempo/data.json': JSON.stringify({ licenseKey: `卡密：${sibling}。` }) }, {});
		expect(state.isLicensed()).toBe(false);
		await plugin.inheritSiblingLicenseOnce();
		expect(state.isLicensed()).toBe(true);
		expect((plugin.stored as { licenseCode: string }).licenseCode).toBe(sibling);
	});

	it('plugin: a valid own code is not scanned over or overwritten', async () => {
		const own = code({ licenseId: 'OWN' });
		const sibling = code({ licenseId: 'SIB' });
		const { plugin, state } = await boot(
			{ '.cfg/plugins/crisp-tempo/data.json': JSON.stringify({ licenseKey: sibling }) },
			{ licenseCode: own },
		);
		await plugin.inheritSiblingLicenseOnce();
		expect(state.isLicensed()).toBe(true);
		expect((plugin.stored as { licenseCode: string }).licenseCode).toBe(own);
		expect(sent).not.toContain(sibling);
	});

	it('plugin: a sibling code the server rejects is not saved and the plugin stays locked', async () => {
		const sibling = code({ licenseId: 'SIB-BAD' });
		denied.add(sibling);
		const { plugin, state } = await boot({ '.cfg/plugins/crisp-tempo/data.json': JSON.stringify({ licenseKey: sibling }) }, {});
		await plugin.inheritSiblingLicenseOnce();
		expect(state.isLicensed()).toBe(false);
		expect(plugin.stored).toEqual({});
	});

	it('plugin: a rejected own code is replaced by a sibling code that passes', async () => {
		const own = code({ licenseId: 'OWN-REVOKED' });
		const sibling = code({ licenseId: 'SIB-OK' });
		denied.add(own);
		const { plugin, state } = await boot(
			{ '.cfg/plugins/crisp-tempo/data.json': JSON.stringify({ licenseKey: sibling }) },
			{ licenseCode: own },
		);
		await plugin.inheritSiblingLicenseOnce();
		expect(state.isLicensed()).toBe(true);
		expect((plugin.stored as { licenseCode: string }).licenseCode).toBe(sibling);
	});

	it('exposes the inheritance flow through the module verifier', async () => {
		const { discoverVaultCrispLicenses, inheritSiblingLicense } = await import('../src/license');
		const good = code({ licenseId: 'A' });
		const app = fakeApp({ '.cfg/plugins/crisp-tempo/data.json': JSON.stringify({ licenseKey: `卡密：${good}。` }) });
		expect([...(await discoverVaultCrispLicenses(app, 'crisp-base', 5, opts))]).toEqual([good]);
		let own = '';
		const accepted: string[] = [];
		const ok = await inheritSiblingLicense(app, {
			currentCode: () => own,
			aborted: () => false,
			accept: async (c) => { own = c; accepted.push(c); },
		}, opts);
		expect(ok).toBe(true);
		expect(accepted).toEqual([good]);
		expect(sent).toEqual([good]);
	});

	// Crisp Pulse keeps its code under `settings`; Pets and Days keep theirs under `options`.
	it("reads Pulse's nested settings on disk and the options of a loaded sibling", async () => {
		const { discoverVaultCrispLicenses } = await import('../src/license');
		const a = code({ licenseId: 'PULSE' });
		const b = code({ licenseId: 'TEST-B' });
		const loaded: Record<string, unknown> = {};
		const app = fakeApp({ '.cfg/plugins/crisp-pulse/data.json': JSON.stringify({ settings: { licenseCode: a } }) }, loaded);
		expect([...(await discoverVaultCrispLicenses(app, 'crisp-base', 5, opts))]).toEqual([a]);
		loaded['crisp-focus'] = { options: { licenseCode: b } };
		expect([...(await discoverVaultCrispLicenses(app, 'crisp-base', 5, opts))]).toEqual([b, a]);
	});

	it('does not persist a sibling code the server rejects', async () => {
		const { inheritSiblingLicense } = await import('../src/license');
		const bad = code({ licenseId: 'BAD' });
		denied.add(bad);
		const app = fakeApp({ '.cfg/plugins/crisp-pulse/data.json': JSON.stringify({ licenseCode: bad }) });
		const accepted: string[] = [];
		const ok = await inheritSiblingLicense(app, {
			currentCode: () => '', aborted: () => false, accept: async (c) => { accepted.push(c); },
		}, opts);
		expect(ok).toBe(false);
		expect(accepted).toEqual([]);
	});

	it('never sends forged or other-product sibling codes to the server', async () => {
		const { discoverVaultCrispLicenses } = await import('../src/license');
		const app = fakeApp({
			'.cfg/plugins/crisp-pulse/data.json': JSON.stringify({ licenseCode: code({}, untrusted.privateKey) }),
			'.cfg/plugins/crisp-tempo/data.json': JSON.stringify({ licenseKey: code({ features: ['crisp-focus'], product: 'Crisp Focus' }) }),
		});
		expect(await discoverVaultCrispLicenses(app, 'crisp-base', 5, opts)).toHaveLength(0);
		expect(sent).toEqual([]);
	});

	it('stops when unloaded or when the own code changed meanwhile', async () => {
		const { inheritSiblingLicense } = await import('../src/license');
		const app = fakeApp({ '.cfg/plugins/crisp-pulse/data.json': JSON.stringify({ licenseCode: code() }) });
		const accepted: string[] = [];
		expect(await inheritSiblingLicense(app, {
			currentCode: () => '', aborted: () => true, accept: async (c) => { accepted.push(c); },
		}, opts)).toBe(false);
		let own = '';
		expect(await inheritSiblingLicense(app, {
			currentCode: () => own, aborted: () => { own = 'typed'; return false; }, accept: async (c) => { accepted.push(c); },
		}, opts)).toBe(false);
		expect(accepted).toEqual([]);
	});
});
