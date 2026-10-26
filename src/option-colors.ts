import type { App, Component, EventRef } from 'obsidian';
import { accentFor } from './accents';

// Option colors are keyed by property name and shared by every base in the vault, the same way
// Obsidian shares property types. Unset options keep the hashed accent they always had.

export const OPTION_COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink'] as const;
export type OptionColor = (typeof OPTION_COLORS)[number];
export type OptionColorMap = Record<string, Record<string, OptionColor>>;

export const OPTION_COLOR_LABELS: Record<OptionColor, string> = {
	gray: '灰',
	red: '红',
	orange: '橙',
	yellow: '黄',
	green: '绿',
	cyan: '青',
	blue: '蓝',
	purple: '紫',
	pink: '粉',
};

function isOptionColor(value: unknown): value is OptionColor {
	return typeof value === 'string' && (OPTION_COLORS as readonly string[]).includes(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function sanitizeColorMap(raw: unknown): OptionColorMap {
	const result: OptionColorMap = {};
	if (!isPlainObject(raw)) return result;
	for (const [property, values] of Object.entries(raw)) {
		if (!isPlainObject(values)) continue;
		const entries = Object.entries(values).filter(([, color]) => isOptionColor(color));
		if (entries.length > 0) result[property] = Object.fromEntries(entries) as Record<string, OptionColor>;
	}
	return result;
}

export function setOptionColor(
	map: OptionColorMap,
	property: string,
	value: string,
	color: OptionColor | null,
): OptionColorMap {
	const values = { ...(map[property] ?? {}) };
	if (color) values[value] = color;
	else delete values[value];
	const next = { ...map };
	if (Object.keys(values).length > 0) next[property] = values;
	else delete next[property];
	return next;
}

export function optionColor(map: OptionColorMap, property: string, value: string): OptionColor | null {
	return map[property]?.[value] ?? null;
}

export function colorCssVar(color: OptionColor): string {
	return color === 'gray' ? 'var(--color-base-50)' : `var(--color-${color})`;
}

/* ------------------------------------------------------------------ */
/* Shared state, loaded by the plugin and read by every view           */
/* ------------------------------------------------------------------ */

let colors: OptionColorMap = {};
let persist: ((map: OptionColorMap) => Promise<void>) | null = null;

export function initOptionColors(map: OptionColorMap, save: (map: OptionColorMap) => Promise<void>): void {
	colors = map;
	persist = save;
	// Views may have rendered before data.json loaded.
	notifyOptionColorsChanged();
}

export function getOptionColor(property: string | null, value: string): OptionColor | null {
	return property ? optionColor(colors, property, value) : null;
}

/** Accent for an option: its chosen color, else the stable hashed accent. */
export function optionAccent(property: string | null, value: string): string {
	const color = getOptionColor(property, value);
	return color ? colorCssVar(color) : accentFor(value);
}

export async function updateOptionColor(property: string, value: string, color: OptionColor | null): Promise<void> {
	colors = setOptionColor(colors, property, value, color);
	notifyOptionColorsChanged();
	await persist?.(colors);
}

function notifyOptionColorsChanged(): void {
	const workspace = (globalThis as { app?: { workspace?: { trigger?: (name: string) => void } } }).app?.workspace;
	workspace?.trigger?.('crisp-base:option-colors-changed');
}

export function onOptionColorsChanged(app: App, component: Component, callback: () => void): void {
	const events = app.workspace as unknown as {
		on(name: string, cb: (...data: unknown[]) => unknown): EventRef;
	};
	component.registerEvent(events.on('crisp-base:option-colors-changed', () => callback()));
}

export function getPropertyColors(property: string): Record<string, OptionColor> {
	return colors[property] ?? {};
}

/** Tints a chip or pill with the option's chosen color; leaves it neutral otherwise. */
export function applyOptionColor(el: HTMLElement, property: string | null, value: string): void {
	const color = getOptionColor(property, value);
	if (!color) return;
	el.addClass('has-option-color');
	el.style.setProperty('--lb-option-color', colorCssVar(color));
}
