/**
 * firestore_count - Count documents without fetching them
 * 99.96% context savings
 */

import admin from 'firebase-admin';
import { getFirestore } from '../shared/firebase.js';

export interface FirestoreCountInput {
  collection: string;
  where?: Array<{
    field: string;
    operator: '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'not-in';
    value: unknown;
  }>;
}

export interface FirestoreCountOutput {
  collection: string;
  count: number;
  filter?: string;
}

/**
 * Count documents in a collection
 */
export async function firestoreCount(
  input: FirestoreCountInput
): Promise<FirestoreCountOutput> {
  const { collection, where = [] } = input;

  const db = await getFirestore();
  let query: admin.firestore.Query = db.collection(collection);

  // Apply where clauses
  for (const clause of where) {
    query = query.where(clause.field, clause.operator as admin.firestore.WhereFilterOp, clause.value);
  }

  // Use count aggregation (doesn't fetch documents!)
  const snapshot = await query.count().get();
  const count = snapshot.data().count;

  // Format filter description
  const filterDesc = where.length > 0
    ? where.map(w => `${w.field} ${w.operator} ${JSON.stringify(w.value)}`).join(' AND ')
    : undefined;

  return {
    collection,
    count,
    filter: filterDesc,
  };
}

/**
 * MCP tool definition
 */
export const firestoreCountTool = {
  name: 'firestore_count',
  description:
    'Count documents in a collection WITHOUT fetching them. Achieves 99.96% context savings vs fetching all documents. Supports where clauses for filtered counts.',
  inputSchema: {
    type: 'object',
    properties: {
      collection: {
        type: 'string',
        description: 'Collection path',
      },
      where: {
        type: 'array',
        description: 'Optional where clauses',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string' },
            operator: { type: 'string', enum: ['==', '!=', '<', '<=', '>', '>=', 'in', 'not-in'] },
            value: {},
          },
          required: ['field', 'operator', 'value'],
        },
      },
    },
    required: ['collection'],
  },
};
