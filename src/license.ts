import { requestUrl } from 'obsidian';

export const LICENSE_SERVER_URL =
	'https://crisp-license.helloherve-xsn.workers.dev/api/verify-device';

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
	request?: (options: {
		url: string;
		method: string;
		headers: Record<string, string>;
		body: string;
	}) => Promise<{ status: number; json?: unknown }>;
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

function getWebCrypto(): SubtleCrypto | null {
	if (globalThis.crypto?.subtle) return globalThis.crypto.subtle;
	if (typeof window !== 'undefined' && window.crypto?.subtle) {
		return window.crypto.subtle;
	}
	return null;
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
	const subtle = getWebCrypto();
	if (!subtle) throw new Error('WebCrypto 在当前环境不可用');
	const base64 = publicKeyPem
		.replace('-----BEGIN PUBLIC KEY-----', '')
		.replace('-----END PUBLIC KEY-----', '')
		.replace(/\s/g, '');
	const bytes = base64UrlDecodeToBytes(base64);
	const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
	return subtle.importKey(
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
	const request = options.request ?? requestUrl;
	const deviceId = options.getDeviceId ?? getDeviceId;
	const publicKeyPem = options.publicKeyPem ?? LICENSE_PUBLIC_KEY_PEM;
	const trimmed = code.trim();

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

		const key = await importPublicKey(publicKeyPem);
		const signature = base64UrlDecodeToBytes(signaturePart);
		const message = new TextEncoder().encode(payloadPart);
		const valid = await getWebCrypto()!.verify(
			'Ed25519',
			key,
			signature as BufferSource,
			message as BufferSource,
		);
		if (!valid) return { valid: false, reason: '授权签名无效或伪造' };

		try {
			const response = await request({
				url: LICENSE_SERVER_URL,
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					licenseCode: trimmed,
					deviceId: deviceId(),
					action: 'activate',
					pluginId: pluginFeature,
				}),
			});
			if (response.status === 200 && response.json) {
				const json = response.json as {
					valid?: boolean;
					reason?: string;
					message?: string;
				};
				if (json.valid === false) {
					return { valid: false, reason: json.reason ?? '设备数已达上限' };
				}
				return { valid: true, payload, message: json.message ?? null };
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
