import type {
	BasesEntry,
	BasesPropertyId,
	HoverParent,
	HoverPopover,
	QueryController} from 'obsidian';
import {
	BasesView,
	Keymap,
	Menu,
	Notice,
	TFile,
	parsePropertyId
} from 'obsidian';
import { setIcon } from 'obsidian';
import { renderPropertyInspector, showOptionColorMenu } from './inspector';
import { accentFor } from './accents';
import { applyOptionColor, onOptionColorsChanged, optionAccent } from './option-colors';
import { clampCardLimit, orderColumns } from './board-utils';
import { mergeTemplateFrontmatter, parseTemplatePath, stripFrontmatter } from './template-utils';
import {
	isLicensed,
	onLicenseChanged,
	renderLicenseBanner,
	requireLicense,
} from './license-state';

export const CRISP_BASE_BOARD_VIEW_TYPE = 'crisp-base-board';

interface CardProperty {
	id: BasesPropertyId;
	displayName: string;
}

interface NoteTemplate {
	frontmatter: Record<string, unknown> | undefined;
	body: string;
}

export class CrispBaseBoardView extends BasesView implements HoverParent {
	readonly type = CRISP_BASE_BOARD_VIEW_TYPE;
	hoverPopover: HoverPopover | null = null;

	private containerEl: HTMLElement;
	private knownLabels: string[] = [];
	private selectedPath: string | null = null;

	constructor(controller: QueryController, parentEl: HTMLElement) {
		super(controller);
		this.containerEl = parentEl.createDiv({ cls: 'lb-view' });
		onLicenseChanged(this.app, this, () => this.render());
		onOptionColorsChanged(this.app, this, () => this.render());
	}

	onDataUpdated(): void {
		this.render();
	}

	/* ------------------------------------------------------------------ */
	/* Rendering                                                           */
	/* ------------------------------------------------------------------ */

	private render(): void {
		this.containerEl.empty();
		if (!isLicensed()) {
			renderLicenseBanner(this.containerEl);
		}

		const groupBy = this.resolveGroupBy();
		const entries = this.data.data;
		const limit = this.getCardLimit();
		const extraColumns = this.getExtraColumns();

		const columns = new Map<string, BasesEntry[]>();
		for (const entry of entries) {
			const label = groupBy ? this.entryLabel(entry, groupBy) : '全部笔记';
			const list = columns.get(label) ?? [];
			list.push(entry);
			columns.set(label, list);
		}
		this.knownLabels = orderColumns(
			columns,
			extraColumns,
			this.getColumnOrder(),
		).map(([label]) => label);

		this.renderToolbar();

		const content = this.containerEl.createDiv({ cls: 'lb-content' });
		const board = content.createDiv({ cls: 'lb-board' });
		if (columns.size === 0 && extraColumns.length === 0) {
			this.renderEmptyBoard(board);
			return;
		}

		for (const [label, groupEntries] of orderColumns(
			columns,
			extraColumns,
			this.getColumnOrder(),
		)) {
			if (groupEntries) {
				this.renderColumn(board, groupBy, label, groupEntries, limit);
			} else {
				this.renderEmptyColumn(board, groupBy, label);
			}
		}

		const selected = entries.find((entry) => entry.file.path === this.selectedPath);
		if (selected && groupBy) {
			renderPropertyInspector(content, selected, {
				app: this.app,
				config: this.config,
				host: this,
				entries: this.data.data,
				groupBy,
				knownLabels: this.knownLabels,
				onChanged: () => this.render(),
				onClose: () => {
					this.selectedPath = null;
					this.render();
				},
			});
		}
	}

	private getColumnOrder(): string[] {
		const value = this.config.get('board.columnOrder');
		if (!Array.isArray(value)) return [];
		return value.filter((entry): entry is string => typeof entry === 'string');
	}

	private renderToolbar(): void {
		const toolbar = this.containerEl.createDiv({ cls: 'lb-toolbar' });
		const title = toolbar.createDiv({ cls: 'lb-toolbar-title' });
		title.setText(this.config.name || 'Crisp Base 看板');
		const newNoteButton = toolbar.createEl('button', { cls: 'lb-button' });
		setIcon(newNoteButton, 'plus');
		newNoteButton.createSpan({ text: '新建笔记' });
		newNoteButton.addEventListener('click', () => {
			this.createNote();
		});
	}

	private renderEmptyBoard(board: HTMLElement): void {
		const empty = board.createDiv({ cls: 'lb-empty' });
		empty.createDiv({ text: '当前 Base 还没有匹配的笔记。', cls: 'lb-empty-hint' });
		const button = empty.createEl('button', { cls: 'lb-button' });
		setIcon(button, 'plus');
		button.createSpan({ text: '创建笔记' });
		button.addEventListener('click', () => {
			this.createNote();
		});
	}

	private renderColumn(
		board: HTMLElement,
		groupBy: BasesPropertyId | null,
		label: string,
		entries: BasesEntry[],
		limit: number,
	): void {
		const cards = this.renderColumnShell(board, groupBy, label, entries.length);
		for (const entry of entries.slice(0, limit)) {
			this.renderCard(cards, entry, groupBy);
		}
		if (entries.length > limit) {
			const more = cards.createDiv({
				cls: 'lb-column-more',
				text: `另有 ${entries.length - limit} 张`,
			});
			more.addEventListener('click', () => {
				this.config.set('board.cardLimit', limit + Math.max(100, limit));
				this.render();
			});
		}
		this.renderColumnNewRow(cards, groupBy, label);
	}

	private renderEmptyColumn(
		board: HTMLElement,
		groupBy: BasesPropertyId | null,
		label: string,
	): void {
		if (!label) return;
		const cards = this.renderColumnShell(board, groupBy, label, 0);
		this.renderColumnNewRow(cards, groupBy, label);
	}

	/** Column frame with header; returns the card container. */
	private renderColumnShell(
		board: HTMLElement,
		groupBy: BasesPropertyId | null,
		label: string,
		count: number,
	): HTMLElement {
		const property = this.groupProperty(groupBy);
		const column = board.createDiv({ cls: 'lb-column' });
		column.style.setProperty(
			'--lb-accent',
			label === 'No value' ? accentFor(label) : optionAccent(property, label),
		);
		this.attachDropTarget(column, groupBy, label);

		const header = column.createDiv({ cls: 'lb-column-header' });
		header.createDiv({ cls: 'lb-column-dot' });
		header.createDiv({
			cls: 'lb-column-title',
			text: label === 'No value' ? '无值' : label,
		});
		header.createDiv({ cls: 'lb-column-count', text: String(count) });
		const addButton = header.createDiv({ cls: 'lb-column-add', attr: { 'aria-label': '在此列新建' } });
		setIcon(addButton, 'plus');
		addButton.addEventListener('click', () => {
			this.createNoteInColumn(groupBy, label);
		});
		if (property && label !== 'No value') {
			header.addEventListener('contextmenu', (event: MouseEvent) => {
				event.preventDefault();
				showOptionColorMenu(event, property, label);
			});
		}
		return column.createDiv({ cls: 'lb-column-cards' });
	}

	private renderColumnNewRow(
		cards: HTMLElement,
		groupBy: BasesPropertyId | null,
		label: string,
	): void {
		const row = cards.createDiv({ cls: 'lb-column-new' });
		setIcon(row.createSpan({ cls: 'lb-column-new-icon' }), 'plus');
		row.createSpan({ text: '新建' });
		row.addEventListener('click', () => {
			this.createNoteInColumn(groupBy, label);
		});
	}

	private createNoteInColumn(groupBy: BasesPropertyId | null, label: string): void {
		this.createNote((frontmatter) => {
			if (!groupBy || label === 'No value') return;
			const { name, type } = parsePropertyId(groupBy);
			if (type === 'note') {
				frontmatter[name] = label;
			}
		});
	}

	private renderCard(
		cards: HTMLElement,
		entry: BasesEntry,
		groupBy: BasesPropertyId | null,
	): void {
		const card = cards.createDiv({ cls: 'lb-card' });
		if (entry.file.path === this.selectedPath) {
			card.addClass('is-selected');
		}
		if (groupBy) {
			card.setAttr('draggable', 'true');
			card.addEventListener('dragstart', (event: DragEvent) => {
				event.dataTransfer?.setData('application/x-crisp-base-card', entry.file.path);
				event.dataTransfer?.setData('text/plain', entry.file.path);
				if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
				card.addClass('is-dragging');
			});
			card.addEventListener('dragend', () => {
				card.removeClass('is-dragging');
				this.clearDropTargets();
			});
		}
		card.addEventListener('click', () => {
			this.selectedPath =
				this.selectedPath === entry.file.path ? null : entry.file.path;
			this.render();
		});

		const topRow = card.createDiv({ cls: 'lb-card-top' });
		const title = topRow.createDiv({ cls: 'lb-card-title' });
		title.setText(entry.file.basename);
		title.addEventListener('click', (event: MouseEvent) => {
			if (event.button !== 0 && event.button !== 1) return;
			event.preventDefault();
			event.stopPropagation();
			const modEvent = Keymap.isModEvent(event);
			void this.app.workspace.openLinkText(entry.file.path, '', modEvent);
		});
		title.addEventListener('mouseover', (event: MouseEvent) => {
			this.app.workspace.trigger('hover-link', {
				event,
				source: 'linear-board',
				hoverParent: this,
				targetEl: title,
				linktext: entry.file.path,
			});
		});

		const menuButton = topRow.createDiv({ cls: 'lb-card-menu' });
		setIcon(menuButton, 'more-horizontal');
		menuButton.addEventListener('click', (event: MouseEvent) => {
			event.stopPropagation();
			this.showCardMenu(event, entry, groupBy);
		});

		const chips = this.cardProperties(groupBy);
		if (chips.length > 0) {
			const chipRow = card.createDiv({ cls: 'lb-card-chips' });
			for (const chip of chips) {
				const value = entry.getValue(chip.id);
				if (!value || !value.isTruthy()) continue;
				const chipEl = chipRow.createDiv({
					cls: 'lb-chip',
					attr: { title: chip.displayName },
				});
				chipEl.setText(value.toString());
				applyOptionColor(chipEl, this.groupProperty(chip.id), value.toString());
			}
		}
	}

	/* ------------------------------------------------------------------ */
	/* Drag & drop                                                         */
	/* ------------------------------------------------------------------ */

	private attachDropTarget(
		column: HTMLElement,
		groupBy: BasesPropertyId | null,
		label: string,
	): void {
		if (!groupBy) return;
		column.addEventListener('dragover', (event: DragEvent) => {
			event.preventDefault();
			if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
			column.addClass('is-drop-target');
		});
		column.addEventListener('dragleave', (event: DragEvent) => {
			const related = event.relatedTarget as Node | null;
			if (!related || !column.contains(related)) {
				column.removeClass('is-drop-target');
			}
		});
		column.addEventListener('drop', (event: DragEvent) => {
			event.preventDefault();
			column.removeClass('is-drop-target');
			const path = event.dataTransfer?.getData('application/x-crisp-base-card');
			if (!path || !groupBy) return;
			const file = this.app.vault.getFileByPath(path);
			if (!file) return;
			const value = label === 'No value' ? null : label;
			void this.setNoteProperty(file, groupBy, value);
		});
	}

	private clearDropTargets(): void {
		for (const el of this.containerEl.querySelectorAll('.is-drop-target')) {
			el.removeClass('is-drop-target');
		}
	}

	private showCardMenu(
		event: MouseEvent,
		entry: BasesEntry,
		groupBy: BasesPropertyId | null,
	): void {
		const menu = new Menu();

		menu.addItem((item) =>
			item
				.setTitle('打开笔记')
				.setIcon('file-text')
				.onClick(() => {
					void this.app.workspace.openLinkText(entry.file.path, '');
				}),
		);

		if (groupBy && parsePropertyId(groupBy).type === 'note') {
			menu.addSeparator();
			const current = entry.getValue(groupBy)?.toString() ?? null;
			for (const label of this.knownLabels) {
				if (label === 'No value') continue;
				menu.addItem((item) =>
					item
						.setTitle(`移动到“${label}”`)
						.setChecked(label === current)
						.onClick(() => {
							void this.setNoteProperty(entry.file, groupBy, label);
						}),
				);
			}
			menu.addItem((item) =>
				item
					.setTitle('清除分组值')
					.setIcon('eraser')
					.onClick(() => {
						void this.setNoteProperty(entry.file, groupBy, null);
					}),
			);
		}

		menu.showAtMouseEvent(event);
	}

	/* ------------------------------------------------------------------ */
	/* Data helpers                                                        */
	/* ------------------------------------------------------------------ */

	private resolveGroupBy(): BasesPropertyId | null {
		const fromConfig = this.config.getAsPropertyId('board.groupBy');
		if (fromConfig) return fromConfig;

		const noteProperties = this.allProperties.filter(
			(propertyId) => parsePropertyId(propertyId).type === 'note',
		);
		return (
			noteProperties.find((propertyId) => parsePropertyId(propertyId).name === 'status') ??
			noteProperties[0] ??
			null
		);
	}

	private groupProperty(propertyId: BasesPropertyId | null): string | null {
		if (!propertyId) return null;
		const { type, name } = parsePropertyId(propertyId);
		return type === 'note' ? name : null;
	}

	private entryLabel(entry: BasesEntry, groupBy: BasesPropertyId): string {
		const value = entry.getValue(groupBy);
		if (!value || !value.isTruthy()) return 'No value';
		return value.toString();
	}

	private cardProperties(groupBy: BasesPropertyId | null): CardProperty[] {
		return this.config
			.getOrder()
			.filter((propertyId) => {
				const { type, name } = parsePropertyId(propertyId);
				if (type === 'file' && name === 'name') return false;
				return propertyId !== groupBy;
			})
			.slice(0, 4)
			.map((propertyId) => ({
				id: propertyId,
				displayName: this.config.getDisplayName(propertyId),
			}));
	}

	private getCardLimit(): number {
		return clampCardLimit(this.config.get('board.cardLimit'));
	}

	private getExtraColumns(): string[] {
		const value = this.config.get('board.extraColumns');
		if (!Array.isArray(value)) return [];
		return value.filter((entry): entry is string => typeof entry === 'string');
	}

	private async setNoteProperty(
		file: TFile,
		groupBy: BasesPropertyId,
		value: string | null,
	): Promise<void> {
		if (!requireLicense()) return;
		const { name } = parsePropertyId(groupBy);
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			if (value === null) {
				delete frontmatter[name];
			} else {
				frontmatter[name] = value;
			}
		});
		this.render();
	}

	private createNote(
		frontmatterProcessor?: (frontmatter: Record<string, unknown>) => void,
	): void {
		if (!requireLicense()) return;
		void this.createNoteFromTemplate(frontmatterProcessor);
	}

	private async createNoteFromTemplate(
		frontmatterProcessor?: (frontmatter: Record<string, unknown>) => void,
	): Promise<void> {
		const template = await this.loadTemplate();
		// createFileForView does not return the new file; catch it from the vault's create event.
		const created: TFile[] = [];
		const ref = this.app.vault.on('create', (file) => {
			if (file instanceof TFile && file.extension === 'md') created.push(file);
		});
		try {
			await this.createFileForView(undefined, (frontmatter: Record<string, unknown>) => {
				frontmatterProcessor?.(frontmatter);
				mergeTemplateFrontmatter(frontmatter, template?.frontmatter);
			});
		} finally {
			this.app.vault.offref(ref);
		}
		const file = created.length === 1 ? created[0] : null;
		if (!file) return;
		if (template && template.body.trim() !== '') {
			await this.app.vault.process(file, (data) =>
				// Only fill a note that is still empty below its frontmatter.
				stripFrontmatter(data).trim() === '' ? `${data.replace(/\s*$/, '\n')}${template.body}` : data,
			);
		}
		this.selectedPath = file.path;
		this.render();
	}

	private async loadTemplate(): Promise<NoteTemplate | null> {
		const path = parseTemplatePath(this.config.get('board.template'));
		if (!path) return null;
		const file =
			this.app.metadataCache.getFirstLinkpathDest(path, '') ?? this.app.vault.getFileByPath(path);
		if (!(file instanceof TFile)) {
			new Notice(`Crisp Base：找不到模板「${path}」，已按空白笔记新建。`);
			return null;
		}
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter as
			| Record<string, unknown>
			| undefined;
		return { frontmatter, body: stripFrontmatter(await this.app.vault.cachedRead(file)) };
	}
}
