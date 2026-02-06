/**
 * firestore_update - SQL-style multi-field update
 * Maps to SQL: UPDATE document SET field1=value1, field2=value2, ...
 *           or UPDATE collection SET field1=value1 WHERE conditions
 */

import admin from 'firebase-admin';
import { getFirestore } from '../shared/firebase.js';
import { trackDocumentAccess } from '../shared/resource-discovery.js';

export interface FirestoreUpdateInput {
  path?: string; // Single document: 'users/user-123'
  collection?: string; // Batch update: 'users'
  where?: Array<{
    field: string;
    operator: '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'not-in' | 'array-contains' | 'array-contains-any';
    value: unknown;
  }>; // WHERE clauses for batch update
  set: Record<string, unknown>; // SQL-style SET clause
  dryRun?: boolean; // Preview mode: returns what would be updated without updating
  limit?: number; // Batch safety: max documents to update (default: 100, max: 500)
}

export interface FirestoreUpdateOutput {
  path?: string; // Single document updates
  collection?: string; // Batch updates
  updatedCount: number;
  updatedPaths: string[];
  dryRun?: boolean;
  wouldUpdate?: string[]; // For dryRun: what would be updated
  fieldsUpdated?: string[];
  error?: string;
}

/**
 * Update multiple fields in document(s)
 * SQL equivalent: UPDATE path SET field1=value1, field2=value2 (single)
 *              or UPDATE collection SET field1=value1 WHERE conditions (batch)
 */
export async function firestoreUpdate(
  input: FirestoreUpdateInput
): Promise<FirestoreUpdateOutput> {
  const { path, collection, where, set, dryRun = false, limit } = input;

  // Validate: require either path OR collection
  if (!path && !collection) {
    return {
      updatedCount: 0,
      updatedPaths: [],
      error: "Must provide either 'path' for single update or 'collection' for batch update",
    };
  }

  // Validate: cannot provide both path AND collection
  if (path && collection) {
    return {
      updatedCount: 0,
      updatedPaths: [],
      error: "Cannot provide both 'path' and 'collection'. Use 'path' for single document update or 'collection' for batch update.",
    };
  }

  const db = await getFirestore();

  try {
    // SINGLE DOCUMENT UPDATE
    if (path) {
      const docRef = db.doc(path);

      // Check if document exists
      const doc = await docRef.get();
      if (!doc.exists) {
        return {
          path,
          updatedCount: 0,
          updatedPaths: [],
          fieldsUpdated: [],
          error: `Document not found: ${path}`,
        };
      }

      // Track before update (for MRU cache)
      trackDocumentAccess(path);

      // Dry run mode
      if (dryRun) {
        return {
          path,
          updatedCount: 0,
          updatedPaths: [],
          dryRun: true,
          wouldUpdate: [path],
          fieldsUpdated: Object.keys(set),
        };
      }

      // Perform update (Firestore supports partial updates)
      await docRef.update(set);

      return {
        path,
        updatedCount: 1,
        updatedPaths: [path],
        fieldsUpdated: Object.keys(set),
      };
    }

    // BATCH UPDATE WITH WHERE
    const effectiveLimit = Math.min(limit || 100, 500);

    // Build query
    let query: admin.firestore.Query = db.collection(collection!);

    if (where && where.length > 0) {
      for (const clause of where) {
        query = query.where(clause.field, clause.operator, clause.value);
      }
    }

    query = query.limit(effectiveLimit);

    // Execute query
    const snapshot = await query.get();
    const paths = snapshot.docs.map(doc => doc.ref.path);

    // Dry run mode
    if (dryRun) {
      return {
        collection,
        updatedCount: 0,
        updatedPaths: [],
        dryRun: true,
        wouldUpdate: paths,
        fieldsUpdated: Object.keys(set),
      };
    }

    // No documents to update
    if (paths.length === 0) {
      return {
        collection,
        updatedCount: 0,
        updatedPaths: [],
        fieldsUpdated: Object.keys(set),
      };
    }

    // Batch update using WriteBatch
    const batch = db.batch();
    snapshot.docs.forEach(doc => {
      batch.update(doc.ref, set);
    });
    await batch.commit();

    return {
      collection,
      updatedCount: paths.length,
      updatedPaths: paths,
      fieldsUpdated: Object.keys(set),
    };
  } catch (error) {
    return {
      updatedCount: 0,
      updatedPaths: [],
      fieldsUpdated: [],
      error: `Update failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * MCP tool definition for firestore_update
 */
export const firestoreUpdateTool = {
  name: 'firestore_update',
  description:
    'SQL-style update for one or more fields. Maps to: UPDATE path SET field1=value1, field2=value2 (single) or UPDATE collection SET field1=value1 WHERE conditions (batch). Supports dryRun for preview. Safety: enforces limits (default: 100, max: 500).',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Document path for single update (e.g., "users/user-123"). Provide path OR collection, not both.',
      },
      collection: {
        type: 'string',
        description: 'Collection path for batch update (e.g., "users"). Provide path OR collection, not both.',
      },
      where: {
        type: 'array',
        description: 'WHERE clauses for batch update. Provide collection when using where.',
        items: {
          type: 'object',
          properties: {
            field: {
              type: 'string',
              description: 'Field name to filter on',
            },
            operator: {
              type: 'string',
              enum: ['==', '!=', '<', '<=', '>', '>=', 'in', 'not-in', 'array-contains', 'array-contains-any'],
              description: 'Comparison operator',
            },
            value: {
              description: 'Value to compare against',
            },
          },
          required: ['field', 'operator', 'value'],
        },
      },
      set: {
        type: 'object',
        description: 'Fields to update (SQL SET clause). Example: {"email": "new@email.com", "name": "New Name", "status": "active"}',
      },
      dryRun: {
        type: 'boolean',
        description: 'Preview mode: returns what would be updated without actually updating (default: false)',
        default: false,
      },
      limit: {
        type: 'number',
        description: 'Max documents to update in batch operation (default: 100, max: 500). Prevents accidental mass updates.',
        default: 100,
      },
    },
    required: ['set'],
  },
};
