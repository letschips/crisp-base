import { describe, expect, it } from 'vitest';
import {
	addDays,
	dateToISO,
	daysBetween,
	extractISODate,
	toISODate,
} from '../src/dates';

describe('extractISODate', () => {
	it('extracts ISO dates from plain and datetime strings', () => {
		expect(extractISODate('2026-08-15')).toBe('2026-08-15');
		expect(extractISODate('2026-08-15T00:00:00+08:00')).toBe('2026-08-15');
		expect(extractISODate('2026-08-15 10:00')).toBe('2026-08-15');
	});

	it('returns null for unparseable values', () => {
		expect(extractISODate('not a date')).toBeNull();
		expect(extractISODate('')).toBeNull();
	});
});

describe('day math', () => {
	it('computes day differences', () => {
		expect(daysBetween('2026-08-01', '2026-08-15')).toBe(14);
		expect(daysBetween('2026-08-15', '2026-08-01')).toBe(-14);
	});

	it('adds days across month boundaries', () => {
		expect(addDays('2026-07-30', 3)).toBe('2026-08-02');
		expect(addDays('2026-12-30', 5)).toBe('2027-01-04');
	});

	it('formats dates deterministically', () => {
		expect(dateToISO(new Date(2026, 7, 4))).toBe('2026-08-04');
		expect(toISODate(2026, 0, 9)).toBe('2026-01-09');
	});
});
