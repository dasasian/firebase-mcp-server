import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { readFile, writeFile, access } from 'fs/promises';
import { resolve } from 'path';
import {
  initializeLoggingSchemaLoader,
  getLoggingSchema,
  updateAutoDiscoveredSchema,
  isLoggingSchemaInitialized,
  clearLoggingSchemaCache,
} from '../src/shared/logging-schema-loader.js';

// The loader resolves its two file paths from process.cwd() at import time, so
// the filesystem is mocked rather than written to for real.
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(async () => undefined),
  access: vi.fn(),
}));

const MANUAL_PATH = resolve(process.cwd(), 'logging-schemas.json');
const AUTO_PATH = resolve(process.cwd(), '.firebase-logging-schema.json');

const mockAccess = vi.mocked(access);
const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);

const MANUAL = {
  functions: {
    api: {
      description: 'Public HTTP API',
      expectedLabels: { orgId: 'Owning organization' },
    },
  },
};

const AUTO = {
  lastUpdated: '2024-03-01T00:00:00.000Z',
  totalQueriesRun: 3,
  functions: {
    api: { lastSeen: '2024-03-01T00:00:00.000Z', logCount: 12, labels: ['orgId', 'route'] },
    worker: { lastSeen: '2024-03-01T00:00:00.000Z', logCount: 4, labels: ['jobId'] },
  },
  labels: {
    orgId: { functions: ['api'], type: 'identifier', sampleValues: ['org-1'] },
    route: { functions: ['api'], type: 'enum', values: ['/a', '/b'] },
  },
};

/** Make both schema files "exist" (or not) and serve the given contents. */
function mockFiles(files: { manual?: unknown; auto?: unknown }) {
  mockAccess.mockImplementation(async (p: any) => {
    if (p === MANUAL_PATH && files.manual !== undefined) return undefined as never;
    if (p === AUTO_PATH && files.auto !== undefined) return undefined as never;
    throw new Error('ENOENT');
  });
  mockReadFile.mockImplementation(async (p: any) => {
    if (p === MANUAL_PATH && files.manual !== undefined) return JSON.stringify(files.manual) as never;
    if (p === AUTO_PATH && files.auto !== undefined) return JSON.stringify(files.auto) as never;
    throw new Error('ENOENT');
  });
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  clearLoggingSchemaCache();
  mockAccess.mockReset();
  mockReadFile.mockReset();
  mockWriteFile.mockClear();
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('initializeLoggingSchemaLoader', () => {
  it('starts uninitialized', () => {
    expect(isLoggingSchemaInitialized()).toBe(false);
    expect(getLoggingSchema()).toBeNull();
  });

  it('initializes with empty maps when neither file exists', async () => {
    mockFiles({});
    await initializeLoggingSchemaLoader();
    expect(isLoggingSchemaInitialized()).toBe(true);
    expect(getLoggingSchema()!.functions.size).toBe(0);
    expect(getLoggingSchema()!.labels.size).toBe(0);
  });

  it('loads the manual schema alone', async () => {
    mockFiles({ manual: MANUAL });
    await initializeLoggingSchemaLoader();
    const schema = getLoggingSchema()!;
    expect(schema.functions.get('api')!.description).toBe('Public HTTP API');
    expect(schema.labels.get('orgId')!.description).toBe('Owning organization');
    expect(schema.functions.get('api')!.logCount).toBeUndefined();
  });

  it('loads the auto-discovered schema alone', async () => {
    mockFiles({ auto: AUTO });
    await initializeLoggingSchemaLoader();
    const schema = getLoggingSchema()!;
    expect(schema.functions.get('worker')!.logCount).toBe(4);
    expect(schema.functions.get('api')!.observedLabels).toEqual(['orgId', 'route']);
    expect(schema.labels.get('route')!.values).toEqual(['/a', '/b']);
    expect(schema.functions.get('api')!.description).toBeUndefined();
  });

  it('merges both files, keeping manual descriptions and auto counts', async () => {
    mockFiles({ manual: MANUAL, auto: AUTO });
    await initializeLoggingSchemaLoader();
    const schema = getLoggingSchema()!;

    const api = schema.functions.get('api')!;
    expect(api.description).toBe('Public HTTP API');
    expect(api.logCount).toBe(12);
    expect(api.observedLabels).toEqual(['orgId', 'route']);

    const orgId = schema.labels.get('orgId')!;
    expect(orgId.description).toBe('Owning organization');
    expect(orgId.type).toBe('identifier');
    expect(orgId.sampleValues).toEqual(['org-1']);
  });

  it('survives a file that exists but holds invalid JSON', async () => {
    mockAccess.mockResolvedValue(undefined as never);
    mockReadFile.mockResolvedValue('{ not json' as never);
    await initializeLoggingSchemaLoader();
    expect(isLoggingSchemaInitialized()).toBe(true);
    expect(getLoggingSchema()!.functions.size).toBe(0);
  });

  it('does not carry state across a clear', async () => {
    mockFiles({ manual: MANUAL });
    await initializeLoggingSchemaLoader();
    clearLoggingSchemaCache();
    expect(getLoggingSchema()).toBeNull();
  });
});

describe('updateAutoDiscoveredSchema — first run', () => {
  it('creates the schema, counts the query, and writes it to disk', async () => {
    await updateAutoDiscoveredSchema({
      functions: [{ name: 'api', labels: ['orgId'] }],
      labels: new Map([['orgId', new Set(['org-1'])]]),
    });

    expect(mockWriteFile).toHaveBeenCalledOnce();
    const [path, content] = mockWriteFile.mock.calls[0];
    expect(path).toBe(AUTO_PATH);

    const saved = JSON.parse(content as string);
    expect(saved.totalQueriesRun).toBe(1);
    expect(saved.functions.api.logCount).toBe(1);
    expect(saved.functions.api.labels).toEqual(['orgId']);
    expect(saved.labels.orgId.functions).toEqual(['api']);
  });

  it('exposes the result through the merged schema', async () => {
    await updateAutoDiscoveredSchema({
      functions: [{ name: 'api', labels: ['orgId'] }],
      labels: new Map([['orgId', new Set(['org-1'])]]),
    });
    expect(getLoggingSchema()!.functions.get('api')!.logCount).toBe(1);
  });

  it('only lists functions that actually carry the label', async () => {
    await updateAutoDiscoveredSchema({
      functions: [
        { name: 'api', labels: ['orgId'] },
        { name: 'worker', labels: ['jobId'] },
      ],
      labels: new Map([['orgId', new Set(['org-1'])]]),
    });
    const saved = JSON.parse(mockWriteFile.mock.calls[0][1] as string);
    expect(saved.labels.orgId.functions).toEqual(['api']);
  });

  it('handles a run with no discoveries at all', async () => {
    await updateAutoDiscoveredSchema({ functions: [], labels: new Map() });
    const saved = JSON.parse(mockWriteFile.mock.calls[0][1] as string);
    expect(saved.totalQueriesRun).toBe(1);
    expect(saved.functions).toEqual({});
  });
});

describe('updateAutoDiscoveredSchema — repeat runs', () => {
  it('increments counters and unions labels', async () => {
    const run = (labels: string[]) =>
      updateAutoDiscoveredSchema({
        functions: [{ name: 'api', labels: [...labels] }],
        labels: new Map(),
      });

    await run(['orgId']);
    await run(['route']);

    const saved = JSON.parse(mockWriteFile.mock.calls.at(-1)![1] as string);
    expect(saved.totalQueriesRun).toBe(2);
    expect(saved.functions.api.logCount).toBe(2);
    expect(saved.functions.api.labels).toEqual(['orgId', 'route']);
  });

  it('unions label values across runs', async () => {
    const run = (value: string) =>
      updateAutoDiscoveredSchema({
        functions: [{ name: 'api', labels: ['env'] }],
        labels: new Map([['env', new Set([value])]]),
      });

    await run('prod');
    await run('staging');

    const saved = JSON.parse(mockWriteFile.mock.calls.at(-1)![1] as string);
    expect(saved.labels.env.values).toEqual(['prod', 'staging']);
  });
});

describe('label type detection', () => {
  const set = (values: string[]) => new Map([['label', new Set(values)]]);
  const many = (n: number, make: (i: number) => string) =>
    Array.from({ length: n }, (_, i) => make(i));

  const runWith = async (values: string[]) => {
    await updateAutoDiscoveredSchema({
      functions: [{ name: 'api', labels: ['label'] }],
      labels: set(values),
    });
    return JSON.parse(mockWriteFile.mock.calls.at(-1)![1] as string).labels.label;
  };

  it('calls 10 or fewer unique values an enum and stores them all', async () => {
    const label = await runWith(['prod', 'staging', 'dev']);
    expect(label.type).toBe('enum');
    expect(label.values).toEqual(['dev', 'prod', 'staging']);
    expect(label.sampleValues).toBeUndefined();
  });

  it('calls more than 10 numeric values numeric', async () => {
    const label = await runWith(many(12, i => String(i)));
    expect(label.type).toBe('numeric');
    expect(label.sampleValues).toHaveLength(10);
    expect(label.values).toBeUndefined();
  });

  it('calls more than 10 short non-numeric values identifiers', async () => {
    const label = await runWith(many(12, i => `user-abc${i}`));
    expect(label.type).toBe('identifier');
    expect(label.sampleValues).toHaveLength(10);
  });

  it('calls more than 10 long non-numeric values text', async () => {
    const label = await runWith(many(12, i => `a rather long free form message number ${i}`));
    expect(label.type).toBe('text');
    expect(label.sampleValues).toHaveLength(10);
  });

  it('switches an enum to a wider type once it grows past 10 values', async () => {
    await updateAutoDiscoveredSchema({
      functions: [{ name: 'api', labels: ['label'] }],
      labels: set(['a1', 'a2']),
    });
    let saved = JSON.parse(mockWriteFile.mock.calls.at(-1)![1] as string);
    expect(saved.labels.label.type).toBe('enum');

    await updateAutoDiscoveredSchema({
      functions: [{ name: 'api', labels: ['label'] }],
      labels: set(many(12, i => `user-abc${i}`)),
    });
    saved = JSON.parse(mockWriteFile.mock.calls.at(-1)![1] as string);
    expect(saved.labels.label.type).toBe('identifier');
    expect(saved.labels.label.values).toBeUndefined();
    expect(saved.labels.label.sampleValues).toHaveLength(10);
  });
});
