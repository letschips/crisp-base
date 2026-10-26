import { Notice, Plugin, parsePropertyId } from 'obsidian';
import { preserveUnreadableData, verifyDataWrite } from './data-safety';
import { PLUGIN_FEATURE, verifyLicense } from './license';
import {
	clearLicense,
	notifyLicenseChanged,
	setLicense,
} from './license-state';
import { initOptionColors } from './option-colors';
import type { CrispBaseData } from './plugin-data';
import { normalizePluginData, withOptionColors } from './plugin-data';
import { CrispBaseSettingTab } from './settings';
import { CRISP_BASE_BOARD_VIEW_TYPE, CrispBaseBoardView } from './crisp-base-board-view';
import {
	CRISP_BASE_CALENDAR_VIEW_TYPE,
	CrispBaseCalendarView,
} from './crisp-base-calendar-view';
import {
	CRISP_BASE_TIMELINE_VIEW_TYPE,
	CrispBaseTimelineView,
} from './crisp-base-timeline-view';
import {
	CRISP_BASE_RELATIONS_VIEW_TYPE,
	CrispBaseRelationsView,
} from './crisp-base-relations-view';
import {
	CRISP_BASE_GALLERY_VIEW_TYPE,
	CrispBaseGalleryView,
} from './crisp-base-gallery-view';

export default class CrispBasePlugin extends Plugin {

	private dataWriteBlocked = false;
	private pluginData: CrispBaseData = {};
	private saveQueue: Promise<void> = Promise.resolve();

	/** Applies `update` to the latest data and saves; saves run one at a time so none is lost. */
	updatePluginData(update: (data: CrispBaseData) => CrispBaseData): Promise<void> {
		const run = this.saveQueue.then(async () => {
			const next = update(this.pluginData);
			this.pluginData = next;
			if (this.dataWriteBlocked) return;
			await this.saveData(next);
			await verifyDataWrite(this.app.vault.adapter, `${this.manifest.dir}/data.json`, next);
		});
		this.saveQueue = run.catch((error: unknown) => {
			console.error('Crisp Base could not save data.json', error);
			new Notice('Crisp Base 设置保存失败，请检查库文件夹是否可写。');
		});
		return this.saveQueue;
	}

	// Never overwrite a data.json that could not be read and could not be backed up either.
	async saveData(data: unknown): Promise<void> {
		if (this.dataWriteBlocked) return;
		await super.saveData(data);
	}

	// data.json changed on disk (iCloud / Obsidian Sync from another device): adopt it, so the next save
	// does not overwrite that device's option colors. The license state is left as verified at load.
	async onExternalSettingsChange(): Promise<void> {
		await this.saveQueue;
		const raw: unknown = await this.loadData();
		if (raw === undefined || raw === null) return;
		const data = normalizePluginData(raw);
		this.pluginData = data;
		initOptionColors(data.optionColors ?? {}, (map) =>
			this.updatePluginData((current) => withOptionColors(current, map)),
		);
	}

	// loadData() yields undefined when data.json exists but cannot be read; keep a copy before defaults take over.
	private async protectUnreadableData(raw: unknown): Promise<void> {
		if (raw !== undefined) return;
		const result = await preserveUnreadableData(this.app.vault.adapter, `${this.manifest.dir}/data.json`);
		if (result.state === 'preserved') {
			new Notice(`Crisp Base 的设置文件无法读取，已备份为 ${result.backupPath.split('/').pop()} 并恢复默认设置。`, 12000);
		} else if (result.state === 'failed') {
			this.dataWriteBlocked = true;
			console.error('Crisp Base could not back up unreadable data.json', result.error);
			new Notice('Crisp Base 的设置文件无法读取，也无法备份。为保护原文件，本次运行不会保存设置。', 0);
		}
	}
	async onload() {
		this.addSettingTab(new CrispBaseSettingTab(this.app, this));

		const registered = this.registerBasesView(CRISP_BASE_BOARD_VIEW_TYPE, {
			name: 'Crisp Base 看板',
			icon: 'kanban',
			factory: (controller, containerEl) =>
				new CrispBaseBoardView(controller, containerEl),
			options: () => [
				{
					type: 'group',
					displayName: '看板',
					items: [
						{
							type: 'property',
							key: 'board.groupBy',
							displayName: '分组属性',
							placeholder: 'status',
							filter: (propertyId) => {
								return parsePropertyId(propertyId).type === 'note';
							},
						},
						{
							type: 'multitext',
							key: 'board.extraColumns',
							displayName: '始终显示的分组',
							default: [],
						},
						{
							type: 'slider',
							key: 'board.cardLimit',
							displayName: '每列最多卡片数',
							default: 200,
							min: 20,
							max: 2000,
							step: 10,
						},
						{
							type: 'multitext',
							key: 'board.columnOrder',
							displayName: '分组顺序',
							default: [],
						},
						{
							type: 'file',
							key: 'board.template',
							displayName: '新建模板（可选）',
							placeholder: 'Templates/任务.md',
							filter: (file) => file.extension === 'md',
						},
					],
				},
			],
		});

		if (!registered) {
			console.warn('[crisp-base] Bases is not enabled; Crisp Base Board view was not registered.');
			return;
		}

		this.registerBasesView(CRISP_BASE_CALENDAR_VIEW_TYPE, {
			name: 'Crisp Base 日历',
			icon: 'calendar',
			factory: (controller, containerEl) =>
				new CrispBaseCalendarView(controller, containerEl),
			options: () => [
				{
					type: 'group',
					displayName: '日历',
					items: [
						{
							type: 'property',
							key: 'calendar.dateProperty',
							displayName: '日期属性',
							placeholder: 'due',
							filter: (propertyId) =>
								parsePropertyId(propertyId).type === 'note',
						},
						{
							type: 'dropdown',
							key: 'calendar.weekStart',
							displayName: '每周起始日',
							default: 'monday',
							options: {
								monday: '星期一',
								sunday: '星期日',
							},
						},
					],
				},
			],
		});

		this.registerBasesView(CRISP_BASE_TIMELINE_VIEW_TYPE, {
			name: 'Crisp Base 时间线',
			icon: 'calendar-range',
			factory: (controller, containerEl) =>
				new CrispBaseTimelineView(controller, containerEl),
			options: () => [
				{
					type: 'group',
					displayName: '时间线',
					items: [
						{
							type: 'property',
							key: 'timeline.startDate',
							displayName: '开始日期属性',
							placeholder: 'start',
							filter: (propertyId) =>
								parsePropertyId(propertyId).type === 'note',
						},
						{
							type: 'property',
							key: 'timeline.endDate',
							displayName: '结束日期属性（可选）',
							placeholder: 'end',
							filter: (propertyId) =>
								parsePropertyId(propertyId).type === 'note',
						},
						{
							type: 'property',
							key: 'timeline.groupBy',
							displayName: '行分组属性',
							placeholder: 'status',
							filter: (propertyId) =>
								parsePropertyId(propertyId).type === 'note',
						},
						{
							type: 'dropdown',
							key: 'timeline.scale',
							displayName: '缩放密度',
							default: 'normal',
							options: {
								compact: '紧凑',
								normal: '标准',
								wide: '宽松',
							},
						},
					],
				},
			],
		});

		this.registerBasesView(CRISP_BASE_RELATIONS_VIEW_TYPE, {
			name: 'Crisp Base 关联',
			icon: 'share-2',
			factory: (controller, containerEl) =>
				new CrispBaseRelationsView(controller, containerEl),
			options: () => [
				{
					type: 'group',
					displayName: '关联',
					items: [
						{
							type: 'property',
							key: 'relations.linkProperty',
							displayName: '链接属性（可选）',
							placeholder: 'related',
							filter: (propertyId) =>
								parsePropertyId(propertyId).type === 'note',
						},
						{
							type: 'property',
							key: 'relations.groupBy',
							displayName: '标签颜色属性',
							placeholder: 'status',
							filter: (propertyId) =>
								parsePropertyId(propertyId).type === 'note',
						},
						{
							type: 'toggle',
							key: 'relations.showBacklinks',
							displayName: '显示传入链接',
							default: true,
						},
						{
							type: 'toggle',
							key: 'relations.onlyRelated',
							displayName: '仅显示有关联的笔记',
							default: true,
						},
					],
				},
			],
		});

		this.registerBasesView(CRISP_BASE_GALLERY_VIEW_TYPE, {
			name: 'Crisp Base 画廊',
			icon: 'layout-grid',
			factory: (controller, containerEl) =>
				new CrispBaseGalleryView(controller, containerEl),
			options: () => [
				{
					type: 'group',
					displayName: '画廊',
					items: [
						{
							type: 'property',
							key: 'gallery.coverProperty',
							displayName: '封面属性',
							placeholder: 'cover',
							filter: (propertyId) =>
								parsePropertyId(propertyId).type === 'note',
						},
						{
							type: 'toggle',
							key: 'gallery.hideEmptyCover',
							displayName: '隐藏无封面占位框',
							default: true,
						},
					],
				},
			],
		});

		const raw: unknown = await this.loadData();
		await this.protectUnreadableData(raw);
		const data = normalizePluginData(raw);
		this.pluginData = data;
		initOptionColors(data.optionColors ?? {}, (map) =>
			this.updatePluginData((current) => withOptionColors(current, map)),
		);
		if (data.licenseCode) {
			// Local Ed25519 + expiry verification only — fast, no network.
			const local = await verifyLicense(data.licenseCode, PLUGIN_FEATURE, {
				skipOnlineCheck: true,
			});
			if (local.valid && local.payload) {
				setLicense(true, data.licenseCode, local.payload);
				notifyLicenseChanged();
				// Online device/revocation check runs in the background and
				// downgrades the license if the server rejects it.
				void verifyLicense(data.licenseCode, PLUGIN_FEATURE).then((result) => {
					if (!result.valid) {
						clearLicense();
						notifyLicenseChanged();
					}
				});
			}
		}
	}
}
