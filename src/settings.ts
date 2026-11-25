import type { App } from 'obsidian';
import { Notice, PluginSettingTab, Setting } from 'obsidian';
import { PLUGIN_FEATURE, normalizeLicenseCode, verifyLicense } from './license';
import {
	clearLicense,
	isLicensed,
	licensePayload,
	notifyLicenseChanged,
	setLicense,
} from './license-state';
import type CrispBasePlugin from './main';
import { withLicense, withoutLicense } from './plugin-data';

export class CrispBaseSettingTab extends PluginSettingTab {
	private code = '';
	private busy = false;

	constructor(app: App, private readonly plugin: CrispBasePlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl
			.createDiv({ cls: 'crisp-brand-header' })
			.createEl('h2', { text: 'Crisp Base' });
		containerEl.createEl('p', { text: '换个视图，管好笔记', cls: 'crisp-brand-slogan' });
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
						void this.plugin.updatePluginData(withoutLicense);
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
					const code = normalizeLicenseCode(this.code);
					const result = await verifyLicense(code, PLUGIN_FEATURE);
					if (result.valid && result.payload) {
						setLicense(true, code, result.payload);
						await this.plugin.updatePluginData((data) =>
							withLicense(data, code, Date.now()),
						);
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
			text: '关于 Crisp Base',
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
