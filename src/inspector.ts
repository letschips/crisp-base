import type {
	App,
	BasesEntry,
	BasesPropertyId,
	TFile,
} from 'obsidian';
import {
	Component,
	Keymap,
	MarkdownRenderer,
	Menu,
	Platform,
	parsePropertyId,
	setIcon,
} from 'obsidian';
import type { BasesViewConfig } from 'obsidian';
import { requireLicense } from './license-state';
import type { OptionColor } from './option-colors';
import {
	OPTION_COLOR_LABELS,
	OPTION_COLORS,
	applyOptionColor,
	getOptionColor,
	getPropertyColors,
	updateOptionColor,
} from './option-colors';
import type { PropertyKind } from './property-types';
import {
	fromDateInput,
	isValueCompatible,
	listItems,
	normalizeListItems,
	parseNumberInput,
	resolvePropertyKind,
	toDateInput,
} from './property-types';
import { stripFrontmatter } from './template-utils';

export interface InspectorOptions {
	app: App;
	config: BasesViewConfig;
	/** The view hosting the inspector; owns the rendered preview's lifecycle. */
	host: Component;
	/** Entries of the current base, used for option and list suggestions. */
	entries: BasesEntry[];
	/** Note property used for board columns; renders a dropdown when set. */
	groupBy: BasesPropertyId | null;
	knownLabels: string[];
	onChanged: () => void;
	onClose: () => void;
}

const KIND_LABELS: Record<PropertyKind, string> = {
	text: '文本',
	number: '数字',
	checkbox: '勾选',
	date: '日期',
	datetime: '日期时间',
	list: '列表',
	tags: '标签',
};

const PREVIEW_LIMIT = 20000;

interface PreviewCache {
	path: string;
	mtime: number;
	body: string;
	full: boolean;
	el: HTMLElement;
	child: Component;
}

// Views re-render on every data update; keep the rendered body so the preview neither flickers
// nor re-renders while the note's body is unchanged.
const previewCache = new WeakMap<Component, PreviewCache>();
// Property whose input should regain focus after the re-renders its own edit caused (the write
// re-renders once directly and again when Bases reports the change).
const pendingFocus = new WeakMap<Component, { key: string; until: number }>();
const FOCUS_WINDOW_MS = 1500;

function keepFocus(host: Component, key: string): void {
	pendingFocus.set(host, { key, until: Date.now() + FOCUS_WINDOW_MS });
}
// The preview section currently in the DOM for each host.
const liveSection = new WeakMap<Component, HTMLElement>();

/**
 * Notion-like editable property inspector. Mounts into a right-side panel
 * container and writes edits back to the note frontmatter.
 */
export function renderPropertyInspector(
	content: HTMLElement,
	entry: BasesEntry,
	options: InspectorOptions,
): void {
	const { app, config, host, groupBy, knownLabels, onClose } = options;
	const inspector = content.createDiv({ cls: 'lb-inspector' });

	const header = inspector.createDiv({ cls: 'lb-inspector-header' });
	const title = header.createDiv({ cls: 'lb-inspector-title' });
	title.setText(entry.file.basename);
	title.addEventListener('click', () => {
		void app.workspace.openLinkText(entry.file.path, '');
	});
	const closeButton = header.createDiv({ cls: 'lb-inspector-close' });
	setIcon(closeButton, 'x');
	closeButton.addEventListener('click', () => {
		onClose();
	});

	inspector.createDiv({ cls: 'lb-inspector-path', text: entry.file.path });

	const fields = inspector.createDiv({ cls: 'lb-inspector-fields' });
	const ctx: FieldContext = { ...options, file: entry.file };

	let groupByName: string | null = null;
	if (groupBy && parsePropertyId(groupBy).type === 'note') {
		groupByName = parsePropertyId(groupBy).name;
		const current = entry.getValue(groupBy);
		renderSelectField(
			fields,
			ctx,
			groupByName,
			config.getDisplayName(groupBy),
			current && current.isTruthy() ? current.toString() : null,
			knownLabels.filter((label) => label !== 'No value'),
		);
	}

	const frontmatter = (app.metadataCache.getFileCache(entry.file)?.frontmatter ?? {}) as Record<string, unknown>;
	const keys = Object.keys(frontmatter);
	// Properties shown by this view but missing from the note can be filled in directly.
	for (const propertyId of config.getOrder()) {
		const { type, name } = parsePropertyId(propertyId);
		if (type === 'note' && !keys.includes(name)) keys.push(name);
	}
	let rendered = 0;
	for (const key of keys) {
		if (key === 'crisp_type' || key === groupByName) continue;
		renderField(fields, ctx, key, frontmatter[key]);
		rendered++;
	}
	if (rendered === 0 && groupByName === null) {
		fields.createDiv({ cls: 'lb-inspector-hint', text: '这篇笔记还没有属性。' });
	}

	renderPreview(inspector, app, host, entry.file);

	const actions = inspector.createDiv({ cls: 'lb-inspector-actions' });
	const openButton = actions.createEl('button', { cls: 'lb-button' });
	setIcon(openButton, 'external-link');
	openButton.createSpan({ text: '打开笔记' });
	openButton.addEventListener('click', () => {
		void app.workspace.openLinkText(entry.file.path, '');
	});
	if (!Platform.isPhone) {
		const splitButton = actions.createEl('button', { cls: 'lb-button' });
		setIcon(splitButton, 'columns-2');
		splitButton.createSpan({ text: '在右侧分栏打开' });
		splitButton.addEventListener('click', () => {
			void app.workspace.openLinkText(entry.file.path, '', 'split');
		});
	}

	const focus = pendingFocus.get(host);
	if (focus && focus.until > Date.now()) {
		inspector
			.querySelector<HTMLElement>(`[data-property="${CSS.escape(focus.key)}"] input`)
			?.focus();
	} else if (focus) {
		pendingFocus.delete(host);
	}
}

/* ------------------------------------------------------------------ */
/* Fields                                                              */
/* ------------------------------------------------------------------ */

interface FieldContext extends InspectorOptions {
	file: TFile;
}

function createRow(fields: HTMLElement, key: string, label: string, kind?: PropertyKind): HTMLElement {
	const row = fields.createDiv({ cls: 'lb-field', attr: { 'data-property': key } });
	const labelEl = row.createDiv({ cls: 'lb-field-label', text: label });
	if (kind) labelEl.setAttr('title', KIND_LABELS[kind]);
	return row.createDiv({ cls: 'lb-field-control' });
}

function renderField(fields: HTMLElement, ctx: FieldContext, key: string, value: unknown): void {
	const kind = resolvePropertyKind(ctx.app, key, value);

	if (!isValueCompatible(kind, value)) {
		// Never reinterpret a value that does not fit its type; the user fixes it in the note.
		const control = createRow(fields, key, key, kind);
		control.createDiv({ cls: 'lb-field-raw', text: formatRaw(value) });
		control.createDiv({
			cls: 'lb-field-warning',
			text: `值和属性类型「${KIND_LABELS[kind]}」不符，请在笔记里修改。`,
		});
		return;
	}

	if (kind === 'text' && Object.keys(getPropertyColors(key)).length > 0) {
		renderSelectField(
			fields,
			ctx,
			key,
			key,
			value === null || value === undefined || value === '' ? null : String(value as string | number),
			collectValues(ctx, key),
		);
		return;
	}

	const control = createRow(fields, key, key, kind);
	switch (kind) {
		case 'checkbox': {
			const checkbox = control.createEl('input', { type: 'checkbox' });
			checkbox.checked = value === true;
			checkbox.addEventListener('change', () => {
				void writeProperty(ctx, key, checkbox.checked);
			});
			return;
		}
		case 'number': {
			const input = control.createEl('input', { type: 'number' });
			input.value = typeof value === 'number' ? String(value) : '';
			input.placeholder = '空';
			input.addEventListener('change', () => {
				const parsed = parseNumberInput(input.value);
				if (parsed !== undefined) void writeProperty(ctx, key, parsed);
			});
			return;
		}
		case 'date':
		case 'datetime': {
			const input = control.createEl('input', { type: kind === 'date' ? 'date' : 'datetime-local' });
			input.value = toDateInput(kind, value);
			input.addEventListener('change', () => {
				void writeProperty(ctx, key, fromDateInput(kind, input.value));
			});
			return;
		}
		case 'list':
		case 'tags':
			renderListEditor(control, ctx, key, kind, listItems(value));
			return;
		case 'text': {
			const input = control.createEl('input', { type: 'text' });
			input.value = value === null || value === undefined ? '' : String(value as string | number);
			input.placeholder = '空';
			input.addEventListener('change', () => {
				void writeProperty(ctx, key, input.value === '' ? null : input.value);
			});
			return;
		}
	}
}

function renderListEditor(
	control: HTMLElement,
	ctx: FieldContext,
	key: string,
	kind: 'list' | 'tags',
	items: string[],
): void {
	const box = control.createDiv({ cls: 'lb-list-editor' });
	for (const item of items) {
		const pill = box.createDiv({ cls: 'lb-pill' });
		applyOptionColor(pill, key, item);
		pill.createSpan({ text: kind === 'tags' ? `#${item}` : item });
		const remove = pill.createSpan({ cls: 'lb-pill-remove', attr: { 'aria-label': `移除 ${item}` } });
		setIcon(remove, 'x');
		remove.addEventListener('click', () => {
			void writeProperty(ctx, key, normalizeListItems(kind, items.filter((other) => other !== item)));
		});
	}

	const listId = `lb-suggest-${Math.random().toString(36).slice(2)}`;
	const input = box.createEl('input', { type: 'text', attr: { list: listId } });
	input.placeholder = items.length === 0 ? '空' : '添加…';
	const datalist = box.createEl('datalist', { attr: { id: listId } });
	for (const suggestion of collectValues(ctx, key)) {
		if (!items.includes(suggestion)) datalist.createEl('option', { value: suggestion });
	}

	const commit = (stayFocused: boolean) => {
		const added = input.value.split(/[,，]/);
		if (added.every((text) => text.trim() === '')) return;
		input.value = '';
		if (stayFocused) keepFocus(ctx.host, key);
		void writeProperty(ctx, key, normalizeListItems(kind, [...items, ...added]));
	};
	input.addEventListener('keydown', (event: KeyboardEvent) => {
		if (event.isComposing) return;
		if (event.key === 'Enter' || event.key === ',') {
			event.preventDefault();
			commit(true);
		} else if (event.key === 'Backspace' && input.value === '' && items.length > 0) {
			keepFocus(ctx.host, key);
			void writeProperty(ctx, key, normalizeListItems(kind, items.slice(0, -1)));
		}
	});
	input.addEventListener('blur', () => commit(false));
}

/** Single-choice property shown as colored pills, like a Notion select. */
function renderSelectField(
	fields: HTMLElement,
	ctx: FieldContext,
	key: string,
	label: string,
	current: string | null,
	choices: string[],
): void {
	const control = createRow(fields, key, label);
	const values = [...new Set([...choices, ...Object.keys(getPropertyColors(key))])];
	if (current && !values.includes(current)) values.unshift(current);

	const trigger = control.createDiv({ cls: 'lb-select-trigger', attr: { tabindex: '0' } });
	if (current) {
		const pill = trigger.createDiv({ cls: 'lb-pill', text: current });
		applyOptionColor(pill, key, current);
	} else {
		trigger.createDiv({ cls: 'lb-select-empty', text: '无值' });
	}
	const chevron = trigger.createDiv({ cls: 'lb-select-chevron' });
	setIcon(chevron, 'chevron-down');

	const panel = control.createDiv({ cls: 'lb-select-options' });
	panel.hide();
	const toggle = () => {
		if (panel.isShown()) panel.hide();
		else panel.show();
	};
	trigger.addEventListener('click', toggle);
	trigger.addEventListener('keydown', (event: KeyboardEvent) => {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			toggle();
		}
	});

	for (const value of values) {
		const row = panel.createDiv({ cls: 'lb-select-option' });
		if (value === current) row.addClass('is-current');
		const pill = row.createDiv({ cls: 'lb-pill', text: value });
		applyOptionColor(pill, key, value);
		row.addEventListener('click', () => {
			void writeProperty(ctx, key, value);
		});
		const colorButton = row.createDiv({ cls: 'lb-select-color', attr: { 'aria-label': '选项颜色' } });
		setIcon(colorButton, 'palette');
		colorButton.addEventListener('click', (event: MouseEvent) => {
			event.stopPropagation();
			showOptionColorMenu(event, key, value);
		});
	}
	if (current) {
		const clear = panel.createDiv({ cls: 'lb-select-option lb-select-clear', text: '清除' });
		clear.addEventListener('click', () => {
			void writeProperty(ctx, key, null);
		});
	}
}

export function showOptionColorMenu(event: MouseEvent, property: string, value: string): void {
	const menu = new Menu();
	const current = getOptionColor(property, value);
	for (const color of OPTION_COLORS) {
		menu.addItem((item) =>
			item
				.setTitle(OPTION_COLOR_LABELS[color])
				.setChecked(current === color)
				.onClick(() => setColor(property, value, color)),
		);
	}
	menu.addSeparator();
	menu.addItem((item) =>
		item
			.setTitle('默认颜色')
			.setChecked(current === null)
			.onClick(() => setColor(property, value, null)),
	);
	menu.showAtMouseEvent(event);
}

function setColor(property: string, value: string, color: OptionColor | null): void {
	if (!requireLicense()) return;
	void updateOptionColor(property, value, color);
}

function collectValues(ctx: FieldContext, key: string): string[] {
	const values = new Set<string>();
	for (const other of ctx.entries) {
		const frontmatter = ctx.app.metadataCache.getFileCache(other.file)?.frontmatter as
			| Record<string, unknown>
			| undefined;
		const raw = frontmatter?.[key];
		for (const item of Array.isArray(raw) ? (raw as unknown[]) : [raw]) {
			if (typeof item === 'string' && item !== '') values.add(item);
			else if (typeof item === 'number') values.add(String(item));
		}
	}
	return [...values].sort((a, b) => a.localeCompare(b));
}

function formatRaw(value: unknown): string {
	if (typeof value === 'string') return value;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

async function writeProperty(ctx: FieldContext, name: string, value: unknown): Promise<void> {
	if (!requireLicense()) return;
	await ctx.app.fileManager.processFrontMatter(ctx.file, (frontmatter: Record<string, unknown>) => {
		if (value === null) {
			delete frontmatter[name];
		} else {
			frontmatter[name] = value;
		}
	});
	ctx.onChanged();
}

/* ------------------------------------------------------------------ */
/* Body preview (read-only)                                            */
/* ------------------------------------------------------------------ */

function renderPreview(inspector: HTMLElement, app: App, host: Component, file: TFile): void {
	const section = inspector.createDiv({ cls: 'lb-preview' });
	section.createDiv({ cls: 'lb-preview-label', text: '正文' });
	liveSection.set(host, section);

	const cached = previewCache.get(host);
	if (!cached || cached.path !== file.path) {
		void mountPreview(section, app, host, file, false);
		return;
	}
	// Same note: keep showing the rendered body; property edits change mtime but not the body.
	section.appendChild(cached.el);
	if (cached.mtime === file.stat.mtime) return;
	void (async () => {
		const body = await readBody(app, file);
		if (previewCache.get(host) !== cached) return;
		cached.mtime = file.stat.mtime;
		if (body !== cached.body) await mountPreview(section, app, host, file, cached.full, body);
	})();
}

async function readBody(app: App, file: TFile): Promise<string> {
	return stripFrontmatter(await app.vault.cachedRead(file)).trim();
}

async function mountPreview(
	section: HTMLElement,
	app: App,
	host: Component,
	file: TFile,
	full: boolean,
	knownBody?: string,
): Promise<void> {
	const previous = previewCache.get(host);
	const el = createDiv({ cls: 'lb-preview-body markdown-rendered' });
	const child = host.addChild(new Component());
	const entry: PreviewCache = { path: file.path, mtime: file.stat.mtime, body: knownBody ?? '', full, el, child };
	previewCache.set(host, entry);

	el.addEventListener('click', (event: MouseEvent) => {
		const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a.internal-link');
		if (!link) return;
		event.preventDefault();
		const target = link.getAttr('data-href') ?? link.getAttr('href');
		if (target) void app.workspace.openLinkText(target, file.path, Keymap.isModEvent(event));
	});

	const body = knownBody ?? (await readBody(app, file));
	entry.body = body;
	if (previewCache.get(host) !== entry) {
		host.removeChild(child);
		return;
	}
	if (body === '') {
		el.createDiv({ cls: 'lb-inspector-hint', text: '正文为空。' });
	} else {
		const truncated = !full && body.length > PREVIEW_LIMIT;
		await MarkdownRenderer.render(app, truncated ? body.slice(0, PREVIEW_LIMIT) : body, el, file.path, child);
		if (truncated) {
			const more = el.createEl('button', { cls: 'lb-button lb-preview-more', text: '显示全部' });
			more.addEventListener('click', () => {
				const parent = el.parentElement;
				if (parent) void mountPreview(parent, app, host, file, true, body);
			});
		}
	}
	// Swap in only once rendered, so the old body stays visible instead of a blank flash. The
	// inspector may have re-rendered while this body was loading; attach to the live section.
	if (previous) host.removeChild(previous.child);
	const live = liveSection.get(host) ?? section;
	live.querySelectorAll('.lb-preview-body').forEach((old) => old.remove());
	live.appendChild(el);
}
