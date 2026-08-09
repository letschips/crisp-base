import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('calendar empty state', () => {
	it('keeps the interactive month grid available before the first dated note exists', () => {
		const source = readFileSync(
			fileURLToPath(new URL('../src/crisp-base-calendar-view.ts', import.meta.url)),
			'utf8',
		);

		expect(source).not.toContain('if (!parsedAny)');
		expect(source).toContain("const grid = content.createDiv({ cls: 'cc-grid' });");
	});
});
