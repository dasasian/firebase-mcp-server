/**
 * Resource discovery for Firestore collections
 * Caches auto-discovered collections to minimize Firestore reads
 */

import { getFirestore } from './firebase.js';

interface DiscoveryCache {
  collections: string[];
  timestamp: number;
}

/**
 * MRU (Most Recently Used) document tracking
 * Tracks documents accessed via @ mentions or tools
 */
interface MRUDocument {
  path: string;          // "users/user-123" or "organizations/org-1/products/prod-2"
  uri: string;           // "firestore://users/user-123"
  accessCount: number;   // How many times accessed
  lastAccessed: number;  // Timestamp in ms
}

let discoveredCollectionsCache: DiscoveryCache | null = null;

// MRU document cache - in-memory only, max 50 documents
const mruDocuments: Map<string, MRUDocument> = new Map();
const MAX_MRU_DOCUMENTS = 50;

// Cache TTL from environment or default to 5 minutes
const CACHE_TTL = parseInt(process.env.FIRESTORE_DISCOVERY_CACHE_TTL || '300') * 1000;

/**
 * Get all collections with caching
 */
export async function getDiscoveredCollections(): Promise<string[]> {
  const autoDiscover = process.env.FIRESTORE_AUTO_DISCOVER !== 'false';

  if (!autoDiscover) {
    return [];
  }

  const now = Date.now();

  // Return cached if fresh
  if (
    discoveredCollectionsCache &&
    now - discoveredCollectionsCache.timestamp < CACHE_TTL
  ) {
    return discoveredCollectionsCache.collections;
  }

  // Fetch from Firestore
  const db = await getFirestore();
  const collections = await db.listCollections();
  const collectionIds = collections.map(c => c.id);

  // Cache results
  discoveredCollectionsCache = {
    collections: collectionIds,
    timestamp: now,
  };

  console.error(`[Discovery] Found ${collectionIds.length} collections (cached for ${CACHE_TTL / 1000}s)`);

  return collectionIds;
}

/**
 * Track document access for MRU cache
 * Call this whenever a document is accessed (via @ mention or tool)
 *
 * @param path - Document path like "users/user-123" or "organizations/org-1/products/prod-2"
 */
export function trackDocumentAccess(path: string): void {
  const uri = `firestore://${path}`;
  const now = Date.now();

  // Update existing or create new
  const existing = mruDocuments.get(path);
  if (existing) {
    existing.accessCount++;
    existing.lastAccessed = now;
  } else {
    mruDocuments.set(path, {
      path,
      uri,
      accessCount: 1,
      lastAccessed: now,
    });
  }

  // Enforce max limit by evicting least used
  if (mruDocuments.size > MAX_MRU_DOCUMENTS) {
    const sorted = Array.from(mruDocuments.values()).sort((a, b) => {
      // Sort by access count desc, then by last accessed desc
      if (a.accessCount !== b.accessCount) {
        return b.accessCount - a.accessCount;
      }
      return b.lastAccessed - a.lastAccessed;
    });

    // Keep only top MAX_MRU_DOCUMENTS
    mruDocuments.clear();
    sorted.slice(0, MAX_MRU_DOCUMENTS).forEach(doc => {
      mruDocuments.set(doc.path, doc);
    });
  }
}

/**
 * Get MRU documents sorted by usage (most used first)
 * Returns array of resources ready for ListResources response
 */
export function getMRUDocuments(): Array<{
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}> {
  // Sort by access count (desc), then last accessed (desc)
  const sorted = Array.from(mruDocuments.values()).sort((a, b) => {
    if (a.accessCount !== b.accessCount) {
      return b.accessCount - a.accessCount;
    }
    return b.lastAccessed - a.lastAccessed;
  });

  return sorted.map(doc => ({
    uri: doc.uri,
    name: `📄 ${doc.path}`,
    description: `Recent document (${doc.accessCount} access${doc.accessCount > 1 ? 'es' : ''})`,
    mimeType: 'application/json',
  }));
}

/**
 * Extract top-level collection name from schema path
 *
 * @example
 * extractCollectionPath('/users/{userId}') // 'users'
 * extractCollectionPath('/posts/{postId}/comments/{commentId}') // 'posts'
 */
export function extractCollectionPath(schemaPath: string): string {
  const normalized = schemaPath.replace(/^\/+/, '');
  const firstSegment = normalized.split('/')[0];

  // Remove parameter braces if present
  return firstSegment.replace(/\{|\}/g, '');
}

/**
 * Get all collection paths from schema (including nested)
 */
export function getSchemaCollectionPaths(
  schemas: Record<string, unknown>
): Set<string> {
  const paths = new Set<string>();

  for (const schemaPath of Object.keys(schemas)) {
    const normalized = schemaPath.replace(/^\/+/, '');
    const segments = normalized.split('/');

    // Extract all collection names (odd indices: 0, 2, 4, ...)
    for (let i = 0; i < segments.length; i += 2) {
      const segment = segments[i];
      // Remove parameter braces
      const cleanSegment = segment.replace(/\{|\}/g, '');
      paths.add(cleanSegment);
    }
  }

  return paths;
}

/**
 * Clear discovery cache (useful for testing)
 */
export function clearDiscoveryCache(): void {
  discoveredCollectionsCache = null;
  mruDocuments.clear();
}
