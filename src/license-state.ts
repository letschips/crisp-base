import type { App, Component, EventRef} from 'obsidian';
import { Notice } from 'obsidian';
import { setIcon } from 'obsidian';
import type { LicensePayload } from './license';

interface LicenseState {
	valid: boolean;
	code?: string;
	payload?: LicensePayload;
}

let current: LicenseState = { valid: false };

export function setLicense(
	valid: boolean,
	code?: string,
	payload?: LicensePayload,
): void {
	current = { valid, code, payload };
}

export function clearLicense(): void {
	current = { valid: false };
}

export function isLicensed(): boolean {
	return current.valid;
}

export function licensePayload(): LicensePayload | undefined {
	return current.payload;
}

export function requireLicense(): boolean {
	if (current.valid) return true;
	new Notice('Crisp Base 未激活：请在 设置 → Crisp Base 输入激活码。');
	return false;
}

/** Broadcast so open Bases views can re-render after activation state changes. */
export function notifyLicenseChanged(): void {
	const workspace = (globalThis as { app?: { workspace?: { trigger?: (name: string) => void } } }).app
		?.workspace;
	workspace?.trigger?.('crisp-base:license-changed');
}

export function onLicenseChanged(
	app: App,
	component: Component,
	callback: () => void,
): void {
	const events = app.workspace as unknown as {
		on(name: string, cb: (...data: unknown[]) => unknown): EventRef;
	};
	component.registerEvent(
		events.on('crisp-base:license-changed', () => callback()),
	);
}

export function renderLicenseBanner(containerEl: HTMLElement): void {
	const banner = containerEl.createDiv({ cls: 'cb-license-banner' });
	const icon = banner.createDiv({ cls: 'cb-license-banner-icon' });
	setIcon(icon, 'lock');
	banner.createSpan({
		text: 'Crisp Base 未激活 — 请在 设置 → Crisp Base 输入激活码',
	});
}
