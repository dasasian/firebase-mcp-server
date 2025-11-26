/**
 * firestore_export - Batch export Firestore collection to JSON
 * Works with or without schemas (discovery mode)
 */

import admin from 'firebase-admin';
import { getFirestore } from '../shared/firebase.js';
import { getConfig, isInitialized } from '../shared/config-loader.js';
import { matchPath } from '../shared/path-matcher.js';
import { serializeDocument, autoSerializeFirestoreTypes } from '../shared/type-serializer.js';
import { trackDocumentAccess } from '../shared/resource-discovery.js';

export interface FirestoreExportInput {
  collection: string;
  limit?: number;
  orderBy?: string;
  orderDirection?: 'asc' | 'desc';
}

export interface FirestoreExportOutput {
  collection: string;
  documentCount: number;
  schema?: {
    matched: boolean;
    schemaPath?: string;
  };
  documents: Array<{
    id: string;
    path: string;
    data: Record<string, unknown>;
  }>;
}

/**
 * Export collection to JSON
 */
export async function firestoreExport(
  input: FirestoreExportInput
): Promise<FirestoreExportOutput> {
  const {
    collection,
    limit = 1000,
    orderBy,
    orderDirection = 'asc',
  } = input;

  // Get Firestore instance
  const db = await getFirestore();

  // Build query
  let query: admin.firestore.Query = db.collection(collection);

  if (orderBy) {
    query = query.orderBy(orderBy, orderDirection);
  }

  if (limit > 0) {
    query = query.limit(limit);
  }

  // Execute query
  const snapshot = await query.get();

  // Try to match schema (if config is loaded)
  let schemaMatch:
    | { matched: boolean; schemaPath?: string; timestampFields?: string[] }
    | undefined;

  if (isInitialized()) {
    const config = getConfig();
    // Try to match with a sample document path
    const samplePath =
      collection + (snapshot.docs.length > 0 ? `/${snapshot.docs[0].id}` : '/sample');
    const match = matchPath(samplePath, config);

    if (match.matched) {
      schemaMatch = {
        matched: true,
        schemaPath: match.schemaPath,
        timestampFields: match.definition?.timestampFields,
      };
    } else {
      schemaMatch = { matched: false };
    }
  } else {
    schemaMatch = { matched: false };
  }

  // Process documents
  const documents = snapshot.docs.map(doc => {
    let data = doc.data() as Record<string, unknown>;

    // Serialize timestamps
    if (schemaMatch?.matched && schemaMatch.timestampFields) {
      data = serializeDocument(data, schemaMatch.timestampFields) as Record<
        string,
        unknown
      >;
    } else {
      // No schema - auto-serialize all Firestore types
      data = autoSerializeFirestoreTypes(data) as Record<string, unknown>;
    }

    // Track document access for MRU cache
    trackDocumentAccess(doc.ref.path);

    return {
      id: doc.id,
      path: doc.ref.path,
      data,
    };
  });

  return {
    collection,
    documentCount: documents.length,
    schema: schemaMatch
      ? {
          matched: schemaMatch.matched,
          schemaPath: schemaMatch.schemaPath,
        }
      : undefined,
    documents,
  };
}

/**
 * MCP tool definition for firestore_export
 */
export const firestoreExportTool = {
  name: 'firestore_export',
  description:
    'Export an entire Firestore collection to JSON. Works with or without schemas (discovery mode). Automatically serializes timestamps. Use limit to control size.',
  inputSchema: {
    type: 'object',
    properties: {
      collection: {
        type: 'string',
        description:
          'Collection path (e.g., "users" or "organizations/org-1/products")',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of documents to export (default: 1000, 0 for unlimited)',
        default: 1000,
      },
      orderBy: {
        type: 'string',
        description: 'Field to order by (optional)',
      },
      orderDirection: {
        type: 'string',
        enum: ['asc', 'desc'],
        description: 'Order direction (default: asc)',
        default: 'asc',
      },
    },
    required: ['collection'],
  },
};
