import { describe, it, expect } from 'vitest';
import { parseServerArgs } from '../src/shared/cli-args.js';

describe('parseServerArgs — positional arguments', () => {
  it('returns nothing for an empty command line', () => {
    expect(parseServerArgs([])).toEqual({ positional: [], toolsSpec: undefined });
  });

  it('reads the schema and index paths in order', () => {
    expect(parseServerArgs(['schemas.json', 'indexes.json']).positional).toEqual([
      'schemas.json',
      'indexes.json',
    ]);
  });
});

describe('parseServerArgs — the --tools flag', () => {
  it('reads the equals form', () => {
    expect(parseServerArgs(['--tools=firestore']).toolsSpec).toBe('firestore');
  });

  it('reads the space-separated form', () => {
    expect(parseServerArgs(['--tools', 'firestore']).toolsSpec).toBe('firestore');
  });

  it('does not leave the space-separated value in the positionals', () => {
    // This was the bug: "firestore" became the schema config path.
    const { positional, toolsSpec } = parseServerArgs([
      'schemas.json',
      '--tools',
      'firestore',
    ]);
    expect(toolsSpec).toBe('firestore');
    expect(positional).toEqual(['schemas.json']);
  });

  it('keeps positionals in order when the flag comes first', () => {
    const { positional, toolsSpec } = parseServerArgs([
      '--tools',
      'firestore,auth',
      'schemas.json',
      'indexes.json',
    ]);
    expect(toolsSpec).toBe('firestore,auth');
    expect(positional).toEqual(['schemas.json', 'indexes.json']);
  });

  it('reads a comma-separated list in either form', () => {
    expect(parseServerArgs(['--tools=firestore,auth']).toolsSpec).toBe('firestore,auth');
    expect(parseServerArgs(['--tools', 'firestore,auth']).toolsSpec).toBe('firestore,auth');
  });

  it('treats an empty equals form as an empty spec', () => {
    expect(parseServerArgs(['--tools=']).toolsSpec).toBe('');
  });

  it('treats a trailing bare flag as an empty spec, not a swallowed path', () => {
    const { positional, toolsSpec } = parseServerArgs(['schemas.json', '--tools']);
    expect(toolsSpec).toBe('');
    expect(positional).toEqual(['schemas.json']);
  });

  it('does not swallow a following flag as the value', () => {
    const { toolsSpec, positional } = parseServerArgs(['--tools', '--other', 'schemas.json']);
    expect(toolsSpec).toBe('');
    expect(positional).toEqual(['schemas.json']);
  });

  it('lets a later --tools win over an earlier one', () => {
    expect(parseServerArgs(['--tools=auth', '--tools=storage']).toolsSpec).toBe('storage');
  });

  it('reports undefined when the flag is absent, so the env var can apply', () => {
    expect(parseServerArgs(['schemas.json']).toolsSpec).toBeUndefined();
  });
});

describe('parseServerArgs — unrecognised flags', () => {
  it('ignores them rather than reading them as paths', () => {
    const { positional, toolsSpec } = parseServerArgs(['--verbose', 'schemas.json']);
    expect(positional).toEqual(['schemas.json']);
    expect(toolsSpec).toBeUndefined();
  });

  it('does not treat an unknown flag value as a positional either', () => {
    // A future "--log=debug" must not become the schema path.
    expect(parseServerArgs(['--log=debug']).positional).toEqual([]);
  });
});
