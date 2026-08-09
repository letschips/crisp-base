import type {
	App,
	BasesEntry,
	BasesPropertyId,
	BasesViewConfig,
	TFile,
} from 'obsidian';
import { parsePropertyId } from 'obsidian';
import { setIcon } from 'obsidian';
import { requireLicense } from './license-state';

export interface InspectorOptions {
	app: App;
	config: BasesViewConfig;
	/** Note property used for board columns; renders a dropdown when set. */
	groupBy: BasesPropertyId | null;
	knownLabels: string[];
	onChanged: () => void;
	onClose: () => void;
}

/**
 * Notion-like editable property inspector. Mounts into a right-side panel
 * container and writes edits back to the note frontmatter.
 */
export function renderPropertyInspector(
	content: HTMLElement,
	entry: BasesEntry,
	options: InspectorOptions,
): void {
	const { app, config, groupBy, knownLabels, onChanged, onClose } = options;
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

	let groupByName: string | null = null;
	if (groupBy && parsePropertyId(groupBy).type === 'note') {
		groupByName = parsePropertyId(groupBy).name;
		renderGroupByField(fields, app, config, entry, groupBy, knownLabels, onChanged);
	}

	const frontmatter = app.metadataCache.getFileCache(entry.file)?.frontmatter;
	if (frontmatter) {
		for (const [key, value] of Object.entries(frontmatter)) {
			if (key === 'crisp_type' || key === groupByName) continue;
			renderField(fields, app, entry.file, key, value, onChanged);
		}
	} else {
		fields.createDiv({ cls: 'lb-inspector-hint', text: '这篇笔记还没有属性。' });
	}

	const actions = inspector.createDiv({ cls: 'lb-inspector-actions' });
	const openButton = actions.createEl('button', { cls: 'lb-button' });
	setIcon(openButton, 'external-link');
	openButton.createSpan({ text: '打开笔记' });
	openButton.addEventListener('click', () => {
		void app.workspace.openLinkText(entry.file.path, '');
	});
}

function renderGroupByField(
	fields: HTMLElement,
	app: App,
	config: BasesViewConfig,
	entry: BasesEntry,
	groupBy: BasesPropertyId,
	knownLabels: string[],
	onChanged: () => void,
): void {
	const row = fields.createDiv({ cls: 'lb-field' });
	row.createDiv({
		cls: 'lb-field-label',
		text: config.getDisplayName(groupBy),
	});
	const select = row.createEl('select', { cls: 'lb-field-select' });

	const current = entry.getValue(groupBy)?.toString() ?? null;
	const values = [null, ...knownLabels].filter(
		(value, index, all) =>
			value === null || (value !== 'No value' && all.indexOf(value) === index),
	);
	for (const value of values) {
		const option = select.createEl('option', {
			text: value ?? '无值',
			value: value ?? '',
		});
		option.selected = value === current;
	}
	select.addEventListener('change', () => {
		void setNoteProperty(app, entry.file, groupBy, select.value || null, onChanged);
	});
}

function renderField(
	fields: HTMLElement,
	app: App,
	file: TFile,
	key: string,
	value: unknown,
	onChanged: () => void,
): void {
	const row = fields.createDiv({ cls: 'lb-field' });
	row.createDiv({ cls: 'lb-field-label', text: key });
	const control = row.createDiv({ cls: 'lb-field-control' });

	if (typeof value === 'boolean') {
		const checkbox = control.createEl('input', { type: 'checkbox' });
		checkbox.checked = value;
		checkbox.addEventListener('change', () => {
			void updateNoteProperty(app, file, key, checkbox.checked, onChanged);
		});
		return;
	}

	if (typeof value === 'number') {
		const input = control.createEl('input', {
			type: 'number',
			attr: { value: String(value) },
		});
		input.addEventListener('change', () => {
			const trimmed = input.value.trim();
			if (trimmed === '') {
				void updateNoteProperty(app, file, key, null, onChanged);
				return;
			}
			const numeric = Number(trimmed);
			if (!isNaN(numeric)) {
				void updateNoteProperty(app, file, key, numeric, onChanged);
			}
		});
		return;
	}

	if (Array.isArray(value)) {
		const input = control.createEl('input', {
			type: 'text',
			attr: { value: value.join(', ') },
		});
		input.placeholder = 'a, b, c';
		input.addEventListener('change', () => {
			void updateNoteProperty(app, file, key, parseList(input.value), onChanged);
		});
		return;
	}

	const input = control.createEl('input', {
		type: 'text',
		attr: { value: typeof value === 'string' ? value : '' },
	});
	input.placeholder = '空';
	input.addEventListener('change', () => {
		void updateNoteProperty(
			app,
			file,
			key,
			input.value === '' ? null : input.value,
			onChanged,
		);
	});
}

function parseList(value: string): string[] | null {
	const items = value
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean);
		return items.length > 0 ? items : null;
}

async function setNoteProperty(
	app: App,
	file: TFile,
	groupBy: BasesPropertyId,
	value: string | null,
	onChanged: () => void,
): Promise<void> {
	if (!requireLicense()) return;
	const { name } = parsePropertyId(groupBy);
	await updateNoteProperty(app, file, name, value, onChanged);
}

async function updateNoteProperty(
	app: App,
	file: TFile,
	name: string,
	value: unknown,
	onChanged: () => void,
): Promise<void> {
	if (!requireLicense()) return;
	await app.fileManager.processFrontMatter(file, (frontmatter) => {
		if (value === null) {
			delete frontmatter[name];
		} else {
			frontmatter[name] = value;
		}
	});
	onChanged();
}
