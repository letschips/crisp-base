export function pad2(value: number): string {
	return String(value).padStart(2, '0');
}

export function toISODate(year: number, month: number, day: number): string {
	return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

export function dateToISO(date: Date): string {
	return toISODate(date.getFullYear(), date.getMonth(), date.getDate());
}

export function isoToDate(iso: string): Date {
	const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (!match) return new Date(iso);
	return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function extractISODate(value: string): string | null {
	const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (match) return `${match[1]}-${match[2]}-${match[3]}`;
	const parsed = new Date(value);
	if (!isNaN(parsed.getTime())) {
		return dateToISO(parsed);
	}
	return null;
}

export function daysBetween(fromISO: string, toISO: string): number {
	const from = isoToDate(fromISO).getTime();
	const to = isoToDate(toISO).getTime();
	return Math.round((to - from) / 86400000);
}

export function addDays(iso: string, days: number): string {
	const date = isoToDate(iso);
	date.setDate(date.getDate() + days);
	return dateToISO(date);
}
