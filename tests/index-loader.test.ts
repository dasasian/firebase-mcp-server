import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  initializeIndexLoader,
  validateQuery,
  isIndexLoaderInitialized,
} from '../src/shared/index-loader.js';

// The loader keeps module-level state with no reset hook, so these tests run in
// order: the "before init" checks come first, then the file-backed ones.

let dir: string;

const indexFile = {
  indexes: [
    {
      collectionGroup: 'orders',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'status', order: 'ASCENDING' },
        { fieldPath: 'createdAt', order: 'DESCENDING' },
      ],
    },
  ],
};

beforeAll(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  dir = await mkdtemp(join(tmpdir(), 'fb-mcp-idx-'));
});

afterAll(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe('before initialization', () => {
  it('reports itself as not initialized', () => {
    expect(isIndexLoaderInitialized()).toBe(false);
  });

  it('is permissive — every query is valid with no index config', () => {
    expect(validateQuery('orders', ['createdAt', 'total'], ['status', 'userId'])).toEqual({
      valid: true,
      requiresIndex: false,
    });
  });
});

describe('initializeIndexLoader', () => {
  it('falls back to an empty index list when the file is missing', async () => {
    await initializeIndexLoader(join(dir, 'does-not-exist.json'));
    expect(isIndexLoaderInitialized()).toBe(true);
  });

  it('falls back to an empty index list when the file is not valid JSON', async () => {
    const bad = join(dir, 'bad.json');
    await writeFile(bad, '{ not json', 'utf-8');
    await initializeIndexLoader(bad);
    expect(isIndexLoaderInitialized()).toBe(true);
    // With no indexes loaded, a composite query cannot be satisfied.
    expect(validateQuery('orders', ['createdAt'], ['status', 'total']).valid).toBe(false);
  });

  it('loads indexes from a valid file', async () => {
    const good = join(dir, 'firestore.indexes.json');
    await writeFile(good, JSON.stringify(indexFile), 'utf-8');
    await initializeIndexLoader(good);
    expect(isIndexLoaderInitialized()).toBe(true);
  });
});

describe('validateQuery — simple queries need no composite index', () => {
  it('accepts no filters at all', () => {
    expect(validateQuery('orders', [], [])).toEqual({ valid: true, requiresIndex: false });
  });

  it('accepts one where and one orderBy', () => {
    expect(validateQuery('orders', ['whatever'], ['anything'])).toEqual({
      valid: true,
      requiresIndex: false,
    });
  });

  it('accepts two orderBy fields only if a where is also absent', () => {
    // Two orderBy fields cross the threshold, so an index is required.
    const result = validateQuery('orders', ['a', 'b'], []);
    expect(result.requiresIndex).toBe(true);
  });
});

describe('validateQuery — composite queries', () => {
  it('accepts a query fully covered by an index', () => {
    expect(validateQuery('orders', ['createdAt'], ['status', 'createdAt'])).toEqual({
      valid: true,
      requiresIndex: true,
    });
  });

  it('reads the collection name from the last path segment', () => {
    expect(
      validateQuery('users/u1/orders', ['createdAt'], ['status', 'createdAt']).valid
    ).toBe(true);
  });

  it('rejects a query that needs a field the index does not have', () => {
    const result = validateQuery('orders', ['createdAt'], ['status', 'total']);
    expect(result.valid).toBe(false);
    expect(result.requiresIndex).toBe(true);
  });

  it('rejects a query on a collection with no index at all', () => {
    const result = validateQuery('invoices', ['createdAt'], ['status', 'total']);
    expect(result.valid).toBe(false);
  });

  it('does not match an index from a different collection group', () => {
    expect(validateQuery('archived_orders', ['createdAt'], ['status', 'createdAt']).valid)
      .toBe(false);
  });

  it('suggests a pasteable index definition when none matches', () => {
    const result = validateQuery('invoices', ['createdAt'], ['status', 'total']);
    expect(result.suggestion).toContain('Add this to firestore.indexes.json');

    const json = JSON.parse(result.suggestion!.split('\n\n')[1]);
    expect(json.collectionGroup).toBe('invoices');
    expect(json.queryScope).toBe('COLLECTION');
    expect(json.fields).toEqual([
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'total', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ]);
  });

  it('omits the suggestion when the query is valid', () => {
    expect(validateQuery('orders', ['createdAt'], ['status', 'createdAt']).suggestion)
      .toBeUndefined();
  });
});
