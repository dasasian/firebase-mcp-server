import { describe, it, expect } from 'vitest';
import {
  applyClientSideFiltering,
  matchesLikeClause,
  getNestedValue,
  processDistinct,
  processGroupBy,
  projectFields,
  applyOrdering,
  executeQuery,
  resolveFieldValue,
  sanitizePayload,
} from '../src/shared/logging-query-processor.js';

const entry = (over: Record<string, unknown> = {}) => ({
  timestamp: '2024-03-01T12:00:00.000Z',
  severity: 'INFO',
  functionName: 'api',
  textPayload: 'hello world',
  ...over,
});

describe('getNestedValue', () => {
  it('reads a top-level key', () => {
    expect(getNestedValue({ a: 1 }, 'a')).toBe(1);
  });

  it('reads a dotted path', () => {
    expect(getNestedValue({ a: { b: { c: 'x' } } }, 'a.b.c')).toBe('x');
  });

  it('returns undefined for a missing key', () => {
    expect(getNestedValue({ a: 1 }, 'b')).toBeUndefined();
  });

  it('returns undefined when the path runs into a primitive', () => {
    expect(getNestedValue({ a: 1 }, 'a.b.c')).toBeUndefined();
  });

  it('returns undefined for null input', () => {
    expect(getNestedValue(null, 'a')).toBeUndefined();
  });

  it('reads an array element by index', () => {
    expect(getNestedValue({ a: ['x', 'y'] }, 'a.1')).toBe('y');
  });
});

describe('matchesLikeClause', () => {
  it('matches a trailing % wildcard', () => {
    expect(matchesLikeClause(entry(), { field: 'textPayload', value: 'hello%' })).toBe(true);
  });

  it('matches a leading % wildcard', () => {
    expect(matchesLikeClause(entry(), { field: 'textPayload', value: '%world' })).toBe(true);
  });

  it('matches a contains pattern', () => {
    expect(matchesLikeClause(entry(), { field: 'textPayload', value: '%lo wo%' })).toBe(true);
  });

  it('requires a full match when there is no wildcard', () => {
    expect(matchesLikeClause(entry(), { field: 'textPayload', value: 'hello' })).toBe(false);
    expect(matchesLikeClause(entry(), { field: 'textPayload', value: 'hello world' })).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(matchesLikeClause(entry(), { field: 'textPayload', value: 'HELLO%' })).toBe(true);
  });

  it('treats _ as exactly one character', () => {
    expect(matchesLikeClause(entry({ textPayload: 'cat' }), { field: 'textPayload', value: 'c_t' })).toBe(true);
    expect(matchesLikeClause(entry({ textPayload: 'coat' }), { field: 'textPayload', value: 'c_t' })).toBe(false);
  });

  it('treats regex metacharacters in the pattern as literals', () => {
    expect(matchesLikeClause(entry({ textPayload: 'a.b' }), { field: 'textPayload', value: 'a.b' })).toBe(true);
    expect(matchesLikeClause(entry({ textPayload: 'axb' }), { field: 'textPayload', value: 'a.b' })).toBe(false);
  });

  it('does not let a pattern anchor loosely', () => {
    expect(matchesLikeClause(entry({ textPayload: 'xhellox' }), { field: 'textPayload', value: 'hello' })).toBe(false);
  });

  it('returns false when the field is missing or not a string', () => {
    expect(matchesLikeClause(entry(), { field: 'nope', value: '%' })).toBe(false);
    expect(matchesLikeClause(entry({ textPayload: 42 }), { field: 'textPayload', value: '%' })).toBe(false);
  });

  it('returns false when the pattern is not a string', () => {
    expect(matchesLikeClause(entry(), { field: 'textPayload', value: 42 })).toBe(false);
  });

  it('reads a dotted field path', () => {
    const e = entry({ jsonPayload: { message: 'boom' } });
    expect(matchesLikeClause(e, { field: 'jsonPayload.message', value: 'bo%' })).toBe(true);
  });
});

describe('applyClientSideFiltering — operators', () => {
  const entries = [
    entry({ severity: 'INFO', latency: 10 }),
    entry({ severity: 'ERROR', latency: 50 }),
    entry({ severity: 'WARNING', latency: 30 }),
  ];

  it('returns everything when there are no clauses', () => {
    expect(applyClientSideFiltering(entries, [])).toHaveLength(3);
  });

  it('filters with ==', () => {
    const out = applyClientSideFiltering(entries, [
      { field: 'severity', operator: '==', value: 'ERROR' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe('ERROR');
  });

  it('filters with !=', () => {
    const out = applyClientSideFiltering(entries, [
      { field: 'severity', operator: '!=', value: 'INFO' },
    ]);
    expect(out).toHaveLength(2);
  });

  it('filters with <, <=, >, >=', () => {
    const f = (operator: string, value: unknown) =>
      applyClientSideFiltering(entries, [{ field: 'latency', operator, value }]).length;
    expect(f('<', 30)).toBe(1);
    expect(f('<=', 30)).toBe(2);
    expect(f('>', 30)).toBe(1);
    expect(f('>=', 30)).toBe(2);
  });

  it('filters with in', () => {
    const out = applyClientSideFiltering(entries, [
      { field: 'severity', operator: 'in', value: ['INFO', 'WARNING'] },
    ]);
    expect(out).toHaveLength(2);
  });

  it('drops everything when in receives a non-array value', () => {
    const out = applyClientSideFiltering(entries, [
      { field: 'severity', operator: 'in', value: 'INFO' },
    ]);
    expect(out).toHaveLength(0);
  });

  it('filters with LIKE', () => {
    const out = applyClientSideFiltering(
      [entry({ textPayload: 'hello world' }), entry({ textPayload: 'bye' })],
      [{ field: 'textPayload', operator: 'LIKE', value: 'hello%' }]
    );
    expect(out).toHaveLength(1);
  });

  it('applies multiple clauses as AND', () => {
    const out = applyClientSideFiltering(entries, [
      { field: 'severity', operator: '!=', value: 'INFO' },
      { field: 'latency', operator: '>', value: 40 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe('ERROR');
  });

  it('ignores an operator it does not handle client-side', () => {
    const out = applyClientSideFiltering(entries, [
      { field: 'severity', operator: 'NOT_A_REAL_OP', value: 'nothing' },
    ]);
    expect(out).toHaveLength(3);
  });

  it('drops an entry whose comparison field is missing', () => {
    const out = applyClientSideFiltering(entries, [
      { field: 'missing', operator: '>', value: 1 },
    ]);
    expect(out).toHaveLength(0);
  });

  it('falls back to jsonPayload.labels.* for a labels.* equality clause', () => {
    const cloudRunV2 = entry({ jsonPayload: { labels: { env: 'prod' } } });
    const plain = entry({ labels: { env: 'prod' } });
    const other = entry({ labels: { env: 'dev' } });
    const out = applyClientSideFiltering([cloudRunV2, plain, other], [
      { field: 'labels.env', operator: '==', value: 'prod' },
    ]);
    expect(out).toHaveLength(2);
  });
});

describe('processDistinct', () => {
  it('returns sorted unique values as aggregated rows', () => {
    const out = processDistinct(
      [entry({ severity: 'INFO' }), entry({ severity: 'ERROR' }), entry({ severity: 'INFO' })],
      'severity',
      'FILTER'
    );
    expect(out.aggregatedResults).toEqual([{ severity: 'ERROR' }, { severity: 'INFO' }]);
    expect(out.totalEntries).toBe(2);
    expect(out.isAggregated).toBe(true);
    expect(out.cloudLoggingFilter).toBe('FILTER');
  });

  it('skips entries where the field is missing or null', () => {
    const out = processDistinct(
      [entry({ severity: 'INFO' }), entry({ severity: null }), entry({ other: 1 })],
      'severity',
      ''
    );
    expect(out.aggregatedResults).toEqual([{ severity: 'INFO' }]);
  });

  it('reads a dotted field path', () => {
    const out = processDistinct(
      [entry({ jsonPayload: { code: 500 } }), entry({ jsonPayload: { code: 500 } })],
      'jsonPayload.code',
      ''
    );
    expect(out.aggregatedResults).toEqual([{ 'jsonPayload.code': '500' }]);
  });

  it('returns an empty result for no entries', () => {
    const out = processDistinct([], 'severity', '');
    expect(out.aggregatedResults).toEqual([]);
    expect(out.totalEntries).toBe(0);
  });
});

describe('processGroupBy', () => {
  const entries = [
    entry({ functionName: 'api', severity: 'ERROR', latency: 10 }),
    entry({ functionName: 'api', severity: 'ERROR', latency: 50 }),
    entry({ functionName: 'worker', severity: 'INFO', latency: 30 }),
  ];

  it('counts rows per group', () => {
    const out = processGroupBy(entries, ['functionName'],
      [{ field: '*', operation: 'count' }], [], 100, '');
    expect(out.aggregatedResults).toHaveLength(2);
    const api = out.aggregatedResults!.find(r => r.functionName === 'api')!;
    expect(api['count_*']).toBe(2);
    expect(out.isAggregated).toBe(true);
  });

  it('uses the alias when one is given', () => {
    const out = processGroupBy(entries, ['functionName'],
      [{ field: '*', operation: 'count', alias: 'total' }], [], 100, '');
    expect(out.aggregatedResults![0].total).toBeTypeOf('number');
  });

  it('groups by more than one field', () => {
    const out = processGroupBy(entries, ['functionName', 'severity'],
      [{ field: '*', operation: 'count' }], [], 100, '');
    expect(out.aggregatedResults).toHaveLength(2);
  });

  it('computes min and max over a numeric field', () => {
    const out = processGroupBy(entries, ['functionName'],
      [
        { field: 'latency', operation: 'max', alias: 'hi' },
        { field: 'latency', operation: 'min', alias: 'lo' },
      ], [], 100, '');
    const api = out.aggregatedResults!.find(r => r.functionName === 'api')!;
    expect(api.hi).toBe(50);
    expect(api.lo).toBe(10);
  });

  it('computes min and max over ISO timestamp strings', () => {
    const out = processGroupBy(
      [
        entry({ functionName: 'api', timestamp: '2024-03-01T10:00:00.000Z' }),
        entry({ functionName: 'api', timestamp: '2024-03-01T12:00:00.000Z' }),
      ],
      ['functionName'],
      [
        { field: 'timestamp', operation: 'max', alias: 'last' },
        { field: 'timestamp', operation: 'min', alias: 'first' },
      ], [], 100, '');
    expect(out.aggregatedResults![0].last).toBe('2024-03-01T12:00:00.000Z');
    expect(out.aggregatedResults![0].first).toBe('2024-03-01T10:00:00.000Z');
  });

  it('turns a missing group field into null', () => {
    const out = processGroupBy([entry({ other: 1 })], ['region'],
      [{ field: '*', operation: 'count' }], [], 100, '');
    expect(out.aggregatedResults![0].region).toBeNull();
  });

  it('orders groups descending and applies the limit', () => {
    const out = processGroupBy(entries, ['functionName'],
      [{ field: '*', operation: 'count', alias: 'total' }],
      [{ field: 'total', direction: 'desc' }], 1, '');
    expect(out.aggregatedResults).toHaveLength(1);
    expect(out.aggregatedResults![0].functionName).toBe('api');
    expect(out.totalEntries).toBe(1);
  });

  it('orders ascending by default', () => {
    const out = processGroupBy(entries, ['functionName'],
      [{ field: '*', operation: 'count', alias: 'total' }],
      [{ field: 'total' }], 100, '');
    expect(out.aggregatedResults![0].functionName).toBe('worker');
  });

  it('omits an aggregate when the group has no values for the field', () => {
    const out = processGroupBy([entry({ functionName: 'api' })], ['functionName'],
      [{ field: 'missing', operation: 'max', alias: 'hi' }], [], 100, '');
    expect(out.aggregatedResults![0]).not.toHaveProperty('hi');
  });

  it('returns an empty result for no entries', () => {
    const out = processGroupBy([], ['functionName'],
      [{ field: '*', operation: 'count' }], [], 100, '');
    expect(out.aggregatedResults).toEqual([]);
  });
});

describe('projectFields', () => {
  it('keeps only the requested top-level fields', () => {
    const out = projectFields(entry(), ['severity', 'functionName']);
    expect(out).toEqual({ severity: 'INFO', functionName: 'api' });
  });

  it('keeps a dotted path under its flat key', () => {
    const out = projectFields(entry({ jsonPayload: { code: 500 } }), ['jsonPayload.code']);
    expect(out).toEqual({ 'jsonPayload.code': 500 });
  });

  it('omits a missing field rather than emitting undefined', () => {
    const out = projectFields(entry(), ['nope', 'a.b']);
    expect(out).toEqual({});
  });

  it('keeps a top-level field whose value is undefined', () => {
    const out = projectFields({ a: undefined }, ['a']);
    expect(Object.keys(out)).toEqual(['a']);
  });

  it('returns an empty object for an empty field list', () => {
    expect(projectFields(entry(), [])).toEqual({});
  });
});

describe('applyOrdering', () => {
  it('returns entries untouched when there is no order clause', () => {
    const entries = [entry({ latency: 3 }), entry({ latency: 1 })];
    expect(applyOrdering(entries, []).map(e => e.latency)).toEqual([3, 1]);
  });

  it('sorts ascending by default', () => {
    const out = applyOrdering(
      [entry({ latency: 3 }), entry({ latency: 1 }), entry({ latency: 2 })],
      [{ field: 'latency' }]
    );
    expect(out.map(e => e.latency)).toEqual([1, 2, 3]);
  });

  it('sorts descending', () => {
    const out = applyOrdering(
      [entry({ latency: 1 }), entry({ latency: 3 })],
      [{ field: 'latency', direction: 'desc' }]
    );
    expect(out.map(e => e.latency)).toEqual([3, 1]);
  });

  it('sorts ISO timestamp strings chronologically', () => {
    const out = applyOrdering(
      [
        entry({ timestamp: '2024-03-01T12:00:00.000Z' }),
        entry({ timestamp: '2024-03-01T10:00:00.000Z' }),
      ],
      [{ field: 'timestamp' }]
    );
    expect(out[0].timestamp).toBe('2024-03-01T10:00:00.000Z');
  });

  it('sorts Date values', () => {
    const out = applyOrdering(
      [entry({ at: new Date(2000) }), entry({ at: new Date(1000) })],
      [{ field: 'at' }]
    );
    expect((out[0].at as Date).getTime()).toBe(1000);
  });

  it('falls through to the next key when the first ties', () => {
    const out = applyOrdering(
      [
        entry({ functionName: 'api', latency: 5 }),
        entry({ functionName: 'api', latency: 1 }),
      ],
      [{ field: 'functionName' }, { field: 'latency' }]
    );
    expect(out.map(e => e.latency)).toEqual([1, 5]);
  });

  it('pushes missing values last when ascending', () => {
    const out = applyOrdering(
      [entry({ other: 1 }), entry({ latency: 5 })],
      [{ field: 'latency' }]
    );
    expect(out[0].latency).toBe(5);
    expect(out[1].latency).toBeUndefined();
  });

  it('sorts a dotted field path', () => {
    const out = applyOrdering(
      [entry({ jsonPayload: { code: 500 } }), entry({ jsonPayload: { code: 200 } })],
      [{ field: 'jsonPayload.code' }]
    );
    expect(out[0].jsonPayload.code).toBe(200);
  });
});

describe('executeQuery', () => {
  const entries = [
    entry({ severity: 'ERROR', latency: 50 }),
    entry({ severity: 'INFO', latency: 10 }),
    entry({ severity: 'ERROR', latency: 30 }),
  ];

  it('filters, orders, and limits in one pass', () => {
    const out = executeQuery(entries, {
      where: [{ field: 'severity', operator: '==', value: 'ERROR' }],
      aggregates: [],
      orderBy: [{ field: 'latency' }],
      limit: 1,
    });
    expect(out.isAggregated).toBe(false);
    expect(out.entries).toHaveLength(1);
    expect(out.entries![0].latency).toBe(30);
  });

  it('reports totalEntries before the limit is applied', () => {
    const out = executeQuery(entries, {
      where: [], aggregates: [], orderBy: [], limit: 1,
    });
    expect(out.entries).toHaveLength(1);
    expect(out.totalEntries).toBe(3);
  });

  it('short-circuits to DISTINCT, ignoring fields and ordering', () => {
    const out = executeQuery(entries, {
      where: [], distinct: 'severity', aggregates: [], orderBy: [], limit: 100,
    });
    expect(out.isAggregated).toBe(true);
    expect(out.aggregatedResults).toEqual([{ severity: 'ERROR' }, { severity: 'INFO' }]);
  });

  it('short-circuits to GROUP BY when groupBy is non-empty', () => {
    const out = executeQuery(entries, {
      where: [], groupBy: ['severity'],
      aggregates: [{ field: '*', operation: 'count', alias: 'total' }],
      orderBy: [], limit: 100,
    });
    expect(out.isAggregated).toBe(true);
    expect(out.aggregatedResults).toHaveLength(2);
  });

  it('ignores an empty groupBy array', () => {
    const out = executeQuery(entries, {
      where: [], groupBy: [], aggregates: [], orderBy: [], limit: 100,
    });
    expect(out.isAggregated).toBe(false);
  });

  it('projects fields before ordering', () => {
    const out = executeQuery(entries, {
      where: [], fields: ['severity', 'latency'], aggregates: [],
      orderBy: [{ field: 'latency' }], limit: 100,
    });
    expect(Object.keys(out.entries![0])).toEqual(['severity', 'latency']);
    expect(out.entries!.map(e => e.latency)).toEqual([10, 30, 50]);
  });

  it('returns an empty result when the filter matches nothing', () => {
    const out = executeQuery(entries, {
      where: [{ field: 'severity', operator: '==', value: 'DEBUG' }],
      aggregates: [], orderBy: [], limit: 100,
    });
    expect(out.entries).toEqual([]);
    expect(out.totalEntries).toBe(0);
  });
});

describe('resolveFieldValue', () => {
  it('reads a field that is present', () => {
    expect(resolveFieldValue(entry(), 'textPayload')).toBe('hello world');
  });

  it('falls back from textPayload to message for structured logs', () => {
    const e = entry({ textPayload: undefined, message: 'structured line' });
    expect(resolveFieldValue(e, 'textPayload')).toBe('structured line');
  });

  it('falls back from message to jsonPayload.message', () => {
    const e = { jsonPayload: { message: 'deep line' } };
    expect(resolveFieldValue(e, 'message')).toBe('deep line');
  });

  it('falls back from labels.* to jsonPayload.labels.*', () => {
    const e = { jsonPayload: { labels: { env: 'prod' } } };
    expect(resolveFieldValue(e, 'labels.env')).toBe('prod');
  });

  it('returns undefined when neither shape has the field', () => {
    expect(resolveFieldValue(entry(), 'nope')).toBeUndefined();
  });
});

describe('functionName matching is case-insensitive (gen2 service names)', () => {
  // A gen2 function logs under the lowercased Cloud Run service name.
  const gen2 = entry({ functionName: 'extractreceipt' });

  it('matches a camelCase name against the lowercased service name', () => {
    const out = applyClientSideFiltering(
      [gen2],
      [{ field: 'functionName', operator: '==', value: 'extractReceipt' }]
    );
    expect(out).toHaveLength(1);
  });

  it('matches inside an "in" list', () => {
    const out = applyClientSideFiltering(
      [gen2],
      [{ field: 'functionName', operator: 'in', value: ['sendEmail', 'extractReceipt'] }]
    );
    expect(out).toHaveLength(1);
  });

  it('excludes a case-insensitive match under !=', () => {
    const out = applyClientSideFiltering(
      [gen2],
      [{ field: 'functionName', operator: '!=', value: 'extractReceipt' }]
    );
    expect(out).toEqual([]);
  });

  it('still rejects a different function', () => {
    const out = applyClientSideFiltering(
      [gen2],
      [{ field: 'functionName', operator: '==', value: 'sendEmail' }]
    );
    expect(out).toEqual([]);
  });

  it('leaves other fields case-sensitive', () => {
    const out = applyClientSideFiltering(
      [entry({ severity: 'ERROR' })],
      [{ field: 'severity', operator: '==', value: 'error' }]
    );
    expect(out).toEqual([]);
  });
});

describe('structured-log message handling', () => {
  const structured = entry({ textPayload: undefined, message: 'SMTP timeout' });

  it('projects message when textPayload was requested but is absent', () => {
    const out = projectFields(structured, ['timestamp', 'textPayload']);
    expect(out.message).toBe('SMTP timeout');
    expect(out).not.toHaveProperty('textPayload');
  });

  it('still projects textPayload when the entry has one', () => {
    const out = projectFields(entry(), ['textPayload']);
    expect(out).toEqual({ textPayload: 'hello world' });
  });

  it('matches a LIKE search on textPayload against the message', () => {
    const out = applyClientSideFiltering(
      [structured],
      [{ field: 'textPayload', operator: 'LIKE', value: '%timeout%' }]
    );
    expect(out).toHaveLength(1);
  });

  it('groups structured entries by message under a textPayload groupBy', () => {
    const out = processGroupBy(
      [structured, structured],
      ['textPayload'],
      [{ field: '*', operation: 'count', alias: 'count' }],
      [], 10, ''
    );
    expect(out.aggregatedResults).toEqual([{ textPayload: 'SMTP timeout', count: 2 }]);
  });
});

describe('sanitizePayload', () => {
  it('replaces a JSON-shaped Buffer with a short placeholder', () => {
    const payload = {
      type_url: 'type.googleapis.com/google.cloud.audit.AuditLog',
      value: { type: 'Buffer', data: [18, 0, 26, 123] },
    };
    expect(sanitizePayload(payload)).toEqual({
      type_url: 'type.googleapis.com/google.cloud.audit.AuditLog',
      value: '<Buffer 4 bytes>',
    });
  });

  it('replaces a real Buffer', () => {
    expect(sanitizePayload({ v: Buffer.from('abc') })).toEqual({ v: '<Buffer 3 bytes>' });
  });

  it('replaces a typed array', () => {
    expect(sanitizePayload({ v: new Uint8Array(8) })).toEqual({ v: '<Uint8Array 8 bytes>' });
  });

  it('leaves ordinary payloads untouched', () => {
    const payload = { message: 'hi', error: { name: 'TypeError' }, tags: ['a', 'b'] };
    expect(sanitizePayload(payload)).toEqual(payload);
  });

  it('passes primitives and null through', () => {
    expect(sanitizePayload('x')).toBe('x');
    expect(sanitizePayload(null)).toBeNull();
  });

  it('truncates payloads nested past the depth cap', () => {
    let deep: any = 'bottom';
    for (let i = 0; i < 20; i++) deep = { next: deep };
    expect(JSON.stringify(sanitizePayload(deep))).toContain('nesting too deep');
  });
});
