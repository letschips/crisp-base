import type {
	BasesEntry,
	BasesPropertyId,
	HoverParent,
	HoverPopover,
	QueryController} from 'obsidian';
import {
	BasesView,
	parsePropertyId,
	TFile,
} from 'obsidian';
import { setIcon } from 'obsidian';
import {
	hideBrokenCover,
	parseCoverCandidate,
} from './gallery-cover-utils';
import { renderPropertyInspector } from './inspector';
import {
	isLicensed,
	onLicenseChanged,
	renderLicenseBanner,
	requireLicense,
} from './license-state';

export const CRISP_BASE_GALLERY_VIEW_TYPE = 'crisp-base-gallery';

const IMAGE_EXTENSIONS = new Set([
	'png',
	'jpg',
	'jpeg',
	'gif',
	'svg',
	'webp',
	'avif',
	'bmp',
]);

function isImageExtension(ext: string): boolean {
	return IMAGE_EXTENSIONS.has(ext.toLowerCase().replace(/^\./, ''));
}

type CoverSource =
	| { kind: 'file'; file: TFile }
	| { kind: 'url'; url: string };

interface CardProperty {
	id: BasesPropertyId;
	displayName: string;
}

export class CrispBaseGalleryView extends BasesView implements HoverParent {
	readonly type = CRISP_BASE_GALLERY_VIEW_TYPE;
	hoverPopover: HoverPopover | null = null;

	private containerEl: HTMLElement;
	private selectedPath: string | null = null;

	constructor(controller: QueryController, parentEl: HTMLElement) {
		super(controller);
		this.containerEl = parentEl.createDiv({ cls: 'lb-view cc-gallery' });
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
		this.renderToolbar(entries.length);

		if (entries.length === 0) {
			const empty = this.containerEl.createDiv({ cls: 'lb-empty' });
			empty.createDiv({
				cls: 'lb-empty-hint',
				text: '当前 Base 还没有匹配的笔记。',
			});
			return;
		}

		const content = this.containerEl.createDiv({ cls: 'lb-content' });
		const grid = content.createDiv({ cls: 'cc-gallery-grid' });
		for (const entry of entries) {
			this.renderCard(grid, entry);
		}

		const selected = entries.find(
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

	private renderToolbar(count: number): void {
		const toolbar = this.containerEl.createDiv({ cls: 'lb-toolbar' });
		toolbar.createDiv({
			cls: 'cc-gallery-title',
			text: `Gallery · ${count} notes`,
		});
		const newNoteButton = toolbar.createEl('button', { cls: 'lb-button' });
		setIcon(newNoteButton, 'plus');
		newNoteButton.createSpan({ text: '新建笔记' });
		newNoteButton.addEventListener('click', () => {
			this.createNote();
		});
	}

	private shouldHideEmptyCover(): boolean {
		return this.config.get('gallery.hideEmptyCover') !== false;
	}

	private renderCard(grid: HTMLElement, entry: BasesEntry): void {
		const card = grid.createDiv({ cls: 'cc-gallery-card' });
		if (entry.file.path === this.selectedPath) {
			card.addClass('is-selected');
		}
		card.addEventListener('click', () => {
			this.selectedPath =
				this.selectedPath === entry.file.path ? null : entry.file.path;
			this.render();
		});
		card.addEventListener('mouseover', (event: MouseEvent) => {
			this.app.workspace.trigger('hover-link', {
				event,
				source: 'crisp-base-gallery',
				hoverParent: this,
				targetEl: card,
				linktext: entry.file.path,
			});
		});

		const coverSource = this.resolveCoverSource(entry);
		const cover = card.createDiv({ cls: 'cc-gallery-cover' });
		const rendered = this.renderCover(cover, entry, coverSource);
		if (!rendered) {
			cover.remove();
			card.addClass('is-text-only');
		}

		const body = card.createDiv({ cls: 'cc-gallery-body' });
		body.createDiv({
			cls: 'cc-gallery-card-title',
			text: entry.file.basename,
		});

		const chips = this.cardProperties();
		if (chips.length > 0) {
			const chipRow = body.createDiv({ cls: 'lb-card-chips' });
			for (const chip of chips) {
				const value = entry.getValue(chip.id);
				if (!value || !value.isTruthy()) continue;
				const chipEl = chipRow.createDiv({
					cls: 'lb-chip',
					attr: { title: chip.displayName },
				});
				chipEl.setText(value.toString());
			}
		}
	}

	private renderCover(
		cover: HTMLElement,
		entry: BasesEntry,
		source: CoverSource | null,
	): boolean {
		if (!source) {
			if (this.shouldHideEmptyCover()) {
				return false;
			}
			cover.addClass('is-placeholder');
			const icon = cover.createDiv({ cls: 'cc-gallery-cover-icon' });
			setIcon(icon, 'image-off');
			return true;
		}

		const img = cover.createEl('img');
		img.src =
			source.kind === 'file'
				? this.app.vault.getResourcePath(source.file)
				: source.url;
		img.alt = entry.file.basename;
		img.loading = 'lazy';

		img.addEventListener('error', () => {
			img.remove();
			if (this.shouldHideEmptyCover()) {
				hideBrokenCover(cover);
			} else {
				cover.addClass('is-placeholder');
				const icon = cover.createDiv({ cls: 'cc-gallery-cover-icon' });
				setIcon(icon, 'image-off');
			}
		});

		return true;
	}

	private resolveCoverSource(entry: BasesEntry): CoverSource | null {
		// 1. If entry itself is an image file (e.g. svg, png in folder queries)
		if (entry.file instanceof TFile && isImageExtension(entry.file.extension)) {
			return { kind: 'file', file: entry.file };
		}

		// 2. Explicit or fallback Frontmatter cover property
		const coverProperty = this.resolveCoverProperty();
		if (coverProperty) {
			const { name } = parsePropertyId(coverProperty);
			const frontmatter =
				this.app.metadataCache.getFileCache(entry.file)?.frontmatter;
			const raw = frontmatter?.[name];
			for (const value of Array.isArray(raw) ? raw : raw != null ? [raw] : []) {
				const candidate = parseCoverCandidate(value);
				if (!candidate) continue;
				if (candidate.kind === 'url') {
					return { kind: 'url', url: candidate.value };
				}
				const file = this.resolvePathToImageFile(candidate.value, entry.file.path);
				if (file) {
					return { kind: 'file', file };
				}
			}
		}

		// 3. First embedded image in note body
		const embeds = this.app.metadataCache.getFileCache(entry.file)?.embeds ?? [];
		for (const embed of embeds) {
			const candidate = parseCoverCandidate(embed.link);
			if (!candidate) continue;
			if (candidate.kind === 'url') {
				return { kind: 'url', url: candidate.value };
			}
			const file = this.resolvePathToImageFile(candidate.value, entry.file.path);
			if (file) {
				return { kind: 'file', file };
			}
		}

		return null;
	}

	private resolvePathToImageFile(linktext: string, sourcePath: string): TFile | null {
		const dest =
			this.app.metadataCache.getFirstLinkpathDest(linktext, sourcePath) ??
			this.app.vault.getFileByPath(linktext);
		if (dest instanceof TFile && isImageExtension(dest.extension)) {
			return dest;
		}
		return null;
	}

	private resolveCoverProperty(): BasesPropertyId | null {
		const fromConfig = this.config.getAsPropertyId('gallery.coverProperty');
		if (fromConfig) return fromConfig;

		const noteProperties = this.allProperties.filter(
			(propertyId) => parsePropertyId(propertyId).type === 'note',
		);
		for (const candidate of ['cover', 'image', 'banner']) {
			const found = noteProperties.find(
				(propertyId) => parsePropertyId(propertyId).name === candidate,
			);
			if (found) return found;
		}
		return null;
	}

	private cardProperties(): CardProperty[] {
		return this.config
			.getOrder()
			.filter((propertyId) => {
				const { type, name } = parsePropertyId(propertyId);
				return !(type === 'file' && name === 'name');
			})
			.slice(0, 4)
			.map((propertyId) => ({
				id: propertyId,
				displayName: this.config.getDisplayName(propertyId),
			}));
	}

	private createNote(
		frontmatterProcessor?: (frontmatter: Record<string, unknown>) => void,
	): void {
		if (!requireLicense()) return;
		void this.createFileForView(undefined, frontmatterProcessor);
	}
}
