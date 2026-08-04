import type { App, Plugin} from 'obsidian';
import { Notice, PluginSettingTab, Setting } from 'obsidian';
import { PLUGIN_FEATURE, verifyLicense } from './license';
import {
	clearLicense,
	isLicensed,
	licensePayload,
	notifyLicenseChanged,
	setLicense,
} from './license-state';

interface CrispBaseData {
	licenseCode?: string;
	activatedAt?: number;
}

export class CrispBaseSettingTab extends PluginSettingTab {
	private code = '';
	private busy = false;

	constructor(app: App, private readonly plugin: Plugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: 'Crisp Base' });
		containerEl.createEl('p', {
			text: 'Notion-like 数据库视图套件（看板 / 日历 / 时间线 / 关联 / 画廊）。输入 Crisp 系列激活码后解锁写入与新建。',
		});
		this.renderAbout();

		if (isLicensed()) {
			const payload = licensePayload();
			new Setting(containerEl)
				.setName('状态')
				.setDesc(
					`已激活 · ${payload?.product ?? ''}${
						payload?.expiresAt
							? ` · 到期 ${String(payload.expiresAt).split('T')[0]}`
							: ''
					}`,
				)
				.addButton((button) =>
					button.setButtonText('清除激活').onClick(() => {
						clearLicense();
						void this.plugin.saveData({});
						notifyLicenseChanged();
						this.display();
					}),
				);
			return;
		}

		new Setting(containerEl)
			.setName('激活码')
			.setDesc('格式为 payload.signature；支持 Crisp Suite / Crisp Base 授权')
			.addText((text) =>
				text
					.setPlaceholder('xxxx.xxxx')
					.setValue(this.code)
					.onChange((value) => {
						this.code = value;
					}),
			)
			.addButton((button) => {
				button
					.setButtonText(this.busy ? '验证中…' : '激活')
					.setDisabled(this.busy);
				button.onClick(async () => {
					this.busy = true;
					this.display();
					const result = await verifyLicense(this.code, PLUGIN_FEATURE);
					if (result.valid && result.payload) {
						setLicense(true, this.code.trim(), result.payload);
						const data: CrispBaseData = {
							licenseCode: this.code.trim(),
							activatedAt: Date.now(),
						};
						await this.plugin.saveData(data);
						new Notice('Crisp Base 已激活');
						notifyLicenseChanged();
					} else {
						new Notice(`激活失败：${result.reason ?? '未知错误'}`);
					}
					this.busy = false;
					this.display();
				});
			});
	}

	private renderAbout(): void {
		const { containerEl } = this;
		const about = containerEl.createDiv({ cls: 'cb-about' });
		about.createEl('h3', {
			cls: 'cb-about-title',
			text: 'About Crisp Base',
		});
		about.createEl('p', {
			cls: 'cb-about-description',
			text: 'Notion-like 数据库视图套件（看板 / 日历 / 时间线 / 关联 / 画廊）。',
		});
		const author = about.createEl('p', { cls: 'cb-about-author' });
		author.createSpan({ text: '作者：' });
		author.createEl('a', {
			cls: 'cb-about-author-link',
			text: '小红书 letschips',
			attr: {
				href: 'https://xhslink.cn/m/3MwtKu4822b',
				target: '_blank',
				rel: 'noopener noreferrer',
			},
		});
	}
}
