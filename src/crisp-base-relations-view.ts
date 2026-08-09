import type {
	BasesEntry,
	BasesPropertyId,
	HoverParent,
	HoverPopover,
	QueryController,
	TFile} from 'obsidian';
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

export const CRISP_BASE_RELATIONS_VIEW_TYPE = 'crisp-base-relations';

interface RelationRow {
	entry: BasesEntry;
	out: BasesEntry[];
	inc: BasesEntry[];
}

export class CrispBaseRelationsView extends BasesView implements HoverParent {
	readonly type = CRISP_BASE_RELATIONS_VIEW_TYPE;
	hoverPopover: HoverPopover | null = null;

	private containerEl: HTMLElement;
	private selectedPath: string | null = null;

	constructor(controller: QueryController, parentEl: HTMLElement) {
		super(controller);
		this.containerEl = parentEl.createDiv({ cls: 'lb-view cc-relations' });
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

		const entries = this.data.data;
		const linkProperty = this.resolveLinkProperty();
		const showBacklinks = this.config.get('relations.showBacklinks') !== false;
		const onlyRelated = this.config.get('relations.onlyRelated') !== false;
		const groupBy = this.resolveGroupBy();
		const resolved = this.app.metadataCache.resolvedLinks;
		const byPath = new Map<string, BasesEntry>();
		for (const entry of entries) byPath.set(entry.file.path, entry);

		const outgoingMap = new Map<string, Set<string>>();
		for (const entry of entries) {
			const targets = this.outgoingTargets(entry, linkProperty, resolved, byPath);
			outgoingMap.set(entry.file.path, new Set(targets));
		}

		const incomingMap = new Map<string, BasesEntry[]>();
		if (showBacklinks) {
			for (const entry of entries) {
				const targets = outgoingMap.get(entry.file.path);
				if (!targets) continue;
				for (const targetPath of targets) {
					const targetEntry = byPath.get(targetPath);
					if (!targetEntry) continue;
					const list = incomingMap.get(targetEntry.file.path) ?? [];
					list.push(entry);
					incomingMap.set(targetEntry.file.path, list);
				}
			}
		}

		const rows: RelationRow[] = entries.map((entry) => {
			const out = [...outgoingMap.get(entry.file.path) ?? []]
				.map((path) => byPath.get(path))
				.filter((target): target is BasesEntry => !!target);
			const inc = incomingMap.get(entry.file.path) ?? [];
			return { entry, out, inc };
		});

		const visibleRows = onlyRelated
			? rows.filter((row) => row.out.length > 0 || row.inc.length > 0)
			: rows;

		let linkCount = 0;
		for (const row of visibleRows) linkCount += row.out.length + row.inc.length;
		this.renderToolbar(visibleRows.length, linkCount);

		if (visibleRows.length === 0) {
			const empty = this.containerEl.createDiv({ cls: 'lb-empty' });
			empty.createDiv({
				cls: 'lb-empty-hint',
				text: '没有找到关联。请在笔记间添加双链，或在视图设置中选择“链接属性”。',
			});
			return;
		}

		const content = this.containerEl.createDiv({ cls: 'lb-content' });
		const table = content.createDiv({ cls: 'cc-rel-table' });

		const header = table.createDiv({ cls: 'cc-rel-row cc-rel-header' });
		header.createDiv({ cls: 'cc-rel-note', text: '笔记' });
		header.createDiv({ cls: 'cc-rel-cell', text: '传出' });
		header.createDiv({ cls: 'cc-rel-cell', text: '传入' });

		for (const row of visibleRows) {
			const rowEl = table.createDiv({ cls: 'cc-rel-row' });
			const noteCell = rowEl.createDiv({ cls: 'cc-rel-note' });
			noteCell.setText(row.entry.file.basename);
			noteCell.addEventListener('click', () => {
				this.selectedPath =
					this.selectedPath === row.entry.file.path
						? null
						: row.entry.file.path;
				this.render();
			});

			const outCell = rowEl.createDiv({ cls: 'cc-rel-cell' });
			if (row.out.length === 0) {
				outCell.createDiv({ cls: 'cc-rel-empty', text: '—' });
			} else {
				for (const target of row.out) {
					this.renderChip(outCell, target, groupBy);
				}
			}

			const incCell = rowEl.createDiv({ cls: 'cc-rel-cell' });
			if (row.inc.length === 0) {
				incCell.createDiv({ cls: 'cc-rel-empty', text: '—' });
			} else {
				for (const target of row.inc) {
					this.renderChip(incCell, target, groupBy);
				}
			}
		}

		const selected = entries.find(
			(entry) => entry.file.path === this.selectedPath,
		);
		if (selected) {
			renderPropertyInspector(content, selected, {
				app: this.app,
				config: this.config,
				groupBy,
				knownLabels: this.distinctGroupLabels(entries, groupBy),
				onChanged: () => this.render(),
				onClose: () => {
					this.selectedPath = null;
					this.render();
				},
			});
		}
	}

	private renderToolbar(noteCount: number, linkCount: number): void {
		const toolbar = this.containerEl.createDiv({
			cls: 'lb-toolbar cc-rel-toolbar',
		});
		toolbar.createDiv({
			cls: 'cc-rel-title',
			text: `Relations · ${noteCount} notes · ${linkCount} links`,
		});
		const newNoteButton = toolbar.createEl('button', { cls: 'lb-button' });
		setIcon(newNoteButton, 'plus');
		newNoteButton.createSpan({ text: '新建笔记' });
		newNoteButton.addEventListener('click', () => {
			this.createNote();
		});
	}

	private renderChip(
		cell: HTMLElement,
		target: BasesEntry,
		groupBy: BasesPropertyId | null,
	): void {
		const chip = cell.createDiv({ cls: 'cc-rel-chip' });
		const value = groupBy ? target.getValue(groupBy) : null;
		const label = value && value.isTruthy() ? value.toString() : 'No value';
		chip.style.setProperty('--cc-rel-accent', accentFor(label));
		chip.createDiv({ cls: 'cc-rel-dot' });
		chip.createSpan({ text: target.file.basename });
		if (target.file.path === this.selectedPath) {
			chip.addClass('is-selected');
		}
		chip.addEventListener('click', () => {
			this.selectedPath =
				this.selectedPath === target.file.path ? null : target.file.path;
			this.render();
		});
		chip.addEventListener('mouseover', (event: MouseEvent) => {
			this.app.workspace.trigger('hover-link', {
				event,
				source: 'crisp-base-relations',
				hoverParent: this,
				targetEl: chip,
				linktext: target.file.path,
			});
		});
	}

	/* ------------------------------------------------------------------ */
	/* Data helpers                                                        */
	/* ------------------------------------------------------------------ */

	private outgoingTargets(
		entry: BasesEntry,
		linkProperty: BasesPropertyId | null,
		resolved: Record<string, Record<string, number>>,
		byPath: Map<string, BasesEntry>,
	): string[] {
		const targets: string[] = [];
		if (linkProperty) {
			const { name } = parsePropertyId(linkProperty);
			const frontmatter =
				this.app.metadataCache.getFileCache(entry.file)?.frontmatter;
			for (const path of this.linkTargetsFromFrontmatter(
				frontmatter?.[name],
				entry.file,
			)) {
				if (path !== entry.file.path && byPath.has(path)) targets.push(path);
			}
		} else {
			for (const path of Object.keys(resolved[entry.file.path] ?? {})) {
				if (path !== entry.file.path && byPath.has(path)) targets.push(path);
			}
		}
		return [...new Set(targets)];
	}

	private linkTargetsFromFrontmatter(
		raw: unknown,
		source: TFile,
	): string[] {
		const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
		const paths: string[] = [];
		for (const value of values) {
			const text = String(value);
			const matches = [
				...text.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g),
			];
			if (matches.length === 0) {
				const dest = this.app.metadataCache.getFirstLinkpathDest(
					text.trim(),
					source.path,
				);
				if (dest) paths.push(dest.path);
				continue;
			}
			for (const match of matches) {
				const dest = this.app.metadataCache.getFirstLinkpathDest(
					match[1].trim(),
					source.path,
				);
				if (dest) paths.push(dest.path);
			}
		}
		return paths;
	}

	private resolveLinkProperty(): BasesPropertyId | null {
		return this.config.getAsPropertyId('relations.linkProperty');
	}

	private resolveGroupBy(): BasesPropertyId | null {
		const fromConfig = this.config.getAsPropertyId('relations.groupBy');
		if (fromConfig) return fromConfig;

		const noteProperties = this.allProperties.filter(
			(propertyId) => parsePropertyId(propertyId).type === 'note',
		);
		return (
			noteProperties.find((propertyId) => parsePropertyId(propertyId).name === 'status') ??
			null
		);
	}

	private distinctGroupLabels(
		entries: BasesEntry[],
		groupBy: BasesPropertyId | null,
	): string[] {
		if (!groupBy) return [];
		const labels = new Set<string>();
		for (const entry of entries) {
			const value = entry.getValue(groupBy);
			labels.add(value && value.isTruthy() ? value.toString() : 'No value');
		}
		return [...labels];
	}

	private createNote(
		frontmatterProcessor?: (frontmatter: Record<string, unknown>) => void,
	): void {
		if (!requireLicense()) return;
		void this.createFileForView(undefined, frontmatterProcessor);
	}
}
