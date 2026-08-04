export const ACCENTS = [
	'#5e6ad2', // Indigo
	'#f2994a', // Orange
	'#22c55e', // Green
	'#eb5757', // Red
	'#26b5ce', // Cyan
	'#facc15', // Yellow
	'#4cb782', // Mint
	'#f2790f', // Amber
	'#95a2b3', // Slate
];

export function hashString(input: string): number {
	let hash = 0;
	for (let i = 0; i < input.length; i++) {
		hash = (hash << 5) - hash + input.charCodeAt(i);
		hash |= 0;
	}
	return Math.abs(hash);
}

export function accentFor(label: string): string {
	return ACCENTS[hashString(label) % ACCENTS.length];
}
