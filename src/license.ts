import { requestUrl } from 'obsidian';

export const LICENSE_SERVER_URL =
	'https://license.letschips.xyz/api/verify-device';

export const LICENSE_PRODUCTS = [
	'Crisp Suite',
	'Crisp Organize',
	'Crisp ASR',
	'Crisp Annotations',
	'Crisp File Explorer',
	'Crisp Focus',
	'Crisp Reading Rail',
	'Crisp Base',
];

export const PLUGIN_FEATURE = 'crisp-base';

/** Injected from the existing Crisp suite plugin (Ed25519 public key). */
const LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAiz41HIDpD59SH3DjKnovUO+EEhTJXjvmiug/ev9t4ZQ=
-----END PUBLIC KEY-----`;

export interface LicensePayload {
	product?: string;
	features?: string[];
	expiresAt?: string;
	[key: string]: unknown;
}

export interface VerifyResult {
	valid: boolean;
	reason?: string;
	payload?: LicensePayload;
	message?: string | null;
}

interface VerifyOptions {
	now?: () => number;
	getDeviceId?: () => string;
	/** Injectable for tests; defaults to the embedded Crisp suite public key. */
	publicKeyPem?: string;
	/** Skip the online device check (used on startup so loads never block on the network). */
	skipOnlineCheck?: boolean;
	request?: (options: {
		url: string;
		method: string;
		headers: Record<string, string>;
		body: string;
		throw?: boolean;
	}) => Promise<{ status: number; json?: unknown }>;
}

/**
 * Chat apps mangle long codes when they are copied: line breaks, spaces (incl. full-width/NBSP),
 * zero-width characters, and surrounding text such as "卡密：…。". Returns the bare code.
 */
export function normalizeLicenseCode(input: unknown): string {
	if (typeof input !== 'string') return '';
	const compact = input.replace(/[\s\u200B-\u200D\u2060\uFEFF]/g, '');
	const match = compact.match(/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/);
	return match ? match[0] : compact;
}

function base64UrlDecodeToBytes(input: string): Uint8Array {
	const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
	const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

type CapturedSubtle = Pick<SubtleCrypto, 'importKey' | 'verify'>;

// WebCrypto is taken once at load: replacing crypto.subtle later does not reach the license check.
const SUBTLE: CapturedSubtle | null = (() => {
	try {
		const subtle =
			globalThis.crypto?.subtle ??
			(typeof window !== 'undefined' ? window.crypto?.subtle : undefined);
		return subtle
			? Object.freeze({ importKey: subtle.importKey.bind(subtle), verify: subtle.verify.bind(subtle) })
			: null;
	} catch {
		return null;
	}
})();

let subtleCheck: Promise<boolean> | null = null;

// A verifier that accepts an all-zero signature is not a real verifier; no license is trusted then.
function subtleTrusted(): Promise<boolean> {
	subtleCheck ??= (async () => {
		if (!SUBTLE) return false;
		try {
			const key = await importPublicKey(LICENSE_PUBLIC_KEY_PEM);
			const accepted = await SUBTLE.verify(
				'Ed25519',
				key,
				new Uint8Array(64),
				new TextEncoder().encode('crisp-base/self-test'),
			);
			return accepted === false;
		} catch {
			return false;
		}
	})();
	return subtleCheck;
}

export function getDeviceId(): string {
	const appAny = (globalThis as { app?: { appId?: string; vault?: { getName?: () => string } } }).app;
	if (appAny?.appId) return appAny.appId;
	if (appAny?.vault?.getName) {
		return `vault-${encodeURIComponent(appAny.vault.getName())}`;
	}
	return 'device-default';
}

async function importPublicKey(publicKeyPem: string): Promise<CryptoKey> {
	if (!SUBTLE) throw new Error('WebCrypto 在当前环境不可用');
	const base64 = publicKeyPem
		.replace('-----BEGIN PUBLIC KEY-----', '')
		.replace('-----END PUBLIC KEY-----', '')
		.replace(/\s/g, '');
	const bytes = base64UrlDecodeToBytes(base64);
	const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
	return SUBTLE.importKey(
		'spki',
		buffer as ArrayBuffer,
		{ name: 'Ed25519' },
		true,
		['verify'],
	);
}

export async function verifyLicense(
	code: string,
	pluginFeature = PLUGIN_FEATURE,
	options: VerifyOptions = {},
): Promise<VerifyResult> {
	const now = options.now ?? (() => Date.now());
	const request = options.request ?? ((reqOptions) => requestUrl({ ...reqOptions, throw: false }));
	const deviceId = options.getDeviceId ?? getDeviceId;
	const publicKeyPem = options.publicKeyPem ?? LICENSE_PUBLIC_KEY_PEM;
	const trimmed = normalizeLicenseCode(code);

	if (!trimmed) return { valid: false, reason: '授权码为空' };
	const parts = trimmed.split('.');
	if (parts.length !== 2) {
		return { valid: false, reason: '授权码格式无效（必须包含 payload 与签名）' };
	}

	const [payloadPart, signaturePart] = parts;
	try {
		const payloadBytes = base64UrlDecodeToBytes(payloadPart);
		const payload = JSON.parse(
			new TextDecoder().decode(payloadBytes),
		) as LicensePayload;

		if (!LICENSE_PRODUCTS.includes(payload.product ?? '')) {
			return { valid: false, reason: '授权码不属于 Crisp 系列插件' };
		}
		const features = Array.isArray(payload.features) ? payload.features : [];
		if (!(features.includes('all') || features.includes(pluginFeature))) {
			return { valid: false, reason: `该授权码未包含 ${pluginFeature} 权限` };
		}
		if (payload.expiresAt) {
			const expires = new Date(payload.expiresAt).getTime();
			if (Number.isFinite(expires) && expires < now()) {
				return {
					valid: false,
					reason: `授权已于 ${String(payload.expiresAt).split('T')[0]} 到期`,
				};
			}
		}

		if (!SUBTLE || !(await subtleTrusted())) {
			return { valid: false, reason: 'WebCrypto 在当前环境不可用' };
		}
		const key = await importPublicKey(publicKeyPem);
		const signature = base64UrlDecodeToBytes(signaturePart);
		const message = new TextEncoder().encode(payloadPart);
		const valid = await SUBTLE.verify(
			'Ed25519',
			key,
			signature as BufferSource,
			message as BufferSource,
		);
		if (valid !== true) return { valid: false, reason: '授权签名无效或伪造' };

		if (options.skipOnlineCheck) {
			return { valid: true, payload, message: null };
		}

		try {
			const response = await Promise.race([
				request({
					url: LICENSE_SERVER_URL,
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						licenseCode: trimmed,
						deviceId: deviceId(),
						action: 'activate',
						pluginId: pluginFeature,
					}),
					throw: false,
				}),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error('Crisp license check timeout')), 2500),
				),
			]);
			let cloudResult: { valid?: boolean; reason?: string; message?: string } | null = null;
			try {
				cloudResult = response.json as { valid?: boolean; reason?: string; message?: string };
			} catch {
				cloudResult = null;
			}

			// 1. 明确的服务端业务拒绝（200/400/401/403 且带有明确的 valid: false）
			const isAuthDenial =
				(response.status === 200 || response.status === 400 || response.status === 401 || response.status === 403) &&
				cloudResult !== null &&
				cloudResult.valid === false;

			if (isAuthDenial) {
				return {
					valid: false,
					reason: cloudResult?.reason || '授权已被服务端拒绝或设备数已达上限',
				};
			}

			// 2. 服务端明确批准（200 OK 且 valid: true）
			if (response.status === 200 && cloudResult && cloudResult.valid === true) {
				return { valid: true, payload, message: cloudResult.message ?? null };
			}

			// 其余情况（404/408/429/5xx、网关 HTML 报错、JSON 异常等）均视为服务不可用，降级离线可用
			if (response.status >= 400) {
				console.warn(`[crisp-base] License server unavailable (status ${response.status}), offline fallback`);
			}
		} catch {
			console.debug('[crisp-base] license online check offline fallback');
		}
		return { valid: true, payload, message: null };
	} catch (error) {
		return {
			valid: false,
			reason: `解析授权码失败：${
				error instanceof Error ? error.message : String(error)
			}`,
		};
	}
}

// Paid Crisp plugins that may already hold a suite code in this vault. Module constant on purpose.
const CRISP_SIBLING_PLUGIN_IDS = [
	'crisp-annotations', 'crisp-asr', 'crisp-base', 'crisp-file-explorer', 'crisp-focus',
	'crisp-mind', 'crisp-pets', 'crisp-pulse', 'crisp-reading-rail', 'crisp-recall',
	'crisp-ripple', 'crisp-search', 'crisp-tempo', 'crisp-visual',
] as const;

interface SiblingScanApp {
	vault?: {
		configDir?: string;
		adapter?: {
			exists(path: string): Promise<boolean>;
			read(path: string): Promise<string>;
		};
	};
	plugins?: { plugins?: Record<string, { settings?: Record<string, unknown> } | undefined> };
}

/**
 * Codes saved by sibling Crisp plugins in this vault that pass the local signature check
 * (read-only; nothing is written). The caller must still verify each one online before using it.
 */
export async function discoverVaultCrispLicenses(
	app: unknown,
	targetPluginId: string = PLUGIN_FEATURE,
	limit = 5,
	verifyOptions: VerifyOptions = {},
): Promise<string[]> {
	const host = app as SiblingScanApp | null | undefined;
	if (!host) return [];
	const candidates: string[] = [];
	const seen = new Set<string>();
	const add = (code: unknown): void => {
		const normalized = normalizeLicenseCode(code);
		if (!normalized.includes('.') || seen.has(normalized)) return;
		seen.add(normalized);
		candidates.push(normalized);
	};
	for (const id of CRISP_SIBLING_PLUGIN_IDS) {
		if (id === targetPluginId) continue;
		const settings = host.plugins?.plugins?.[id]?.settings;
		add(settings?.licenseCode);
		add(settings?.licenseKey);
	}
	const adapter = host.vault?.adapter;
	const configDir = host.vault?.configDir;
	if (adapter && configDir) {
		for (const id of CRISP_SIBLING_PLUGIN_IDS) {
			if (id === targetPluginId) continue;
			try {
				const path = `${configDir}/plugins/${id}/data.json`;
				if (!(await adapter.exists(path))) continue;
				const data = JSON.parse(await adapter.read(path)) as Record<string, unknown> | null;
				add(data?.licenseCode || data?.licenseKey || data?.license);
			} catch {
				// A missing or unreadable sibling file is simply skipped.
			}
		}
	}
	const valid: string[] = [];
	for (const code of candidates) {
		if (valid.length >= limit) break;
		const local = await verifyLicense(code, targetPluginId, { ...verifyOptions, skipOnlineCheck: true });
		if (local.valid) valid.push(code);
	}
	return valid;
}

/**
 * Tries sibling codes one by one; the first that passes the online check is handed to `accept`
 * (which saves it and applies it through the plugin's own license state). Stops as soon as the
 * plugin's own code changed or the plugin was unloaded. Returns true when a code was accepted.
 */
export async function inheritSiblingLicense(
	app: unknown,
	hooks: {
		currentCode(): string;
		aborted(): boolean;
		accept(code: string, result: VerifyResult): Promise<void>;
	},
	verifyOptions: VerifyOptions = {},
): Promise<boolean> {
	const startCode = hooks.currentCode();
	const candidates = (await discoverVaultCrispLicenses(app, PLUGIN_FEATURE, 5, verifyOptions))
		.filter((candidate) => candidate !== startCode);
	for (const candidate of candidates) {
		if (hooks.aborted() || hooks.currentCode() !== startCode) return false;
		const result = await verifyLicense(candidate, PLUGIN_FEATURE, verifyOptions);
		if (hooks.aborted() || hooks.currentCode() !== startCode) return false;
		if (!result.valid) continue;
		await hooks.accept(candidate, result);
		return true;
	}
	return false;
}
