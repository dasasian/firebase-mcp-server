/**
 * Path pattern matching for Firestore document paths
 * Matches actual paths like /users/user-123/orders/order-456
 * to schema patterns like /users/{userId}/orders/{orderId}
 */

import type { PathMatchResult, PathParams, SchemaConfig } from './types.js';

/**
 * Match a document path to a schema pattern
 *
 * @example
 * matchPath('/users/user-123/orders/order-456', config)
 * // Returns: {
 * //   matched: true,
 * //   schemaPath: '/users/{userId}/orders/{orderId}',
 * //   params: { userId: 'user-123', orderId: 'order-456' },
 * //   definition: { schema: {...}, timestampFields: [...] }
 * // }
 */
export function matchPath(
  documentPath: string,
  config: SchemaConfig
): PathMatchResult {
  // Normalize path (remove leading/trailing slashes)
  const normalizedPath = normalizePath(documentPath);
  const segments = normalizedPath.split('/');

  // Validate path alternates between collection and document
  if (!isValidFirestorePath(segments)) {
    return { matched: false };
  }

  // Try to match against each schema pattern
  for (const [schemaPath, definition] of Object.entries(config.schemas)) {
    const normalizedSchemaPath = normalizePath(schemaPath);
    const schemaSegments = normalizedSchemaPath.split('/');

    // Paths must have same number of segments
    if (segments.length !== schemaSegments.length) {
      continue;
    }

    // Try to match each segment
    const params: PathParams = {};
    let matched = true;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const schemaSegment = schemaSegments[i];

      if (isPathParameter(schemaSegment)) {
        // Extract parameter name from {paramName}
        const paramName = schemaSegment.slice(1, -1);
        params[paramName] = segment;
      } else if (segment !== schemaSegment) {
        // Literal segment doesn't match
        matched = false;
        break;
      }
    }

    if (matched) {
      return {
        matched: true,
        schemaPath,
        params,
        definition,
      };
    }
  }

  // No schema matched
  return { matched: false };
}

/**
 * Validate that a Firestore path alternates collection/document
 *
 * Firestore paths must follow: collection/doc/collection/doc/...
 * - Odd indices (0, 2, 4, ...) are collections
 * - Even indices (1, 3, 5, ...) are documents (when present)
 *
 * Valid paths:
 * - users (collection only)
 * - users/user-123 (collection + document)
 * - users/user-123/orders (collection + document + subcollection)
 * - users/user-123/orders/order-456 (full path)
 */
export function isValidFirestorePath(segments: string[]): boolean {
  // Empty path is invalid
  if (segments.length === 0) {
    return false;
  }

  // All segments must be non-empty
  return segments.every(segment => segment.length > 0);
}

/**
 * Check if a segment is a path parameter (enclosed in {braces})
 */
export function isPathParameter(segment: string): boolean {
  return segment.startsWith('{') && segment.endsWith('}');
}

/**
 * Check whether any segment of a path is a parameter.
 *
 * A path with a parameter in it is a template, not something that can be read
 * — "users/{userId}" describes a shape, while "users/user-123" is a document.
 *
 * @example
 * hasPathParameter('posts/{postId}/comments') // true
 * hasPathParameter('posts/post-1/comments')   // false
 */
export function hasPathParameter(path: string): boolean {
  return normalizePath(path).split('/').some(isPathParameter);
}

/**
 * Normalize a Firestore path (remove leading/trailing slashes)
 */
export function normalizePath(path: string): string {
  return path.replace(/^\/+|\/+$/g, '');
}

/**
 * Extract collection path from document path
 *
 * @example
 * getCollectionPath('/users/user-123/orders/order-456')
 * // Returns: 'users/user-123/orders'
 */
export function getCollectionPath(documentPath: string): string {
  const normalized = normalizePath(documentPath);
  const segments = normalized.split('/');

  // Remove last segment (document ID)
  if (segments.length > 1) {
    return segments.slice(0, -1).join('/');
  }

  return '';
}

/**
 * Get collection name from path (last collection segment)
 *
 * @example
 * getCollectionName('/users/user-123/orders/order-456')
 * // Returns: 'orders'
 */
export function getCollectionName(path: string): string {
  const normalized = normalizePath(path);
  const segments = normalized.split('/');

  // For document paths, collection is second-to-last segment
  // For collection paths, collection is last segment
  if (segments.length % 2 === 0) {
    // Even number of segments = document path
    return segments[segments.length - 2];
  } else {
    // Odd number of segments = collection path
    return segments[segments.length - 1];
  }
}

/**
 * Check if path is a document path (even number of segments)
 */
export function isDocumentPath(path: string): boolean {
  const normalized = normalizePath(path);
  const segments = normalized.split('/');
  return segments.length % 2 === 0;
}

/**
 * Check if path is a collection path (odd number of segments)
 */
export function isCollectionPath(path: string): boolean {
  return !isDocumentPath(path);
}
