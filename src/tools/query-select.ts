/**
 * firestore_query_select - Universal SQL-style query with optional field projection
 * Maps to SQL: SELECT fields FROM collection WHERE conditions ORDER BY fields LIMIT n
 */

import admin from 'firebase-admin';
import { getFirestore } from '../shared/firebase.js';
import { validateQuery, isIndexLoaderInitialized } from '../shared/index-loader.js';
import { serializeDocument, autoSerializeFirestoreTypes } from '../shared/type-serializer.js';
import { getConfig, isInitialized } from '../shared/config-loader.js';
import { matchPath } from '../shared/path-matcher.js';
import { trackDocumentAccess } from '../shared/resource-discovery.js';

export interface FirestoreQuerySelectInput {
  collection: string;
  fields?: string[]; // Optional - if omitted, returns all fields (SELECT *)
  where?: Array<{
    field: string;
    operator: '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'not-in' | 'array-contains' | 'array-contains-any' | 'LIKE';
    value: unknown;
  }>;
  orderBy?: Array<{
    field: string;
    direction?: 'asc' | 'desc';
  }>;
  limit?: number;
  scanLimit?: number; // Max docs to scan for LIKE or missing-index fallback (default: 1000, max: 5000)
}

export interface FirestoreQuerySelectOutput {
  collection: string;
  documentCount: number;
  indexCheck?: {
    valid: boolean;
    requiresIndex: boolean;
    suggestion?: string;
  };
  scanRequired?: {
    reason: string;
    docsToScan: number;
    scanLimit: number;
    maxLimit: number;
    message: string;
  };
  documents: Array<{
    id: string;
    path: string;
    data: Record<string, unknown>;
  }>;
}

/**
 * Query Firestore collection with optional field projection
 * SQL equivalent: SELECT fields FROM collection WHERE ... ORDER BY ... LIMIT n
 */
export async function firestoreQuerySelect(
  input: FirestoreQuerySelectInput
): Promise<FirestoreQuerySelectOutput> {
  const { collection, fields, where = [], orderBy = [], limit, scanLimit = 1000 } = input;

  const db = await getFirestore();
  const MAX_SCAN_LIMIT = 5000;
  const effectiveScanLimit = Math.min(scanLimit, MAX_SCAN_LIMIT);

  // Separate LIKE clauses from native Firestore clauses
  const likeClauses = where.filter(w => w.operator === 'LIKE');
  const nativeClauses = where.filter(w => w.operator !== 'LIKE');

  // Determine if we need client-side scan
  let needsScan = false;
  let scanReason: string | undefined;
  let indexCheck;

  // Reason 1: LIKE operator requires client-side filtering
  if (likeClauses.length > 0) {
    needsScan = true;
    scanReason = 'LIKE operator requires client-side filtering';
  }

  // Reason 2: Missing index (only check if no LIKE - avoid double validation)
  if (!needsScan && isIndexLoaderInitialized()) {
    const whereFields = nativeClauses.map(w => w.field);
    const orderByFields = orderBy.map(o => o.field);

    indexCheck = validateQuery(collection, orderByFields, whereFields);

    if (!indexCheck.valid) {
      needsScan = true;
      scanReason = indexCheck.suggestion || 'Missing Firestore index - falling back to client-side scan';
    }
  }

  // Handle scan-required path
  if (needsScan) {
    // Count documents in collection (cheap: 1 read)
    const countSnapshot = await db.collection(collection).count().get();
    const totalDocs = countSnapshot.data().count;

    // Check if scan limit exceeded
    if (totalDocs > effectiveScanLimit) {
      return {
        collection,
        documentCount: 0,
        scanRequired: {
          reason: scanReason!,
          docsToScan: totalDocs,
          scanLimit: effectiveScanLimit,
          maxLimit: MAX_SCAN_LIMIT,
          message: `Query requires scanning ${totalDocs} documents but scanLimit is ${effectiveScanLimit}. Increase scanLimit parameter to scan all (max: ${MAX_SCAN_LIMIT}).`,
        },
        documents: [],
      };
    }

    // Scan all documents and apply filters client-side
    const allDocsSnapshot = await db.collection(collection).get();
    let docs = allDocsSnapshot.docs;

    // Apply client-side filtering
    docs = docs.filter(doc => {
      const data = doc.data();

      // Apply native clauses
      for (const clause of nativeClauses) {
        if (!matchesWhereClause(data, clause)) {
          return false;
        }
      }

      // Apply LIKE clauses
      for (const clause of likeClauses) {
        if (!matchesLikeClause(data, clause)) {
          return false;
        }
      }

      return true;
    });

    // Apply client-side orderBy
    if (orderBy.length > 0) {
      docs.sort((a, b) => {
        for (const order of orderBy) {
          const aVal = getNestedValue(a.data(), order.field);
          const bVal = getNestedValue(b.data(), order.field);
          const direction = order.direction === 'desc' ? -1 : 1;

          if ((aVal as any) < (bVal as any)) return -1 * direction;
          if ((aVal as any) > (bVal as any)) return 1 * direction;
        }
        return 0;
      });
    }

    // Apply limit
    if (limit && limit > 0) {
      docs = docs.slice(0, limit);
    }

    // Process documents (same as native path)
    const documents = await processDocuments(docs, collection, fields);

    return {
      collection,
      documentCount: documents.length,
      indexCheck,
      documents,
    };
  }

  // Native Firestore query path (no scan needed)
  let query: admin.firestore.Query = db.collection(collection);

  // Apply where clauses
  for (const clause of nativeClauses) {
    query = query.where(clause.field, clause.operator as admin.firestore.WhereFilterOp, clause.value);
  }

  // Apply orderBy
  for (const order of orderBy) {
    query = query.orderBy(order.field, order.direction || 'asc');
  }

  // Apply limit
  if (limit && limit > 0) {
    query = query.limit(limit);
  }

  // Execute query
  const snapshot = await query.get();

  // Process documents
  const documents = await processDocuments(snapshot.docs, collection, fields);

  return {
    collection,
    documentCount: documents.length,
    indexCheck,
    documents,
  };
}

/**
 * Process document snapshots into output format
 */
async function processDocuments(
  docs: admin.firestore.QueryDocumentSnapshot[],
  collection: string,
  fields?: string[]
): Promise<Array<{ id: string; path: string; data: Record<string, unknown> }>> {
  // Try to match schema for serialization
  let timestampFields: string[] | undefined;

  if (isInitialized()) {
    const config = getConfig();
    const samplePath = collection + (docs.length > 0 ? `/${docs[0].id}` : '/sample');
    const match = matchPath(samplePath, config);

    if (match.matched) {
      timestampFields = match.definition?.timestampFields;
    }
  }

  return docs.map(doc => {
    let data = doc.data() as Record<string, unknown>;

    // Serialize timestamps
    if (timestampFields) {
      data = serializeDocument(data, timestampFields) as Record<string, unknown>;
    } else {
      data = autoSerializeFirestoreTypes(data) as Record<string, unknown>;
    }

    // Apply field projection if specified (like SQL SELECT specific columns)
    if (fields && fields.length > 0) {
      const projected: Record<string, unknown> = {};
      for (const field of fields) {
        if (field in data) {
          projected[field] = data[field];
        }
      }
      data = projected;
    }

    // Track document access for MRU cache
    trackDocumentAccess(doc.ref.path);

    return {
      id: doc.id,
      path: doc.ref.path,
      data,
    };
  });
}

/**
 * Check if document data matches a WHERE clause (client-side)
 */
function matchesWhereClause(
  data: admin.firestore.DocumentData,
  clause: { field: string; operator: string; value: unknown }
): boolean {
  const fieldValue = getNestedValue(data, clause.field);

  switch (clause.operator) {
    case '==':
      return fieldValue === clause.value;
    case '!=':
      return fieldValue !== clause.value;
    case '<':
      return (fieldValue as any) < (clause.value as any);
    case '<=':
      return (fieldValue as any) <= (clause.value as any);
    case '>':
      return (fieldValue as any) > (clause.value as any);
    case '>=':
      return (fieldValue as any) >= (clause.value as any);
    case 'in':
      return Array.isArray(clause.value) && clause.value.includes(fieldValue);
    case 'not-in':
      return Array.isArray(clause.value) && !clause.value.includes(fieldValue);
    case 'array-contains':
      return Array.isArray(fieldValue) && fieldValue.includes(clause.value);
    case 'array-contains-any':
      return (
        Array.isArray(fieldValue) &&
        Array.isArray(clause.value) &&
        clause.value.some(v => fieldValue.includes(v))
      );
    default:
      return false;
  }
}

/**
 * Check if document data matches a LIKE clause (client-side)
 */
function matchesLikeClause(
  data: admin.firestore.DocumentData,
  clause: { field: string; value: unknown }
): boolean {
  const fieldValue = getNestedValue(data, clause.field);

  if (typeof fieldValue !== 'string' || typeof clause.value !== 'string') {
    return false;
  }

  // Convert SQL LIKE pattern to regex
  // % -> .* (any characters)
  // _ -> . (single character)
  const pattern = clause.value
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
    .replace(/%/g, '.*') // % -> .*
    .replace(/_/g, '.'); // _ -> .

  const regex = new RegExp(`^${pattern}$`, 'i'); // Case-insensitive
  return regex.test(fieldValue);
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current && typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * MCP tool definition for firestore_query_select
 */
export const firestoreQuerySelectTool = {
  name: 'firestore_query_select',
  description:
    'SQL-style query with optional field projection. Maps to: SELECT fields FROM collection WHERE conditions ORDER BY fields LIMIT n. Supports LIKE operator for case-insensitive pattern matching. Automatically falls back to client-side scan when LIKE used or index missing. If unsure which collection to query, call firestore_show_collections first to see available collections. Omit "fields" to return all fields (SELECT *). Include "fields" for context savings (SELECT specific columns).',
  inputSchema: {
    type: 'object',
    properties: {
      collection: {
        type: 'string',
        description: 'Collection path (e.g., "users" or "organizations/org-1/products")',
      },
      fields: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional: Specific fields to return (like SQL SELECT columns). Omit for all fields (SELECT *).',
      },
      where: {
        type: 'array',
        description: 'WHERE clauses for filtering. Supports LIKE for pattern matching (e.g., "name LIKE %john%").',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string', description: 'Field name' },
            operator: {
              type: 'string',
              enum: ['==', '!=', '<', '<=', '>', '>=', 'in', 'not-in', 'array-contains', 'array-contains-any', 'LIKE'],
              description: 'Comparison operator. LIKE supports SQL wildcards: % (any chars), _ (single char). Case-insensitive.',
            },
            value: { description: 'Value to compare against. For LIKE: use % and _ wildcards (e.g., "%john%", "test_")' },
          },
          required: ['field', 'operator', 'value'],
        },
      },
      orderBy: {
        type: 'array',
        description: 'ORDER BY fields',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string', description: 'Field to sort by' },
            direction: {
              type: 'string',
              enum: ['asc', 'desc'],
              description: 'Sort direction (default: asc)',
              default: 'asc',
            },
          },
          required: ['field'],
        },
      },
      limit: {
        type: 'number',
        description: 'LIMIT: Maximum number of documents to return',
      },
      scanLimit: {
        type: 'number',
        description: 'Maximum documents to scan when LIKE operator used or index missing (default: 1000, max: 5000). Increase if user requests broader search and collection size exceeds limit.',
        default: 1000,
      },
    },
    required: ['collection'],
  },
};
