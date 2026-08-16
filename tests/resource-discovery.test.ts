import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getDiscoveredCollections,
  trackDocumentAccess,
  getMRUDocuments,
  extractCollectionPath,
  getSchemaCollectionPaths,
  clearDiscoveryCache,
} from '../src/shared/resource-discovery.js';

beforeEach(() => {
  clearDiscoveryCache();
});

describe('extractCollectionPath', () => {
  it('returns the first segment of a schema path', () => {
    expect(extractCollectionPath('/users/{userId}')).toBe('users');
  });

  it('ignores nested segments', () => {
    expect(extractCollectionPath('/posts/{postId}/comments/{commentId}')).toBe('posts');
  });

  it('works without a leading slash', () => {
    expect(extractCollectionPath('users/{userId}')).toBe('users');
  });

  it('strips repeated leading slashes', () => {
    expect(extractCollectionPath('///users/{userId}')).toBe('users');
  });

  it('strips braces from a parameterized first segment', () => {
    expect(extractCollectionPath('/{tenant}/users')).toBe('tenant');
  });

  it('handles a single literal segment', () => {
    expect(extractCollectionPath('/config')).toBe('config');
  });
});

describe('getSchemaCollectionPaths', () => {
  it('collects the collection segments at even indices', () => {
    const paths = getSchemaCollectionPaths({
      '/users/{userId}': {},
      '/posts/{postId}/comments/{commentId}': {},
    });
    expect([...paths].sort()).toEqual(['comments', 'posts', 'users']);
  });

  it('deduplicates a collection shared by two schemas', () => {
    const paths = getSchemaCollectionPaths({
      '/users/{userId}': {},
      '/users/{userId}/orders/{orderId}': {},
    });
    expect([...paths].sort()).toEqual(['orders', 'users']);
  });

  it('strips braces from parameterized segments', () => {
    const paths = getSchemaCollectionPaths({ '/{tenant}/users/{userId}': {} });
    expect(paths.has('tenant')).toBe(true);
  });

  it('returns an empty set for no schemas', () => {
    expect(getSchemaCollectionPaths({}).size).toBe(0);
  });

  it('handles a collection-only path (odd segment count)', () => {
    const paths = getSchemaCollectionPaths({ '/settings': {} });
    expect([...paths]).toEqual(['settings']);
  });
});

describe('trackDocumentAccess / getMRUDocuments', () => {
  it('starts empty', () => {
    expect(getMRUDocuments()).toEqual([]);
  });

  it('records a document with a firestore:// uri', () => {
    trackDocumentAccess('users/user-123');
    const [doc] = getMRUDocuments();
    expect(doc.uri).toBe('firestore://users/user-123');
    expect(doc.name).toBe('📄 users/user-123');
    expect(doc.mimeType).toBe('application/json');
  });

  it('uses the singular wording for one access', () => {
    trackDocumentAccess('users/u1');
    expect(getMRUDocuments()[0].description).toBe('Recent document (1 access)');
  });

  it('uses the plural wording and counts repeats', () => {
    trackDocumentAccess('users/u1');
    trackDocumentAccess('users/u1');
    expect(getMRUDocuments()).toHaveLength(1);
    expect(getMRUDocuments()[0].description).toBe('Recent document (2 accesses)');
  });

  it('sorts by access count, most used first', () => {
    trackDocumentAccess('users/rare');
    trackDocumentAccess('users/hot');
    trackDocumentAccess('users/hot');
    expect(getMRUDocuments()[0].uri).toBe('firestore://users/hot');
  });

  it('handles a nested document path', () => {
    trackDocumentAccess('organizations/org-1/products/prod-2');
    expect(getMRUDocuments()[0].uri).toBe(
      'firestore://organizations/org-1/products/prod-2'
    );
  });

  it('caps the cache at 50 documents', () => {
    for (let i = 0; i < 60; i++) {
      trackDocumentAccess(`users/u${i}`);
    }
    expect(getMRUDocuments()).toHaveLength(50);
  });

  it('keeps the most used document when evicting', () => {
    trackDocumentAccess('users/hot');
    for (let i = 0; i < 5; i++) {
      trackDocumentAccess('users/hot');
    }
    for (let i = 0; i < 60; i++) {
      trackDocumentAccess(`users/u${i}`);
    }
    const uris = getMRUDocuments().map(d => d.uri);
    expect(uris).toHaveLength(50);
    expect(uris[0]).toBe('firestore://users/hot');
  });

  it('is emptied by clearDiscoveryCache', () => {
    trackDocumentAccess('users/u1');
    clearDiscoveryCache();
    expect(getMRUDocuments()).toEqual([]);
  });
});

describe('getDiscoveredCollections — auto-discover disabled', () => {
  const original = process.env.FIRESTORE_AUTO_DISCOVER;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.FIRESTORE_AUTO_DISCOVER;
    } else {
      process.env.FIRESTORE_AUTO_DISCOVER = original;
    }
    vi.restoreAllMocks();
  });

  it('returns nothing and never touches Firestore', async () => {
    process.env.FIRESTORE_AUTO_DISCOVER = 'false';
    await expect(getDiscoveredCollections()).resolves.toEqual([]);
  });
});
