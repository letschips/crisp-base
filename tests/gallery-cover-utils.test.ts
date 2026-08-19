import { describe, expect, it, vi } from 'vitest';
import {
	hideBrokenCover,
	parseCoverCandidate,
} from '../src/gallery-cover-utils';

describe('parseCoverCandidate', () => {
	it('extracts Obsidian image embeds instead of treating the markup as a path', () => {
		expect(parseCoverCandidate('![[assets/cover%20image.png|Cover]]')).toEqual({
			kind: 'path',
			value: 'assets/cover image.png',
		});
	});

	it('extracts local and remote Markdown image destinations', () => {
		expect(parseCoverCandidate('![Cover](assets/cover%20image.png)')).toEqual({
			kind: 'path',
			value: 'assets/cover image.png',
		});
		expect(parseCoverCandidate('![Cover](https://example.com/cover.png)')).toEqual({
			kind: 'url',
			value: 'https://example.com/cover.png',
		});
	});
});

describe('hideBrokenCover', () => {
	it('marks the card as text-only after removing a failed image cover', () => {
		const add = vi.fn();
		const card = { classList: { add } };
		const cover = {
			parentElement: card as typeof card | null,
			remove: vi.fn(() => {
				cover.parentElement = null;
			}),
		};

		hideBrokenCover(cover);

		expect(cover.remove).toHaveBeenCalledOnce();
		expect(add).toHaveBeenCalledWith('is-text-only');
	});
});
