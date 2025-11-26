/**
 * firestore_query_collection_group - Query across all instances of a subcollection
 * Example: Query all "events" subcollections across all products and organizations
 */

import admin from 'firebase-admin';
import { getFirestore } from '../shared/firebase.js';
import { autoSerializeFirestoreTypes } from '../shared/type-serializer.js';
import { trackDocumentAccess } from '../shared/resource-discovery.js';

export interface FirestoreQueryCollectionGroupInput {
  collectionId: string;
  where?: Array<{
    field: string;
    operator: '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'not-in' | 'array-contains' | 'array-contains-any';
    value: unknown;
  }>;
  orderBy?: Array<{
    field: string;
    direction?: 'asc' | 'desc';
  }>;
  limit?: number;
}

export interface FirestoreQueryCollectionGroupOutput {
  collectionId: string;
  documentCount: number;
  documents: Array<{
    id: string;
    path: string;
    data: Record<string, unknown>;
  }>;
}

/**
 * Query collection group (all instances of a subcollection)
 */
export async function firestoreQueryCollectionGroup(
  input: FirestoreQueryCollectionGroupInput
): Promise<FirestoreQueryCollectionGroupOutput> {
  const { collectionId, where, orderBy, limit } = input;

  // Get Firestore instance
  const db = await getFirestore();

  // Build collection group query
  let query: admin.firestore.Query = db.collectionGroup(collectionId);

  // Apply where clauses
  if (where && where.length > 0) {
    for (const condition of where) {
      query = query.where(
        condition.field,
        condition.operator,
        condition.value
      );
    }
  }

  // Apply orderBy
  if (orderBy && orderBy.length > 0) {
    for (const order of orderBy) {
      query = query.orderBy(order.field, order.direction || 'asc');
    }
  }

  // Apply limit
  if (limit && limit > 0) {
    query = query.limit(limit);
  }

  // Execute query
  const snapshot = await query.get();

  // Process documents
  const documents = snapshot.docs.map(doc => {
    let data = doc.data() as Record<string, unknown>;

    // Auto-serialize Firestore types
    data = autoSerializeFirestoreTypes(data) as Record<string, unknown>;

    // Track document access for MRU cache
    trackDocumentAccess(doc.ref.path);

    return {
      id: doc.id,
      path: doc.ref.path,
      data,
    };
  });

  return {
    collectionId,
    documentCount: documents.length,
    documents,
  };
}

/**
 * MCP tool definition for firestore_query_collection_group
 */
export const firestoreQueryCollectionGroupTool = {
  name: 'firestore_query_collection_group',
  description:
    'Query across all instances of a subcollection (collection group query). For example, query all "events" subcollections across all organizations and products. Note: Collection group queries require indexes in production.',
  inputSchema: {
    type: 'object',
    properties: {
      collectionId: {
        type: 'string',
        description:
          'Collection ID to query across all instances (e.g., "events", "comments")',
      },
      where: {
        type: 'array',
        description: 'Filter conditions',
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
      orderBy: {
        type: 'array',
        description: 'Sort order',
        items: {
          type: 'object',
          properties: {
            field: {
              type: 'string',
              description: 'Field name to sort by',
            },
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
        description: 'Maximum number of documents to return (default: 100)',
        default: 100,
      },
    },
    required: ['collectionId'],
  },
};
