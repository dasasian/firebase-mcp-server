/**
 * Deep diff algorithm for import dry-run mode
 * Compares existing Firestore data with incoming import data
 */

import type { DiffResult } from './types.js';

/**
 * Calculate diff between existing and new data
 *
 * @param existing - Current document data from Firestore (or null if new document)
 * @param incoming - New data to be imported
 * @returns Diff result showing added, removed, and modified fields
 */
export function calculateDiff(
  existing: Record<string, unknown> | null,
  incoming: Record<string, unknown>
): DiffResult {
  const added: Record<string, unknown> = {};
  const removed: Record<string, unknown> = {};
  const modified: Array<{
    field: string;
    oldValue: unknown;
    newValue: unknown;
  }> = [];

  // New document - everything is added
  if (!existing) {
    return {
      added: incoming,
      removed: {},
      modified: [],
    };
  }

  // Find added and modified fields
  for (const [key, newValue] of Object.entries(incoming)) {
    if (!(key in existing)) {
      // Field exists in incoming but not in existing
      added[key] = newValue;
    } else {
      const oldValue = existing[key];

      if (!deepEqual(oldValue, newValue)) {
        // Field exists in both but values differ
        modified.push({
          field: key,
          oldValue,
          newValue,
        });
      }
    }
  }

  // Find removed fields
  for (const [key, oldValue] of Object.entries(existing)) {
    if (!(key in incoming)) {
      removed[key] = oldValue;
    }
  }

  return { added, removed, modified };
}

/**
 * Deep equality check for two values
 */
function deepEqual(a: unknown, b: unknown): boolean {
  // Same reference
  if (a === b) return true;

  // Both null/undefined
  if (a == null || b == null) return a === b;

  // Different types
  if (typeof a !== typeof b) return false;

  // Arrays
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }

  // Objects
  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;

    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);

    if (aKeys.length !== bKeys.length) return false;

    return aKeys.every(key => deepEqual(aObj[key], bObj[key]));
  }

  // Primitives
  return false;
}

/**
 * Format diff result as human-readable text
 */
export function formatDiff(diff: DiffResult, documentPath: string): string {
  const lines: string[] = [];

  lines.push(`Diff for ${documentPath}:`);

  // Added fields
  if (Object.keys(diff.added).length > 0) {
    lines.push('\n➕ Added fields:');
    for (const [key, value] of Object.entries(diff.added)) {
      lines.push(`  + ${key}: ${JSON.stringify(value)}`);
    }
  }

  // Removed fields
  if (Object.keys(diff.removed).length > 0) {
    lines.push('\n➖ Removed fields:');
    for (const [key, value] of Object.entries(diff.removed)) {
      lines.push(`  - ${key}: ${JSON.stringify(value)}`);
    }
  }

  // Modified fields
  if (diff.modified.length > 0) {
    lines.push('\n✏️  Modified fields:');
    for (const { field, oldValue, newValue } of diff.modified) {
      lines.push(`  ~ ${field}:`);
      lines.push(`    - ${JSON.stringify(oldValue)}`);
      lines.push(`    + ${JSON.stringify(newValue)}`);
    }
  }

  // No changes
  if (
    Object.keys(diff.added).length === 0 &&
    Object.keys(diff.removed).length === 0 &&
    diff.modified.length === 0
  ) {
    lines.push('\n✅ No changes');
  }

  return lines.join('\n');
}

/**
 * Check if diff represents any actual changes
 */
export function hasChanges(diff: DiffResult): boolean {
  return (
    Object.keys(diff.added).length > 0 ||
    Object.keys(diff.removed).length > 0 ||
    diff.modified.length > 0
  );
}
