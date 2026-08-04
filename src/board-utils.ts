/**
 * Order board columns by an explicit list, then by first occurrence,
 * then append any remaining "always show" empty columns.
 */
export function orderColumns<T>(
	columns: Map<string, T>,
	extraColumns: string[],
	order: string[],
): Array<[string, T | null]> {
	const result: Array<[string, T | null]> = [];
	const used = new Set<string>();
	for (const label of order) {
		if (used.has(label) || !label) continue;
		used.add(label);
		result.push([label, columns.get(label) ?? null]);
	}
	for (const [label, value] of columns) {
		if (used.has(label)) continue;
		used.add(label);
		result.push([label, value]);
	}
	for (const label of extraColumns) {
		if (used.has(label) || !label) continue;
		used.add(label);
		result.push([label, null]);
	}
	return result;
}

export function clampCardLimit(value: unknown, fallback = 200): number {
	const limit = typeof value === 'number' ? value : fallback;
	return Math.max(20, Math.min(limit, 2000));
}
