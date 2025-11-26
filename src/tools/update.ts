/**
 * firestore_update - SQL-style multi-field update
 * Maps to SQL: UPDATE document SET field1=value1, field2=value2, ...
 */

import { getFirestore } from '../shared/firebase.js';
import { trackDocumentAccess } from '../shared/resource-discovery.js';

export interface FirestoreUpdateInput {
  path: string;
  set: Record<string, unknown>; // SQL-style SET clause
}

export interface FirestoreUpdateOutput {
  path: string;
  updated: boolean;
  fieldsUpdated: string[];
  error?: string;
}

/**
 * Update multiple fields in a document
 * SQL equivalent: UPDATE path SET field1=value1, field2=value2
 */
export async function firestoreUpdate(
  input: FirestoreUpdateInput
): Promise<FirestoreUpdateOutput> {
  const { path, set } = input;

  // Get Firestore instance
  const db = await getFirestore();
  const docRef = db.doc(path);

  try {
    // Perform update (Firestore supports partial updates)
    await docRef.update(set);

    // Track document access for MRU cache
    trackDocumentAccess(path);

    return {
      path,
      updated: true,
      fieldsUpdated: Object.keys(set),
    };
  } catch (error) {
    return {
      path,
      updated: false,
      fieldsUpdated: [],
      error: `Update failed: ${error}`,
    };
  }
}

/**
 * MCP tool definition for firestore_update
 */
export const firestoreUpdateTool = {
  name: 'firestore_update',
  description:
    'SQL-style update for one or more fields. Maps to: UPDATE path SET field1=value1, field2=value2, ... Can update multiple fields in a single operation.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Document path (e.g., "users/user-123")',
      },
      set: {
        type: 'object',
        description: 'Fields to update (SQL SET clause). Example: {"email": "new@email.com", "name": "New Name", "status": "active"}',
      },
    },
    required: ['path', 'set'],
  },
};
