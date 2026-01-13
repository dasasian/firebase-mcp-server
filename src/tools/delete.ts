/**
 * firestore_delete - SQL-style document deletion
 * Maps to SQL: DELETE FROM collection WHERE conditions
 */

import admin from 'firebase-admin';
import { getFirestore } from '../shared/firebase.js';
import { trackDocumentAccess } from '../shared/resource-discovery.js';

export interface FirestoreDeleteInput {
  collection: string;
  id?: string; // Single document delete: DELETE FROM users WHERE id='user-123'
  where?: Array<{
    field: string;
    operator: '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'not-in' | 'array-contains' | 'array-contains-any';
    value: unknown;
  }>;
  dryRun?: boolean; // Preview mode: returns what would be deleted without deleting
  limit?: number; // Batch safety: max documents to delete (default: 100, max: 500)
}

export interface FirestoreDeleteOutput {
  collection: string;
  deletedCount: number;
  deletedPaths: string[];
  dryRun?: boolean;
  wouldDelete?: string[]; // For dryRun: what would be deleted
  error?: string;
}

/**
 * Delete documents from Firestore
 * SQL equivalent: DELETE FROM collection WHERE conditions LIMIT n
 */
export async function firestoreDelete(
  input: FirestoreDeleteInput
): Promise<FirestoreDeleteOutput> {
  const { collection, id, where, dryRun = false, limit } = input;

  // Validate: require either id OR where
  if (!id && (!where || where.length === 0)) {
    return {
      collection,
      deletedCount: 0,
      deletedPaths: [],
      error: "Must provide either 'id' for single delete or 'where' for batch delete. Cannot delete entire collection.",
    };
  }

  // Validate: cannot provide both id AND where
  if (id && where && where.length > 0) {
    return {
      collection,
      deletedCount: 0,
      deletedPaths: [],
      error: "Cannot provide both 'id' and 'where'. Use 'id' for single document delete or 'where' for batch delete.",
    };
  }

  const db = await getFirestore();

  try {
    // SINGLE DOCUMENT DELETE
    if (id) {
      const path = `${collection}/${id}`;
      const docRef = db.doc(path);

      // Check if document exists
      const doc = await docRef.get();
      if (!doc.exists) {
        return {
          collection,
          deletedCount: 0,
          deletedPaths: [],
          error: `Document not found: ${path}`,
        };
      }

      // Track before deletion (for MRU cache)
      trackDocumentAccess(path);

      // Dry run mode
      if (dryRun) {
        return {
          collection,
          deletedCount: 0,
          deletedPaths: [],
          dryRun: true,
          wouldDelete: [path],
        };
      }

      // Execute delete
      await docRef.delete();

      return {
        collection,
        deletedCount: 1,
        deletedPaths: [path],
      };
    }

    // BATCH DELETE WITH WHERE
    const effectiveLimit = Math.min(limit || 100, 500);

    // Build query
    let query: admin.firestore.Query = db.collection(collection);

    for (const clause of where!) {
      query = query.where(clause.field, clause.operator, clause.value);
    }

    query = query.limit(effectiveLimit);

    // Execute query
    const snapshot = await query.get();
    const paths = snapshot.docs.map(doc => doc.ref.path);

    // Dry run mode
    if (dryRun) {
      return {
        collection,
        deletedCount: 0,
        deletedPaths: [],
        dryRun: true,
        wouldDelete: paths,
      };
    }

    // No documents to delete
    if (paths.length === 0) {
      return {
        collection,
        deletedCount: 0,
        deletedPaths: [],
      };
    }

    // Batch delete using WriteBatch
    const batch = db.batch();
    snapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    await batch.commit();

    return {
      collection,
      deletedCount: paths.length,
      deletedPaths: paths,
    };
  } catch (error) {
    return {
      collection,
      deletedCount: 0,
      deletedPaths: [],
      error: `Delete failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * MCP tool definition for firestore_delete
 */
export const firestoreDeleteTool = {
  name: 'firestore_delete',
  description:
    'SQL-style document deletion. DELETE FROM collection WHERE conditions. Supports single document (id) or batch delete (where). Safety: requires WHERE or id, enforces limits (default: 100, max: 500), supports dryRun for preview. Returns deleted document paths.',
  inputSchema: {
    type: 'object',
    properties: {
      collection: {
        type: 'string',
        description: 'Collection path (e.g., "users")',
      },
      id: {
        type: 'string',
        description: 'Document ID for single delete (e.g., "user-123"). Provide id OR where, not both.',
      },
      where: {
        type: 'array',
        description: 'WHERE clauses for batch delete. Provide id OR where, not both.',
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
      dryRun: {
        type: 'boolean',
        description: 'Preview mode: returns what would be deleted without actually deleting (default: false)',
        default: false,
      },
      limit: {
        type: 'number',
        description: 'Max documents to delete in batch operation (default: 100, max: 500). Prevents accidental mass deletions.',
        default: 100,
      },
    },
    required: ['collection'],
  },
};
