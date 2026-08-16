import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';
import {
  TOOL_ENTRIES,
  TOOL_DEFINITIONS,
  getToolEntry,
  validateToolArgs,
} from '../src/tools/registry.js';

const ajv = new Ajv({ strict: false, allErrors: true });

const names = TOOL_DEFINITIONS.map(t => t.name);

/** Tools that write. Everything else must be read-only. */
const WRITERS = [
  'firestore_import',
  'firestore_update',
  'firestore_delete',
  'firebase_auth_create_user',
  'firebase_auth_update_user',
  'firebase_auth_delete_user',
  'firebase_auth_revoke_sessions',
  'firebase_storage_read', // downloads to a local temp file
  'firebase_storage_upload',
  'firebase_storage_rm',
  'firebase_storage_cp',
  'firebase_storage_mv',
  'firebase_storage_sync',
  'firebase_storage_push',
  'firebase_storage_set_access',
  'firebase_functions_logs', // updates the auto-discovered logging schema
];

/** Writes that cannot be trivially undone. */
const DESTRUCTIVE = [
  'firestore_import',
  'firestore_update',
  'firestore_delete',
  'firebase_auth_update_user',
  'firebase_auth_delete_user',
  'firebase_auth_revoke_sessions',
  'firebase_storage_upload',
  'firebase_storage_rm',
  'firebase_storage_cp',
  'firebase_storage_mv',
  'firebase_storage_sync',
  'firebase_storage_push',
  'firebase_storage_set_access',
];

describe('the table itself', () => {
  it('exposes 33 tools', () => {
    expect(TOOL_ENTRIES).toHaveLength(33);
  });

  it('has no duplicate names', () => {
    expect(new Set(names).size).toBe(names.length);
  });

  it('lists definitions in the same order as the entries', () => {
    expect(TOOL_DEFINITIONS.map(t => t.name)).toEqual(TOOL_ENTRIES.map(e => e.tool.name));
  });

  it('keeps a stable order across reads, so clients can cache tools/list', () => {
    expect(TOOL_DEFINITIONS.map(t => t.name)).toEqual(names);
  });

  it('gives every tool a name, a description, and a handler', () => {
    for (const entry of TOOL_ENTRIES) {
      expect(entry.tool.name, entry.tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(entry.tool.description.length, entry.tool.name).toBeGreaterThan(20);
      expect(typeof entry.run, entry.tool.name).toBe('function');
    }
  });
});

describe('getToolEntry', () => {
  it('finds every advertised tool', () => {
    for (const name of names) {
      expect(getToolEntry(name)?.tool.name, name).toBe(name);
    }
  });

  it('returns undefined for an unknown name', () => {
    expect(getToolEntry('firestore_nope')).toBeUndefined();
  });
});

describe('annotations', () => {
  it('are present on every tool', () => {
    for (const { tool } of TOOL_ENTRIES) {
      expect(tool.annotations, tool.name).toBeDefined();
    }
  });

  it('give every tool a human-readable title', () => {
    for (const { tool } of TOOL_ENTRIES) {
      expect(tool.annotations!.title.length, tool.name).toBeGreaterThan(2);
    }
  });

  it('mark exactly the writing tools as not read-only', () => {
    const notReadOnly = TOOL_ENTRIES.filter(e => !e.tool.annotations!.readOnlyHint).map(
      e => e.tool.name
    );
    expect(notReadOnly.sort()).toEqual([...WRITERS].sort());
  });

  it('mark exactly the irreversible writes as destructive', () => {
    const destructive = TOOL_ENTRIES.filter(e => e.tool.annotations!.destructiveHint).map(
      e => e.tool.name
    );
    expect(destructive.sort()).toEqual([...DESTRUCTIVE].sort());
  });

  it('declare destructive and idempotent hints on every writing tool', () => {
    for (const { tool } of TOOL_ENTRIES) {
      if (tool.annotations!.readOnlyHint) continue;
      expect(typeof tool.annotations!.destructiveHint, tool.name).toBe('boolean');
      expect(typeof tool.annotations!.idempotentHint, tool.name).toBe('boolean');
    }
  });

  it('omit the write-only hints on read-only tools, where they mean nothing', () => {
    for (const { tool } of TOOL_ENTRIES) {
      if (!tool.annotations!.readOnlyHint) continue;
      expect(tool.annotations!.destructiveHint, tool.name).toBeUndefined();
      expect(tool.annotations!.idempotentHint, tool.name).toBeUndefined();
    }
  });

  it('treat every tool as a closed domain — one known Firebase project', () => {
    for (const { tool } of TOOL_ENTRIES) {
      expect(tool.annotations!.openWorldHint, tool.name).toBe(false);
    }
  });

  it('does not mark a repeated move as idempotent — the source is gone', () => {
    expect(getToolEntry('firebase_storage_mv')!.tool.annotations!.idempotentHint).toBe(false);
  });

  it('does not mark creating a user as idempotent', () => {
    expect(getToolEntry('firebase_auth_create_user')!.tool.annotations!.idempotentHint).toBe(false);
  });
});

describe('schemas', () => {
  it('gives every tool an object inputSchema that compiles', () => {
    for (const { tool } of TOOL_ENTRIES) {
      expect(tool.inputSchema.type, tool.name).toBe('object');
      expect(() => ajv.compile(tool.inputSchema), tool.name).not.toThrow();
    }
  });

  it('gives every tool an object outputSchema that compiles', () => {
    for (const { tool } of TOOL_ENTRIES) {
      expect(tool.outputSchema, tool.name).toBeDefined();
      expect(tool.outputSchema!.type, tool.name).toBe('object');
      expect(() => ajv.compile(tool.outputSchema!), tool.name).not.toThrow();
    }
  });

  it('keeps output schemas permissive, so extra fields never fail a client', () => {
    for (const { tool } of TOOL_ENTRIES) {
      expect(tool.outputSchema!.additionalProperties, tool.name).not.toBe(false);
    }
  });
});

describe('validateToolArgs', () => {
  const del = getToolEntry('firestore_delete')!;
  const read = getToolEntry('firestore_read')!;

  it('accepts valid arguments', () => {
    expect(validateToolArgs(del, { collection: 'users', id: 'u1' })).toBeNull();
  });

  it('rejects a wrong type and names the field', () => {
    const problem = validateToolArgs(del, { collection: 42 });
    expect(problem).toContain('firestore_delete');
    expect(problem).toContain('collection');
  });

  it('rejects a value outside an enum', () => {
    const problem = validateToolArgs(del, {
      collection: 'users',
      where: [{ field: 'age', operator: 'LIKE', value: 1 }],
    });
    expect(problem).toContain('operator');
  });

  it('rejects a missing required field', () => {
    expect(validateToolArgs(read, {})).toContain('path');
  });

  it('accepts unknown extra fields rather than failing the call', () => {
    expect(validateToolArgs(read, { path: 'users/u1', somethingNew: true })).toBeNull();
  });

  it('validates every tool against empty arguments without crashing', () => {
    for (const entry of TOOL_ENTRIES) {
      expect(() => validateToolArgs(entry, {}), entry.tool.name).not.toThrow();
    }
  });

  it('reuses a compiled validator on repeat calls', () => {
    expect(validateToolArgs(read, { path: 'users/u1' })).toBeNull();
    expect(validateToolArgs(read, { path: 'users/u1' })).toBeNull();
  });
});
