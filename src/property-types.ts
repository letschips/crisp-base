// Property kinds drive which editor the inspector shows. The vault's assigned type comes from
// Obsidian's private metadataTypeManager; when that API is missing or changes, fall back to
// the value's shape so the inspector keeps working.

export type PropertyKind = 'text' | 'number' | 'checkbox' | 'date' | 'datetime' | 'list' | 'tags';

interface TypeInfoSource {
	metadataTypeManager?: {
		getTypeInfo?: (name: string) => { expected?: { type?: string } | null } | null | undefined;
	};
}

const WIDGET_KINDS: Record<string, PropertyKind> = {
	text: 'text',
	file: 'text',
	folder: 'text',
	number: 'number',
	checkbox: 'checkbox',
	date: 'date',
	datetime: 'datetime',
	multitext: 'list',
	aliases: 'list',
	tags: 'tags',
};

export function kindFromWidget(widget: string | undefined): PropertyKind | null {
	return (widget && WIDGET_KINDS[widget]) || null;
}

export function inferKind(value: unknown): PropertyKind {
	if (typeof value === 'boolean') return 'checkbox';
	if (typeof value === 'number') return 'number';
	if (Array.isArray(value)) return 'list';
	return 'text';
}

export function resolvePropertyKind(app: unknown, name: string, value: unknown): PropertyKind {
	try {
		const info = (app as TypeInfoSource).metadataTypeManager?.getTypeInfo?.(name);
		const kind = kindFromWidget(info?.expected?.type);
		if (kind) return kind;
	} catch {
		// Private API changed; the value's shape is still a safe guide.
	}
	return inferKind(value);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/** False when an editor for `kind` would have to reinterpret the stored value. */
export function isValueCompatible(kind: PropertyKind, value: unknown): boolean {
	if (value === null || value === undefined) return true;
	switch (kind) {
		case 'text':
			return typeof value === 'string' || typeof value === 'number';
		case 'number':
			return typeof value === 'number';
		case 'checkbox':
			return typeof value === 'boolean';
		case 'date':
			return typeof value === 'string' && DATE_RE.test(value);
		case 'datetime':
			return typeof value === 'string' && DATETIME_RE.test(value);
		case 'list':
		case 'tags':
			if (typeof value === 'string') return true;
			return Array.isArray(value) && value.every((item) => typeof item === 'string' || typeof item === 'number');
	}
}

export function toDateInput(kind: 'date' | 'datetime', value: unknown): string {
	if (typeof value !== 'string') return '';
	return kind === 'datetime' ? value.slice(0, 16) : value;
}

export function fromDateInput(kind: 'date' | 'datetime', raw: string): string | null {
	const trimmed = raw.trim();
	if (trimmed === '') return null;
	return kind === 'datetime' ? trimmed.slice(0, 16) : trimmed;
}

export function listItems(value: unknown): string[] {
	if (Array.isArray(value)) return value.map(String);
	if (typeof value === 'string' && value !== '') return [value];
	return [];
}

export function normalizeListItems(kind: 'list' | 'tags', items: string[]): string[] | null {
	const result: string[] = [];
	for (const item of items) {
		let text = item.trim();
		if (kind === 'tags') text = text.replace(/^#+/, '').trim();
		if (text && !result.includes(text)) result.push(text);
	}
	return result.length > 0 ? result : null;
}

/** Number for valid input, null to clear, undefined when the input must not be written. */
export function parseNumberInput(raw: string): number | null | undefined {
	const trimmed = raw.trim();
	if (trimmed === '') return null;
	const numeric = Number(trimmed);
	return Number.isFinite(numeric) ? numeric : undefined;
}
