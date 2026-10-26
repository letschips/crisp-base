import type { OptionColorMap } from './option-colors';
import { sanitizeColorMap } from './option-colors';

// Every save goes through these helpers so one feature never drops another's data
// (activation used to write `{ licenseCode, activatedAt }` over the whole file).

export interface CrispBaseData {
	licenseCode?: string;
	activatedAt?: number;
	optionColors?: OptionColorMap;
	[key: string]: unknown;
}

export function normalizePluginData(raw: unknown): CrispBaseData {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
	const data: CrispBaseData = { ...(raw as Record<string, unknown>) };
	if (typeof data.licenseCode !== 'string') delete data.licenseCode;
	if (typeof data.activatedAt !== 'number') delete data.activatedAt;
	const colors = sanitizeColorMap(data.optionColors);
	if (Object.keys(colors).length > 0) data.optionColors = colors;
	else delete data.optionColors;
	return data;
}

export function withLicense(data: CrispBaseData, licenseCode: string, activatedAt: number): CrispBaseData {
	return { ...data, licenseCode, activatedAt };
}

export function withoutLicense(data: CrispBaseData): CrispBaseData {
	const next = { ...data };
	delete next.licenseCode;
	delete next.activatedAt;
	return next;
}

export function withOptionColors(data: CrispBaseData, optionColors: OptionColorMap): CrispBaseData {
	const next: CrispBaseData = { ...data, optionColors };
	if (Object.keys(optionColors).length === 0) delete next.optionColors;
	return next;
}
