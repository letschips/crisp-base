import { describe, expect, it } from 'vitest';
import { clampCardLimit, orderColumns } from '../src/board-utils';

describe('orderColumns', () => {
	it('keeps data columns first, then appends extra empty columns', () => {
		const columns = new Map([
			['Todo', [1]],
			['Done', [2]],
		]);
		const result = orderColumns(columns, ['Backlog'], []);
		expect(result.map(([label]) => label)).toEqual(['Todo', 'Done', 'Backlog']);
	});

	it('places ordered empty columns in the middle', () => {
		const columns = new Map([
			['Todo', ['a']],
			['Done', ['b', 'c']],
		]);
		const result = orderColumns(
			columns,
			['Backlog'],
			['Todo', 'In Progress', 'Done'],
		);
		expect(result.map(([label, value]) => [label, value === null ? null : value.length])).toEqual([
			['Todo', 1],
			['In Progress', null],
			['Done', 2],
			['Backlog', null],
		]);
	});

	it('deduplicates repeated labels', () => {
		const columns = new Map([['Todo', [1]]]);
		const result = orderColumns(columns, ['Todo'], ['Todo', 'Todo']);
		expect(result.map(([label]) => label)).toEqual(['Todo']);
	});

	it('ignores empty labels', () => {
		const columns = new Map([['Todo', [1]]]);
		const result = orderColumns(columns, [], ['', 'Todo']);
		expect(result.map(([label]) => label)).toEqual(['Todo']);
	});
});

describe('clampCardLimit', () => {
	it('clamps to the allowed range', () => {
		expect(clampCardLimit(5)).toBe(20);
		expect(clampCardLimit(5000)).toBe(2000);
		expect(clampCardLimit(100)).toBe(100);
		expect(clampCardLimit('unexpected', 300)).toBe(300);
	});
});
