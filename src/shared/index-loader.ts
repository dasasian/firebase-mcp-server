/**
 * Firestore index loader and query validator
 * Loads firestore.indexes.json and validates queries against composite indexes
 */

import { readFile } from 'fs/promises';

interface FirestoreIndex {
  collectionGroup: string;
  queryScope: 'COLLECTION' | 'COLLECTION_GROUP';
  fields: Array<{
    fieldPath: string;
    order?: 'ASCENDING' | 'DESCENDING';
    arrayConfig?: 'CONTAINS';
  }>;
}

interface IndexConfig {
  indexes: FirestoreIndex[];
  fieldOverrides?: unknown[];
}

let indexConfig: IndexConfig | null = null;
let indexPath: string | null = null;

/**
 * Initialize index loader
 */
export async function initializeIndexLoader(path: string): Promise<void> {
  indexPath = path;
  await reloadIndexes();
}

/**
 * Reload indexes from disk
 */
async function reloadIndexes(): Promise<void> {
  if (!indexPath) {
    return;
  }

  try {
    const content = await readFile(indexPath, 'utf-8');
    indexConfig = JSON.parse(content) as IndexConfig;
    console.error(`[Indexes] Loaded ${indexConfig.indexes.length} composite indexes`);
  } catch (error) {
    console.warn('[Indexes] No index file found or failed to load:', error);
    indexConfig = { indexes: [] };
  }
}

/**
 * Validate query against available indexes
 */
export function validateQuery(
  collectionPath: string,
  orderByFields: string[],
  whereFields: string[]
): {
  valid: boolean;
  requiresIndex: boolean;
  suggestion?: string;
} {
  // No index config loaded - assume valid (permissive mode)
  if (!indexConfig) {
    return { valid: true, requiresIndex: false };
  }

  // Simple queries don't need composite indexes
  if (orderByFields.length <= 1 && whereFields.length <= 1) {
    return { valid: true, requiresIndex: false };
  }

  // Extract collection name from path
  const pathSegments = collectionPath.split('/');
  const collectionName = pathSegments[pathSegments.length - 1];

  // Check if a matching composite index exists
  const matchingIndex = indexConfig.indexes.find(index => {
    if (index.collectionGroup !== collectionName) {
      return false;
    }

    // Check if index covers all required fields
    const indexFields = index.fields.map(f => f.fieldPath);
    const requiredFields = [...new Set([...whereFields, ...orderByFields])];

    return requiredFields.every(field => indexFields.includes(field));
  });

  if (matchingIndex) {
    return { valid: true, requiresIndex: true };
  }

  // No matching index - suggest creating one
  const suggestion = generateIndexSuggestion(
    collectionName,
    whereFields,
    orderByFields
  );

  return {
    valid: false,
    requiresIndex: true,
    suggestion,
  };
}

/**
 * Generate index suggestion JSON
 */
function generateIndexSuggestion(
  collectionName: string,
  whereFields: string[],
  orderByFields: string[]
): string {
  const fields = [
    ...whereFields.map(field => ({
      fieldPath: field,
      order: 'ASCENDING' as const,
    })),
    ...orderByFields.map(field => ({
      fieldPath: field,
      order: 'DESCENDING' as const,
    })),
  ];

  const indexDefinition = {
    collectionGroup: collectionName,
    queryScope: 'COLLECTION',
    fields,
  };

  return `Add this to firestore.indexes.json:\n\n${JSON.stringify(
    indexDefinition,
    null,
    2
  )}`;
}

/**
 * Check if index loader is initialized
 */
export function isIndexLoaderInitialized(): boolean {
  return indexConfig !== null;
}
