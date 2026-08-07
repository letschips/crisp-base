import type {
	BasesEntry,
	BasesPropertyId,
	HoverParent,
	HoverPopover,
	QueryController} from 'obsidian';
import {
	BasesView,
	parsePropertyId
} from 'obsidian';
import { setIcon } from 'obsidian';
import { renderPropertyInspector } from './inspector';
import { extractISODate, toISODate } from './dates';
import {
	isLicensed,
	onLicenseChanged,
	renderLicenseBanner,
	requireLicense,
} from './license-state';

export const CRISP_BASE_CALENDAR_VIEW_TYPE = 'crisp-base-calendar';

const WEEKDAY_LABELS_SUNDAY = ['日', '一', '二', '三', '四', '五', '六'];
const WEEKDAY_LABELS_MONDAY = ['一', '二', '三', '四', '五', '六', '日'];

export class CrispBaseCalendarView extends BasesView implements HoverParent {
	readonly type = CRISP_BASE_CALENDAR_VIEW_TYPE;
	hoverPopover: HoverPopover | null = null;

	private containerEl: HTMLElement;
	private cursorYear: number;
	private cursorMonth: number;
	private selectedPath: string | null = null;

	constructor(controller: QueryController, parentEl: HTMLElement) {
		super(controller);
		const now = new Date();
		this.cursorYear = now.getFullYear();
		this.cursorMonth = now.getMonth();
		this.containerEl = parentEl.createDiv({ cls: 'lb-view cc-calendar' });
		onLicenseChanged(this.app, this, () => this.render());
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

		const dateProperty = this.resolveDateProperty();
		const entriesByDay = new Map<string, BasesEntry[]>();
		let parsedAny = false;
		for (const entry of this.data.data) {
			if (!dateProperty) break;
			const value = entry.getValue(dateProperty);
			if (!value || !value.isTruthy()) continue;
			const iso = extractISODate(value.toString());
			if (!iso) continue;
			parsedAny = true;
			const list = entriesByDay.get(iso) ?? [];
			list.push(entry);
		entriesByDay.set(iso, list);
	}

		if (!dateProperty) {
			this.renderToolbar(dateProperty);
			this.renderHint(
				'Choose a "Date property" in the view settings to show notes on the calendar.',
			);
			return;
		}
		if (!parsedAny) {
			this.renderToolbar(dateProperty);
			this.renderHint(
				'No notes with a valid date were found. Add dates to the "' +
					this.config.getDisplayName(dateProperty) +
					'" property or pick a different property.',
			);
			return;
		}

		this.renderToolbar(dateProperty);

		const content = this.containerEl.createDiv({ cls: 'lb-content' });
		const grid = content.createDiv({ cls: 'cc-grid' });
		const weekStart = this.getWeekStart();
		const labels =
			weekStart === 'sunday' ? WEEKDAY_LABELS_SUNDAY : WEEKDAY_LABELS_MONDAY;
		for (const label of labels) {
			grid.createDiv({ cls: 'cc-weekday', text: label });
		}

		const firstDay = new Date(this.cursorYear, this.cursorMonth, 1);
		const offset =
			weekStart === 'sunday' ? firstDay.getDay() : (firstDay.getDay() + 6) % 7;
		const gridStart = new Date(this.cursorYear, this.cursorMonth, 1 - offset);
		const today = new Date();
		const todayISO = toISODate(
			today.getFullYear(),
			today.getMonth(),
			today.getDate(),
		);

		for (let index = 0; index < 42; index++) {
			const date = new Date(
				gridStart.getFullYear(),
				gridStart.getMonth(),
				gridStart.getDate() + index,
			);
			const iso = toISODate(date.getFullYear(), date.getMonth(), date.getDate());
			const outside = date.getMonth() !== this.cursorMonth;
			const cell = grid.createDiv({
				cls: [
					'cc-day',
					outside ? 'is-outside' : '',
					iso === todayISO ? 'is-today' : '',
				].join(' '),
			});
			const header = cell.createDiv({ cls: 'cc-day-header' });
			header.createDiv({ cls: 'cc-day-num', text: String(date.getDate()) });
			const addButton = header.createDiv({ cls: 'cc-day-add' });
			setIcon(addButton, 'plus');
			addButton.addEventListener('click', () => {
				if (!dateProperty) return;
				this.createNote((frontmatter) => {
					const { name, type } = parsePropertyId(dateProperty);
					if (type === 'note') {
						frontmatter[name] = iso;
					}
				});
			});

			const chips = cell.createDiv({ cls: 'cc-day-chips' });
			for (const entry of entriesByDay.get(iso) ?? []) {
				this.renderChip(chips, entry);
			}
		}

		const selected = this.data.data.find(
			(entry) => entry.file.path === this.selectedPath,
		);
		if (selected) {
			renderPropertyInspector(content, selected, {
				app: this.app,
				config: this.config,
				groupBy: null,
				knownLabels: [],
				onChanged: () => this.render(),
				onClose: () => {
					this.selectedPath = null;
					this.render();
				},
			});
		}
	}

	private renderToolbar(dateProperty: BasesPropertyId | null): void {
		const toolbar = this.containerEl.createDiv({ cls: 'lb-toolbar cc-toolbar' });

		const prev = toolbar.createEl('button', { cls: 'lb-button cc-nav' });
		setIcon(prev, 'chevron-left');
		prev.addEventListener('click', () => {
			this.shiftMonth(-1);
		});

		const label = toolbar.createDiv({
			cls: 'cc-month-label',
			text: `${this.cursorYear} 年 ${this.cursorMonth + 1} 月`,
		});
		label.addEventListener('click', () => {
			const now = new Date();
			this.cursorYear = now.getFullYear();
			this.cursorMonth = now.getMonth();
			this.render();
		});

		const next = toolbar.createEl('button', { cls: 'lb-button cc-nav' });
		setIcon(next, 'chevron-right');
		next.addEventListener('click', () => {
			this.shiftMonth(1);
		});

		const todayButton = toolbar.createEl('button', {
			cls: 'lb-button',
			text: 'Today',
		});
		todayButton.addEventListener('click', () => {
			const now = new Date();
			this.cursorYear = now.getFullYear();
			this.cursorMonth = now.getMonth();
			this.render();
		});

		const newNoteButton = toolbar.createEl('button', { cls: 'lb-button' });
		setIcon(newNoteButton, 'plus');
		newNoteButton.createSpan({ text: 'New note' });
		newNoteButton.addEventListener('click', () => {
			this.createNote();
		});

		if (dateProperty) {
			toolbar.createDiv({
				cls: 'cc-date-prop',
				text: this.config.getDisplayName(dateProperty),
				attr: { title: 'Calendar date property' },
			});
		}
	}

	private renderHint(message: string): void {
		const empty = this.containerEl.createDiv({ cls: 'lb-empty' });
		empty.createDiv({ cls: 'lb-empty-hint', text: message });
	}

	private renderChip(chips: HTMLElement, entry: BasesEntry): void {
		const chip = chips.createDiv({ cls: 'cc-chip' });
		chip.setText(entry.file.basename);
		if (entry.file.path === this.selectedPath) {
			chip.addClass('is-selected');
		}
		chip.addEventListener('click', () => {
			this.selectedPath =
				this.selectedPath === entry.file.path ? null : entry.file.path;
			this.render();
		});
		chip.addEventListener('mouseover', (event: MouseEvent) => {
			this.app.workspace.trigger('hover-link', {
				event,
				source: 'crisp-base-calendar',
				hoverParent: this,
				targetEl: chip,
				linktext: entry.file.path,
			});
		});
	}

	/* ------------------------------------------------------------------ */
	/* Data helpers                                                        */
	/* ------------------------------------------------------------------ */

	private resolveDateProperty(): BasesPropertyId | null {
		const fromConfig = this.config.getAsPropertyId('calendar.dateProperty');
		if (fromConfig) return fromConfig;

		const noteProperties = this.allProperties.filter(
			(propertyId) => parsePropertyId(propertyId).type === 'note',
		);
		const candidates = [
			'due',
			'date',
			'start',
			'startDate',
			'scheduled',
			'deadline',
		];
		for (const candidate of candidates) {
			const found = noteProperties.find(
				(propertyId) => parsePropertyId(propertyId).name === candidate,
			);
			if (found) return found;
		}
		return noteProperties[0] ?? null;
	}

	private getWeekStart(): 'monday' | 'sunday' {
		return this.config.get('calendar.weekStart') === 'sunday'
			? 'sunday'
			: 'monday';
	}

	private shiftMonth(delta: number): void {
		const date = new Date(this.cursorYear, this.cursorMonth + delta, 1);
		this.cursorYear = date.getFullYear();
		this.cursorMonth = date.getMonth();
		this.render();
	}

	private createNote(
		frontmatterProcessor?: (frontmatter: Record<string, unknown>) => void,
	): void {
		if (!requireLicense()) return;
		void this.createFileForView(undefined, frontmatterProcessor);
	}
}
