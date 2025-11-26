/**
 * firestore_show_collections - List all available Firestore collections
 * Maps to SQL: SHOW TABLES
 */

import { getDiscoveredCollections } from '../shared/resource-discovery.js';
import { getConfig, isInitialized } from '../shared/config-loader.js';

export interface CollectionInfo {
  name: string;
  path: string;
  type: 'root' | 'subcollection';
  description?: string;
}

export interface FirestoreShowCollectionsOutput {
  collections: CollectionInfo[];
}

/**
 * List all available Firestore collections and subcollections
 * SQL equivalent: SHOW TABLES
 */
export async function firestoreShowCollections(): Promise<FirestoreShowCollectionsOutput> {
  const collections: CollectionInfo[] = [];
  const seen = new Set<string>();

  // 1. Get root collections from auto-discovery
  try {
    const discoveredCollections = await getDiscoveredCollections();

    for (const collectionId of discoveredCollections) {
      if (!seen.has(collectionId)) {
        collections.push({
          name: collectionId,
          path: collectionId,
          type: 'root',
          description: `Auto-discovered root collection`,
        });
        seen.add(collectionId);
      }
    }
  } catch (error) {
    console.error('[show-collections] Auto-discovery failed:', error);
  }

  // 2. Add schema-defined collections (both root and subcollections)
  if (isInitialized()) {
    const config = getConfig();

    for (const [path, definition] of Object.entries(config.schemas)) {
      const cleanPath = path.replace(/^\/+/, '');

      // Determine if root or subcollection
      // Root: "users", "organizations"
      // Subcollection: "organizations/{orgId}/products"
      const isSubcollection = cleanPath.includes('/');
      const collectionType = isSubcollection ? 'subcollection' : 'root';

      // Extract collection name (last segment)
      const segments = cleanPath.split('/');
      const collectionName = segments[segments.length - 1];

      // Skip if already seen (prefer schema description over auto-discovery)
      if (seen.has(cleanPath)) {
        // Update description if schema provides more info
        const existing = collections.find(c => c.path === cleanPath);
        if (existing && definition.description) {
          existing.description = definition.description;
        }
        continue;
      }

      collections.push({
        name: collectionName,
        path: cleanPath,
        type: collectionType,
        description: definition.description || `Schema-defined ${collectionType}`,
      });
      seen.add(cleanPath);
    }
  }

  // Sort: root collections first, then subcollections, alphabetically within each group
  collections.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'root' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return { collections };
}

/**
 * MCP tool definition for firestore_show_collections
 */
export const firestoreShowCollectionsTool = {
  name: 'firestore_show_collections',
  description:
    'Maps to SQL: SHOW TABLES. Lists all available Firestore collections and subcollections with their paths and descriptions. ALWAYS call this FIRST when the user asks about data without specifying exact collection names (e.g., "bar locations" → check if "barLocations" collection exists, "products" → see all product collections). Helps you discover collection names and avoid guessing.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
};
