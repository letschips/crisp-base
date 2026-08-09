import { Plugin, parsePropertyId } from 'obsidian';
import { PLUGIN_FEATURE, verifyLicense } from './license';
import {
	clearLicense,
	notifyLicenseChanged,
	setLicense,
} from './license-state';
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
					],
				},
			],
		});

		const data = (await this.loadData()) as { licenseCode?: string } | undefined;
		if (data?.licenseCode) {
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
