import { describe, it, expect } from 'vitest';
import admin from 'firebase-admin';
import {
  serializeDocument,
  deserializeDocument,
  autoSerializeFirestoreTypes,
} from '../src/shared/type-serializer.js';

// Timestamp is a plain value class — usable without initializing an app.
const Timestamp = admin.firestore.Timestamp;
const ISO = '2024-03-01T12:00:00.000Z';
const ts = () => Timestamp.fromDate(new Date(ISO));

describe('serializeDocument — top-level fields', () => {
  it('converts a Timestamp to an ISO string', () => {
    const out = serializeDocument({ createdAt: ts() }, ['createdAt']);
    expect(out.createdAt).toBe(ISO);
  });

  it('leaves fields that are not listed alone', () => {
    const value = ts();
    const out = serializeDocument({ createdAt: value }, []);
    expect(out.createdAt).toBe(value);
  });

  it('leaves a listed field alone when it is not a Timestamp', () => {
    const out = serializeDocument({ createdAt: 'already a string' }, ['createdAt']);
    expect(out.createdAt).toBe('already a string');
  });

  it('ignores a listed field that is missing', () => {
    const out = serializeDocument({ name: 'Alice' }, ['createdAt']);
    expect(out).toEqual({ name: 'Alice' });
  });

  it('does not mutate the input object', () => {
    const input = { createdAt: ts() };
    serializeDocument(input, ['createdAt']);
    expect(input.createdAt).toBeInstanceOf(Timestamp);
  });
});

describe('serializeDocument — nested and array fields', () => {
  it('converts a nested Timestamp by dot path', () => {
    const out = serializeDocument({ meta: { updatedAt: ts() } }, ['meta.updatedAt']);
    expect((out.meta as any).updatedAt).toBe(ISO);
  });

  it('converts every Timestamp in an array field', () => {
    const out = serializeDocument({ times: [ts(), ts()] }, ['times']);
    expect(out.times).toEqual([ISO, ISO]);
  });

  it('leaves non-Timestamp entries in a mixed array untouched', () => {
    const out = serializeDocument({ times: [ts(), 'raw', 42] }, ['times']);
    expect(out.times).toEqual([ISO, 'raw', 42]);
  });
});

describe('serializeDocument — wildcard paths', () => {
  it('converts a field inside every array item', () => {
    const out = serializeDocument(
      { instances: [{ openedAt: ts() }, { openedAt: ts() }] },
      ['instances.*.openedAt']
    );
    expect(out.instances).toEqual([{ openedAt: ISO }, { openedAt: ISO }]);
  });

  it('skips array items that are missing the field', () => {
    const out = serializeDocument(
      { instances: [{ openedAt: ts() }, { other: 1 }] },
      ['instances.*.openedAt']
    );
    expect(out.instances).toEqual([{ openedAt: ISO }, { other: 1 }]);
  });

  it('does nothing when the wildcard target is not an array', () => {
    const out = serializeDocument({ instances: 'nope' }, ['instances.*.openedAt']);
    expect(out.instances).toBe('nope');
  });

  it('handles a nested field inside array items', () => {
    const out = serializeDocument(
      { instances: [{ meta: { at: ts() } }] },
      ['instances.*.meta.at']
    );
    expect(out.instances).toEqual([{ meta: { at: ISO } }]);
  });
});

describe('deserializeDocument', () => {
  it('converts an ISO string to a Timestamp', () => {
    const out = deserializeDocument({ createdAt: ISO }, ['createdAt']);
    expect(out.createdAt).toBeInstanceOf(Timestamp);
    expect((out.createdAt as any).toDate().toISOString()).toBe(ISO);
  });

  it('converts a nested ISO string by dot path', () => {
    const out = deserializeDocument({ meta: { updatedAt: ISO } }, ['meta.updatedAt']);
    expect((out.meta as any).updatedAt).toBeInstanceOf(Timestamp);
  });

  it('converts every string in an array field', () => {
    const out = deserializeDocument({ times: [ISO, ISO] }, ['times']);
    expect(out.times).toHaveLength(2);
    for (const t of out.times as unknown[]) {
      expect(t).toBeInstanceOf(Timestamp);
    }
  });

  it('leaves non-string entries in a mixed array untouched', () => {
    const out = deserializeDocument({ times: [ISO, 42] }, ['times']);
    expect((out.times as unknown[])[0]).toBeInstanceOf(Timestamp);
    expect((out.times as unknown[])[1]).toBe(42);
  });

  it('leaves a listed field alone when it is not a string', () => {
    const out = deserializeDocument({ createdAt: 42 }, ['createdAt']);
    expect(out.createdAt).toBe(42);
  });

  it('ignores a listed field that is missing', () => {
    const out = deserializeDocument({ name: 'Alice' }, ['createdAt']);
    expect(out).toEqual({ name: 'Alice' });
  });

  it('converts a field inside every array item via wildcard', () => {
    const out = deserializeDocument(
      { instances: [{ openedAt: ISO }, { openedAt: ISO }] },
      ['instances.*.openedAt']
    );
    for (const item of out.instances as any[]) {
      expect(item.openedAt).toBeInstanceOf(Timestamp);
    }
  });
});

describe('serialize ↔ deserialize round trip', () => {
  it('returns the original instant for a top-level field', () => {
    const original = { createdAt: ts() };
    const back = deserializeDocument(
      serializeDocument(original, ['createdAt']),
      ['createdAt']
    );
    expect((back.createdAt as any).isEqual(original.createdAt)).toBe(true);
  });

  it('returns the original instant through a wildcard path', () => {
    const original = { instances: [{ openedAt: ts() }] };
    const back = deserializeDocument(
      serializeDocument(original, ['instances.*.openedAt']),
      ['instances.*.openedAt']
    );
    expect((back.instances as any)[0].openedAt.toDate().toISOString()).toBe(ISO);
  });
});

describe('autoSerializeFirestoreTypes', () => {
  it('converts a bare Timestamp', () => {
    expect(autoSerializeFirestoreTypes(ts())).toBe(ISO);
  });

  it('walks nested objects and arrays', () => {
    const out = autoSerializeFirestoreTypes({
      a: ts(),
      b: { c: ts() },
      d: [ts(), { e: ts() }],
    });
    expect(out).toEqual({
      a: ISO,
      b: { c: ISO },
      d: [ISO, { e: ISO }],
    });
  });

  it('passes primitives and null through unchanged', () => {
    expect(autoSerializeFirestoreTypes('x')).toBe('x');
    expect(autoSerializeFirestoreTypes(42)).toBe(42);
    expect(autoSerializeFirestoreTypes(false)).toBe(false);
    expect(autoSerializeFirestoreTypes(null)).toBe(null);
    expect(autoSerializeFirestoreTypes(undefined)).toBe(undefined);
  });

  it('does not mutate the input', () => {
    const input = { a: ts() };
    autoSerializeFirestoreTypes(input);
    expect(input.a).toBeInstanceOf(Timestamp);
  });
});
