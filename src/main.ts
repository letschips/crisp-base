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
			name: 'Crisp Base Board',
			icon: 'kanban',
			factory: (controller, containerEl) =>
				new CrispBaseBoardView(controller, containerEl),
			options: () => [
				{
					type: 'group',
					displayName: 'Board',
					items: [
						{
							type: 'property',
							key: 'board.groupBy',
							displayName: 'Group by',
							placeholder: 'status',
							filter: (propertyId) => {
								return parsePropertyId(propertyId).type === 'note';
							},
						},
						{
							type: 'multitext',
							key: 'board.extraColumns',
							displayName: 'Always show columns',
							default: [],
						},
						{
							type: 'slider',
							key: 'board.cardLimit',
							displayName: 'Max cards per column',
							default: 200,
							min: 20,
							max: 2000,
							step: 10,
						},
						{
							type: 'multitext',
							key: 'board.columnOrder',
							displayName: 'Column order',
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
			name: 'Crisp Base Calendar',
			icon: 'calendar',
			factory: (controller, containerEl) =>
				new CrispBaseCalendarView(controller, containerEl),
			options: () => [
				{
					type: 'group',
					displayName: 'Calendar',
					items: [
						{
							type: 'property',
							key: 'calendar.dateProperty',
							displayName: 'Date property',
							placeholder: 'due',
							filter: (propertyId) =>
								parsePropertyId(propertyId).type === 'note',
						},
						{
							type: 'dropdown',
							key: 'calendar.weekStart',
							displayName: 'Week starts on',
							default: 'monday',
							options: {
								monday: 'Monday',
								sunday: 'Sunday',
							},
						},
					],
				},
			],
		});

		this.registerBasesView(CRISP_BASE_TIMELINE_VIEW_TYPE, {
			name: 'Crisp Base Timeline',
			icon: 'calendar-range',
			factory: (controller, containerEl) =>
				new CrispBaseTimelineView(controller, containerEl),
			options: () => [
				{
					type: 'group',
					displayName: 'Timeline',
					items: [
						{
							type: 'property',
							key: 'timeline.startDate',
							displayName: 'Start date property',
							placeholder: 'start',
							filter: (propertyId) =>
								parsePropertyId(propertyId).type === 'note',
						},
						{
							type: 'property',
							key: 'timeline.endDate',
							displayName: 'End date property (optional)',
							placeholder: 'end',
							filter: (propertyId) =>
								parsePropertyId(propertyId).type === 'note',
						},
						{
							type: 'property',
							key: 'timeline.groupBy',
							displayName: 'Group rows by',
							placeholder: 'status',
							filter: (propertyId) =>
								parsePropertyId(propertyId).type === 'note',
						},
						{
							type: 'dropdown',
							key: 'timeline.scale',
							displayName: 'Scale',
							default: 'normal',
							options: {
								compact: 'Compact',
								normal: 'Normal',
								wide: 'Wide',
							},
						},
					],
				},
			],
		});

		this.registerBasesView(CRISP_BASE_RELATIONS_VIEW_TYPE, {
			name: 'Crisp Base Relations',
			icon: 'share-2',
			factory: (controller, containerEl) =>
				new CrispBaseRelationsView(controller, containerEl),
			options: () => [
				{
					type: 'group',
					displayName: 'Relations',
					items: [
						{
							type: 'property',
							key: 'relations.linkProperty',
							displayName: 'Link property (optional)',
							placeholder: 'related',
							filter: (propertyId) =>
								parsePropertyId(propertyId).type === 'note',
						},
						{
							type: 'property',
							key: 'relations.groupBy',
							displayName: 'Chip color by',
							placeholder: 'status',
							filter: (propertyId) =>
								parsePropertyId(propertyId).type === 'note',
						},
						{
							type: 'toggle',
							key: 'relations.showBacklinks',
							displayName: 'Show incoming links',
							default: true,
						},
						{
							type: 'toggle',
							key: 'relations.onlyRelated',
							displayName: 'Only show notes with relations',
							default: true,
						},
					],
				},
			],
		});

		this.registerBasesView(CRISP_BASE_GALLERY_VIEW_TYPE, {
			name: 'Crisp Base Gallery',
			icon: 'layout-grid',
			factory: (controller, containerEl) =>
				new CrispBaseGalleryView(controller, containerEl),
			options: () => [
				{
					type: 'group',
					displayName: 'Gallery',
					items: [
						{
							type: 'property',
							key: 'gallery.coverProperty',
							displayName: 'Cover property',
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
