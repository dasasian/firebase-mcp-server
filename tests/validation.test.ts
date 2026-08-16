import { describe, it, expect } from 'vitest';
import { validateDocument, formatValidationResult } from '../src/shared/validation.js';

const schema: any = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string' },
    age: { type: 'number' },
    beta: { type: 'string', 'x-status': 'experimental' },
    old: { type: 'string', 'x-status': 'legacy' },
    opt: { type: 'string', 'x-status': 'optional' },
  },
};

describe('validateDocument — validity & required', () => {
  it('accepts a valid document (warn mode) and lists official fields', () => {
    const r = validateDocument({ name: 'Ada', age: 30 }, schema);
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
    expect(r.fieldBreakdown.official).toEqual(expect.arrayContaining(['name', 'age']));
  });

  it('flags a missing required field as a fatal error in every mode', () => {
    for (const mode of ['warn', 'strict', 'permissive'] as const) {
      const r = validateDocument({ age: 30 }, schema, mode);
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => /required/i.test(e.message))).toBe(true);
    }
  });
});

describe('validateDocument — unknown fields', () => {
  it('warns in warn mode (still valid)', () => {
    const r = validateDocument({ name: 'Ada', extra: 1 }, schema, 'warn');
    expect(r.valid).toBe(true);
    expect(r.fieldBreakdown.unknown).toContain('extra');
    expect(r.warnings.some((w) => w.field === 'extra')).toBe(true);
  });

  it('errors in strict mode', () => {
    const r = validateDocument({ name: 'Ada', extra: 1 }, schema, 'strict');
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === 'extra')).toBe(true);
  });
});

describe('validateDocument — field status', () => {
  it('experimental: warns in warn mode, silent in permissive, always in breakdown', () => {
    expect(validateDocument({ name: 'a', beta: 'x' }, schema, 'warn').warnings.some((w) => w.type === 'experimental')).toBe(true);
    const perm = validateDocument({ name: 'a', beta: 'x' }, schema, 'permissive');
    expect(perm.warnings.some((w) => w.type === 'experimental')).toBe(false);
    expect(perm.fieldBreakdown.experimental).toContain('beta');
  });

  it('legacy: warns in warn mode, errors in strict mode', () => {
    expect(validateDocument({ name: 'a', old: 'x' }, schema, 'warn').warnings.some((w) => w.type === 'legacy')).toBe(true);
    const strict = validateDocument({ name: 'a', old: 'x' }, schema, 'strict');
    expect(strict.valid).toBe(false);
    expect(strict.fieldBreakdown.legacy).toContain('old');
  });

  it('optional status counts as official with no warning', () => {
    const r = validateDocument({ name: 'a', opt: 'x' }, schema, 'warn');
    expect(r.fieldBreakdown.official).toContain('opt');
    expect(r.warnings.some((w) => w.field === 'opt')).toBe(false);
  });
});

describe('validateDocument — type errors by mode', () => {
  it('a type mismatch is a warning in warn mode but an error in strict mode', () => {
    const warn = validateDocument({ name: 123 as any }, schema, 'warn');
    expect(warn.valid).toBe(true);
    expect(warn.warnings.some((w) => w.field === 'name')).toBe(true);

    const strict = validateDocument({ name: 123 as any }, schema, 'strict');
    expect(strict.valid).toBe(false);
    expect(strict.errors.some((e) => e.field === 'name')).toBe(true);
  });
});

describe('formatValidationResult', () => {
  it('renders a valid result', () => {
    const out = formatValidationResult(validateDocument({ name: 'a' }, schema));
    expect(out).toContain('✅ Valid');
  });
  it('renders an invalid result with the error count', () => {
    const out = formatValidationResult(validateDocument({ age: 1 }, schema, 'strict'));
    expect(out).toContain('❌ Invalid');
  });
});
