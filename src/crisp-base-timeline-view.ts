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
import { accentFor } from './accents';
import {
	isLicensed,
	onLicenseChanged,
	renderLicenseBanner,
	requireLicense,
} from './license-state';
import {
	addDays,
	dateToISO,
	daysBetween,
	extractISODate,
	isoToDate,
} from './dates';

export const CRISP_BASE_TIMELINE_VIEW_TYPE = 'crisp-base-timeline';

const PX_PER_DAY: Record<string, number> = {
	compact: 18,
	normal: 28,
	wide: 44,
};

const LANE_LABEL_WIDTH = 150;

function readableTextColor(hex: string): string {
	const value = hex.replace('#', '');
	const r = parseInt(value.slice(0, 2), 16);
	const g = parseInt(value.slice(2, 4), 16);
	const b = parseInt(value.slice(4, 6), 16);
	const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
	return luminance > 0.62 ? '#1e1e1e' : '#ffffff';
}

interface TimelineItem {
	entry: BasesEntry;
	startISO: string;
	endISO: string;
}

export class CrispBaseTimelineView extends BasesView implements HoverParent {
	readonly type = CRISP_BASE_TIMELINE_VIEW_TYPE;
	hoverPopover: HoverPopover | null = null;

	private containerEl: HTMLElement;
	private selectedPath: string | null = null;
	private knownLabels: string[] = [];

	constructor(controller: QueryController, parentEl: HTMLElement) {
		super(controller);
		this.containerEl = parentEl.createDiv({ cls: 'lb-view cc-timeline' });
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

		const startProperty = this.resolveStartProperty();
		if (!startProperty) {
			this.renderHint(
				'Choose a "Start date property" in the view settings to show notes on the timeline.',
			);
			return;
		}

		const endProperty = this.resolveEndProperty();
		const groupBy = this.resolveGroupBy();
		const pxPerDay = this.getPxPerDay();

		const items: TimelineItem[] = [];
		for (const entry of this.data.data) {
			const startValue = entry.getValue(startProperty);
			if (!startValue || !startValue.isTruthy()) continue;
			const startISO = extractISODate(startValue.toString());
			if (!startISO) continue;
			let endISO = startISO;
			if (endProperty) {
				const endValue = entry.getValue(endProperty);
				if (endValue && endValue.isTruthy()) {
					endISO = extractISODate(endValue.toString()) ?? startISO;
				}
			}
			if (daysBetween(startISO, endISO) < 0) {
				endISO = startISO;
			}
			items.push({ entry, startISO, endISO });
		}

		if (items.length === 0) {
			this.renderHint(
				'No notes with a valid start date were found. Add dates to the "' +
					this.config.getDisplayName(startProperty) +
					'" property or pick a different property.',
			);
			return;
		}

		let minISO = items[0].startISO;
		let maxISO = items[0].endISO;
		for (const item of items) {
			if (item.startISO < minISO) minISO = item.startISO;
			if (item.endISO > maxISO) maxISO = item.endISO;
		}
		minISO = addDays(minISO, -14);
		maxISO = addDays(maxISO, 14);
		if (daysBetween(minISO, maxISO) < 30) {
			maxISO = addDays(minISO, 30);
		}
		const totalDays = daysBetween(minISO, maxISO) + 1;
		const canvasWidth = totalDays * pxPerDay;

		const lanes = new Map<string, TimelineItem[]>();
		for (const item of items) {
			let label = 'All';
			if (groupBy) {
				const value = item.entry.getValue(groupBy);
				label = value && value.isTruthy() ? value.toString() : 'No value';
			}
			const list = lanes.get(label) ?? [];
			list.push(item);
			lanes.set(label, list);
		}
		this.knownLabels = [...lanes.keys()];

		this.renderToolbar(items.length, minISO, maxISO);

		const content = this.containerEl.createDiv({ cls: 'lb-content' });
		const scroll = content.createDiv({ cls: 'cc-tl-scroll' });
		const inner = scroll.createDiv({ cls: 'cc-tl-inner' });
		inner.style.width = `${Math.max(canvasWidth, 600)}px`;

		this.renderHeader(inner, minISO, totalDays, pxPerDay);

		const body = inner.createDiv({ cls: 'cc-tl-body' });
		const todayISO = dateToISO(new Date());
		if (todayISO >= minISO && todayISO <= maxISO) {
			const todayLine = body.createDiv({ cls: 'cc-tl-today' });
			todayLine.style.left = `${daysBetween(minISO, todayISO) * pxPerDay}px`;
		}

		for (const [label, laneItems] of lanes) {
			this.renderLane(body, label, laneItems, minISO, pxPerDay);
		}

		const selected = this.data.data.find(
			(entry) => entry.file.path === this.selectedPath,
		);
		if (selected) {
			renderPropertyInspector(content, selected, {
				app: this.app,
				config: this.config,
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

	private renderHeader(
		inner: HTMLElement,
		minISO: string,
		totalDays: number,
		pxPerDay: number,
	): void {
		const header = inner.createDiv({ cls: 'cc-tl-header' });
		const months = header.createDiv({ cls: 'cc-tl-months' });
		const days = header.createDiv({ cls: 'cc-tl-days' });
		const todayISO = dateToISO(new Date());

		let currentMonth = '';
		let monthWidth = 0;
		let monthEl: HTMLElement | null = null;
		for (let offset = 0; offset < totalDays; offset++) {
			const iso = addDays(minISO, offset);
			const date = isoToDate(iso);
			const monthKey = `${date.getFullYear()}-${date.getMonth() + 1}`;
			if (monthKey !== currentMonth) {
				currentMonth = monthKey;
				monthWidth = pxPerDay;
				monthEl = months.createDiv({
					cls: 'cc-tl-month',
					text: `${date.getFullYear()}-${date.getMonth() + 1}`,
				});
			} else {
				monthWidth += pxPerDay;
			}
			if (monthEl) monthEl.style.width = `${monthWidth}px`;

			const day = days.createDiv({
				cls: [
					'cc-tl-day',
					iso === todayISO ? 'is-today' : '',
					date.getDay() === 0 || date.getDay() === 6 ? 'is-weekend' : '',
				].join(' '),
				text: String(date.getDate()),
			});
			day.style.width = `${pxPerDay}px`;
		}
	}

	private renderLane(
		body: HTMLElement,
		label: string,
		items: TimelineItem[],
		minISO: string,
		pxPerDay: number,
	): void {
		const accent = accentFor(label);
		const lane = body.createDiv({ cls: 'cc-tl-lane' });
		lane.style.setProperty('--cc-tl-accent', accent);

		const labelEl = lane.createDiv({ cls: 'cc-tl-lane-label' });
		labelEl.style.width = `${LANE_LABEL_WIDTH}px`;
		labelEl.createDiv({ cls: 'cc-tl-lane-dot' });
		labelEl.createDiv({ cls: 'cc-tl-lane-name', text: label });

		const track = lane.createDiv({ cls: 'cc-tl-lane-track' });
		for (const item of items) {
			this.renderBar(track, item, minISO, pxPerDay, accent);
		}
	}

	private renderBar(
		track: HTMLElement,
		item: TimelineItem,
		minISO: string,
		pxPerDay: number,
		accent: string,
	): void {
		const left = daysBetween(minISO, item.startISO) * pxPerDay;
		const span = Math.max(daysBetween(item.startISO, item.endISO) + 1, 0.6);
		const width = Math.max(span * pxPerDay - 2, 10);

		const bar = track.createDiv({ cls: 'cc-tl-bar' });
		bar.style.left = `${left}px`;
		bar.style.width = `${width}px`;
		bar.style.background = 'var(--cc-tl-accent)';
		bar.style.color = readableTextColor(accent);
		bar.setText(item.entry.file.basename);
		if (item.entry.file.path === this.selectedPath) {
			bar.addClass('is-selected');
		}

		bar.addEventListener('click', () => {
			this.selectedPath =
				this.selectedPath === item.entry.file.path
					? null
					: item.entry.file.path;
			this.render();
		});
		bar.addEventListener('mouseover', (event: MouseEvent) => {
			this.app.workspace.trigger('hover-link', {
				event,
				source: 'crisp-base-timeline',
				hoverParent: this,
				targetEl: bar,
				linktext: item.entry.file.path,
			});
		});
	}

	private renderToolbar(
		count: number,
		minISO: string,
		maxISO: string,
	): void {
		const toolbar = this.containerEl.createDiv({
			cls: 'lb-toolbar cc-tl-toolbar',
		});
		toolbar.createDiv({
			cls: 'cc-tl-title',
			text: `Timeline · ${count} items`,
		});
		toolbar.createDiv({
			cls: 'cc-tl-range',
			text: `${minISO} → ${maxISO}`,
		});
		const newNoteButton = toolbar.createEl('button', { cls: 'lb-button' });
		setIcon(newNoteButton, 'plus');
		newNoteButton.createSpan({ text: 'New note' });
		newNoteButton.addEventListener('click', () => {
			this.createNote();
		});
	}

	private renderHint(message: string): void {
		const empty = this.containerEl.createDiv({ cls: 'lb-empty' });
		empty.createDiv({ cls: 'lb-empty-hint', text: message });
	}

	/* ------------------------------------------------------------------ */
	/* Data helpers                                                        */
	/* ------------------------------------------------------------------ */

	private resolveStartProperty(): BasesPropertyId | null {
		const fromConfig = this.config.getAsPropertyId('timeline.startDate');
		if (fromConfig) return fromConfig;

		const noteProperties = this.allProperties.filter(
			(propertyId) => parsePropertyId(propertyId).type === 'note',
		);
		const candidates = [
			'start',
			'startDate',
			'date',
			'due',
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

	private resolveEndProperty(): BasesPropertyId | null {
		const fromConfig = this.config.getAsPropertyId('timeline.endDate');
		if (fromConfig) return fromConfig;

		const noteProperties = this.allProperties.filter(
			(propertyId) => parsePropertyId(propertyId).type === 'note',
		);
		const candidates = ['end', 'endDate', 'finish', 'completed'];
		for (const candidate of candidates) {
			const found = noteProperties.find(
				(propertyId) => parsePropertyId(propertyId).name === candidate,
			);
			if (found) return found;
		}
		return null;
	}

	private resolveGroupBy(): BasesPropertyId | null {
		const fromConfig = this.config.getAsPropertyId('timeline.groupBy');
		if (fromConfig) return fromConfig;

		const noteProperties = this.allProperties.filter(
			(propertyId) => parsePropertyId(propertyId).type === 'note',
		);
		return (
			noteProperties.find((propertyId) => parsePropertyId(propertyId).name === 'status') ??
			null
		);
	}

	private getPxPerDay(): number {
		const value = this.config.get('timeline.scale');
		return PX_PER_DAY[String(value)] ?? PX_PER_DAY.normal;
	}

	private createNote(
		frontmatterProcessor?: (frontmatter: Record<string, unknown>) => void,
	): void {
		if (!requireLicense()) return;
		void this.createFileForView(undefined, frontmatterProcessor);
	}
}
