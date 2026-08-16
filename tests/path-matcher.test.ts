import { describe, it, expect } from 'vitest';
import {
  matchPath,
  isValidFirestorePath,
  isPathParameter,
  normalizePath,
  getCollectionPath,
  getCollectionName,
  isDocumentPath,
  isCollectionPath,
} from '../src/shared/path-matcher.js';

// Minimal schema config — matchPath only reads config.schemas keys/values.
const config = {
  schemas: {
    '/users/{userId}': { schema: {} },
    '/users/{userId}/orders/{orderId}': { schema: {} },
    '/config/settings': { schema: {} },
  },
} as any;

describe('normalizePath', () => {
  it('strips leading and trailing slashes', () => {
    expect(normalizePath('/users/u1/')).toBe('users/u1');
    expect(normalizePath('users/u1')).toBe('users/u1');
    expect(normalizePath('///a///')).toBe('a');
  });
});

describe('isPathParameter', () => {
  it('recognizes {braced} segments only', () => {
    expect(isPathParameter('{userId}')).toBe(true);
    expect(isPathParameter('users')).toBe(false);
    expect(isPathParameter('{userId')).toBe(false);
  });
});

describe('isValidFirestorePath', () => {
  it('rejects empty paths and empty segments', () => {
    expect(isValidFirestorePath([])).toBe(false);
    expect(isValidFirestorePath(['users', '', 'orders'])).toBe(false);
  });
  it('accepts non-empty segment lists', () => {
    expect(isValidFirestorePath(['users', 'u1'])).toBe(true);
  });
});

describe('document vs collection path', () => {
  it('even segment count is a document path, odd is a collection', () => {
    expect(isDocumentPath('users/u1')).toBe(true);
    expect(isCollectionPath('users/u1')).toBe(false);
    expect(isCollectionPath('users')).toBe(true);
    expect(isDocumentPath('users/u1/orders/o1')).toBe(true);
    expect(isCollectionPath('users/u1/orders')).toBe(true);
  });
});

describe('getCollectionPath', () => {
  it('drops the trailing document id', () => {
    expect(getCollectionPath('/users/u1/orders/o1')).toBe('users/u1/orders');
    expect(getCollectionPath('users/u1')).toBe('users');
    expect(getCollectionPath('users')).toBe('');
  });
});

describe('getCollectionName', () => {
  it('returns the collection for both document and collection paths', () => {
    expect(getCollectionName('users/u1/orders/o1')).toBe('orders'); // doc path
    expect(getCollectionName('users/u1/orders')).toBe('orders'); // collection path
    expect(getCollectionName('users')).toBe('users');
  });
});

describe('matchPath', () => {
  it('matches a nested pattern and extracts params', () => {
    const r = matchPath('/users/user-123/orders/order-456', config);
    expect(r.matched).toBe(true);
    expect(r.schemaPath).toBe('/users/{userId}/orders/{orderId}');
    expect(r.params).toEqual({ userId: 'user-123', orderId: 'order-456' });
  });

  it('matches a literal segment pattern', () => {
    const r = matchPath('/config/settings', config);
    expect(r.matched).toBe(true);
    expect(r.schemaPath).toBe('/config/settings');
    expect(r.params).toEqual({});
  });

  it('does not match when a literal differs', () => {
    expect(matchPath('/config/other', config).matched).toBe(false);
  });

  it('does not match on segment-count mismatch', () => {
    expect(matchPath('/users/u1/orders', config).matched).toBe(false);
  });

  it('rejects an invalid path (empty segment)', () => {
    expect(matchPath('/users//orders/o1', config).matched).toBe(false);
  });

  it('picks the single-segment-pair pattern for a top-level doc', () => {
    const r = matchPath('/users/user-9', config);
    expect(r.matched).toBe(true);
    expect(r.schemaPath).toBe('/users/{userId}');
    expect(r.params).toEqual({ userId: 'user-9' });
  });
});
