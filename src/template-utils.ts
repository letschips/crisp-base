function isEmptyValue(value: unknown): boolean {
	return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

/**
 * Fills keys the new note has no value for yet (Bases pre-creates the view's properties as empty);
 * existing values (the column's group value) win.
 */
export function mergeTemplateFrontmatter(
	target: Record<string, unknown>,
	template: Record<string, unknown> | undefined,
): void {
	if (!template) return;
	for (const [key, value] of Object.entries(template)) {
		if (!isEmptyValue(target[key])) continue;
		target[key] = value !== null && typeof value === 'object' ? structuredClone(value) : value;
	}
}

export function stripFrontmatter(content: string): string {
	const match = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(content);
	return match ? content.slice(match[0].length) : content;
}

/** The `board.template` option may hold a vault path or a wikilink. */
export function parseTemplatePath(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	let text = raw.trim();
	const link = /^\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]$/.exec(text);
	if (link) text = link[1].trim();
	return text || null;
}
