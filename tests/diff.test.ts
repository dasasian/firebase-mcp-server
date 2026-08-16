import { describe, it, expect } from 'vitest';
import { calculateDiff, formatDiff, hasChanges } from '../src/shared/diff.js';

describe('calculateDiff — new document', () => {
  it('treats every incoming field as added when existing is null', () => {
    const diff = calculateDiff(null, { name: 'Alice', age: 30 });
    expect(diff.added).toEqual({ name: 'Alice', age: 30 });
    expect(diff.removed).toEqual({});
    expect(diff.modified).toEqual([]);
  });

  it('reports no changes for an empty incoming document', () => {
    const diff = calculateDiff(null, {});
    expect(hasChanges(diff)).toBe(false);
  });
});

describe('calculateDiff — added / removed / modified', () => {
  it('classifies each field into the right bucket', () => {
    const diff = calculateDiff(
      { keep: 1, change: 'old', drop: true },
      { keep: 1, change: 'new', fresh: 'x' }
    );
    expect(diff.added).toEqual({ fresh: 'x' });
    expect(diff.removed).toEqual({ drop: true });
    expect(diff.modified).toEqual([
      { field: 'change', oldValue: 'old', newValue: 'new' },
    ]);
  });

  it('returns an empty diff for identical documents', () => {
    const diff = calculateDiff({ a: 1, b: 'two' }, { a: 1, b: 'two' });
    expect(diff.added).toEqual({});
    expect(diff.removed).toEqual({});
    expect(diff.modified).toEqual([]);
    expect(hasChanges(diff)).toBe(false);
  });

  it('counts a field present-but-undefined as existing, not added', () => {
    const diff = calculateDiff({ a: undefined }, { a: undefined });
    expect(diff.added).toEqual({});
    expect(diff.modified).toEqual([]);
  });

  it('reports a value set to undefined as a modification, not a removal', () => {
    const diff = calculateDiff({ a: 1 }, { a: undefined });
    expect(diff.removed).toEqual({});
    expect(diff.modified).toEqual([
      { field: 'a', oldValue: 1, newValue: undefined },
    ]);
  });
});

describe('calculateDiff — deep equality', () => {
  it('does not flag structurally equal nested objects', () => {
    const diff = calculateDiff(
      { profile: { name: 'Alice', tags: ['a', 'b'] } },
      { profile: { name: 'Alice', tags: ['a', 'b'] } }
    );
    expect(diff.modified).toEqual([]);
  });

  it('flags a nested value change', () => {
    const diff = calculateDiff(
      { profile: { name: 'Alice' } },
      { profile: { name: 'Bob' } }
    );
    expect(diff.modified).toHaveLength(1);
    expect(diff.modified[0].field).toBe('profile');
  });

  it('flags an extra key in a nested object', () => {
    const diff = calculateDiff(
      { profile: { name: 'Alice' } },
      { profile: { name: 'Alice', age: 30 } }
    );
    expect(diff.modified).toHaveLength(1);
  });

  it('flags arrays that differ in length', () => {
    const diff = calculateDiff({ tags: ['a'] }, { tags: ['a', 'b'] });
    expect(diff.modified).toHaveLength(1);
  });

  it('flags arrays that differ in order', () => {
    const diff = calculateDiff({ tags: ['a', 'b'] }, { tags: ['b', 'a'] });
    expect(diff.modified).toHaveLength(1);
  });

  it('treats null and undefined as different', () => {
    const diff = calculateDiff({ a: null }, { a: undefined });
    expect(diff.modified).toHaveLength(1);
  });

  it('does not flag two nulls', () => {
    const diff = calculateDiff({ a: null }, { a: null });
    expect(diff.modified).toEqual([]);
  });

  it('treats a number and its string form as different', () => {
    const diff = calculateDiff({ a: 1 }, { a: '1' });
    expect(diff.modified).toHaveLength(1);
  });

  it('treats an array and an object as different', () => {
    const diff = calculateDiff({ a: [] }, { a: {} });
    expect(diff.modified).toHaveLength(1);
  });

  it('compares deeply nested structures', () => {
    const diff = calculateDiff(
      { a: { b: { c: [1, { d: 2 }] } } },
      { a: { b: { c: [1, { d: 3 }] } } }
    );
    expect(diff.modified).toHaveLength(1);
  });
});

describe('hasChanges', () => {
  it('is true when only fields were added', () => {
    expect(hasChanges({ added: { a: 1 }, removed: {}, modified: [] })).toBe(true);
  });

  it('is true when only fields were removed', () => {
    expect(hasChanges({ added: {}, removed: { a: 1 }, modified: [] })).toBe(true);
  });

  it('is true when only fields were modified', () => {
    expect(
      hasChanges({
        added: {},
        removed: {},
        modified: [{ field: 'a', oldValue: 1, newValue: 2 }],
      })
    ).toBe(true);
  });

  it('is false for an empty diff', () => {
    expect(hasChanges({ added: {}, removed: {}, modified: [] })).toBe(false);
  });
});

describe('formatDiff', () => {
  it('names the document and reports no changes', () => {
    const text = formatDiff({ added: {}, removed: {}, modified: [] }, 'users/u1');
    expect(text).toContain('Diff for users/u1:');
    expect(text).toContain('No changes');
  });

  it('lists added, removed, and modified sections', () => {
    const text = formatDiff(
      {
        added: { fresh: 'x' },
        removed: { drop: true },
        modified: [{ field: 'change', oldValue: 'old', newValue: 'new' }],
      },
      'users/u1'
    );
    expect(text).toContain('+ fresh: "x"');
    expect(text).toContain('- drop: true');
    expect(text).toContain('~ change:');
    expect(text).toContain('- "old"');
    expect(text).toContain('+ "new"');
    expect(text).not.toContain('No changes');
  });

  it('omits sections that are empty', () => {
    const text = formatDiff({ added: { a: 1 }, removed: {}, modified: [] }, 'users/u1');
    expect(text).toContain('Added fields');
    expect(text).not.toContain('Removed fields');
    expect(text).not.toContain('Modified fields');
  });
});
