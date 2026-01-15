/**
 * firebase_storage_find - Search files with filters
 * Maps to Unix: find /path -name "*.png"
 */

import { initializeFirebase } from '../../shared/firebase.js';
import admin from 'firebase-admin';

export interface FirebaseStorageFindInput {
  path?: string; // Start path (default: root)
  pattern?: string; // Filename pattern with wildcards (*, ?)
  contentType?: string; // MIME type filter (supports wildcards, e.g., "image/*")
  sizeGt?: number; // Size greater than (bytes)
  sizeLt?: number; // Size less than (bytes)
  createdAfter?: string; // ISO date string
  createdBefore?: string; // ISO date string
  recursive?: boolean; // Search subdirectories (default: true)
  bucketName?: string; // Optional: specify bucket name (defaults to project default bucket)
}

export interface FirebaseStorageFindOutput {
  query: string;
  matches: Array<{
    name: string;
    fullPath: string;
    size: number;
    contentType: string;
    timeCreated: string;
  }>;
  totalMatches: number;
  error?: string;
}

/**
 * Search files in Firebase Storage with filters
 * Unix equivalent: find /path -name "*.png" -size +1M
 */
export async function firebaseStorageFind(
  input: FirebaseStorageFindInput = {}
): Promise<FirebaseStorageFindOutput> {
  const {
    path = '',
    pattern,
    contentType,
    sizeGt,
    sizeLt,
    createdAfter,
    createdBefore,
    recursive = true,
    bucketName,
  } = input;

  try {
    await initializeFirebase();
    const bucket = bucketName ? admin.storage().bucket(bucketName) : admin.storage().bucket();

    // List all files
    const [files] = await bucket.getFiles({
      prefix: path ? path.replace(/^\//, '') : undefined,
      delimiter: recursive ? undefined : '/',
    });

    // Apply filters
    let matches = files;

    // Pattern filter (convert to regex)
    if (pattern) {
      const regexPattern = pattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
      const regex = new RegExp(`^${regexPattern}$`, 'i');
      matches = matches.filter(file => {
        const name = file.name.split('/').pop() || '';
        return regex.test(name);
      });
    }

    // Get metadata for remaining files
    const matchesWithMetadata = await Promise.all(
      matches.map(async file => {
        const [metadata] = await file.getMetadata();
        return {
          file,
          metadata,
          size: parseInt(String(metadata.size || 0)),
          timeCreated: new Date(metadata.timeCreated || ''),
        };
      })
    );

    // Apply content type filter
    if (contentType) {
      const typePattern = contentType.replace(/\*/g, '.*');
      const typeRegex = new RegExp(`^${typePattern}$`, 'i');
      matches = matchesWithMetadata
        .filter(({ metadata }) => typeRegex.test(metadata.contentType || ''))
        .map(({ file }) => file);
    } else {
      matches = matchesWithMetadata.map(({ file }) => file);
    }

    // Apply size filters
    if (sizeGt !== undefined || sizeLt !== undefined) {
      matches = matchesWithMetadata
        .filter(({ size }) => {
          if (sizeGt !== undefined && size <= sizeGt) return false;
          if (sizeLt !== undefined && size >= sizeLt) return false;
          return true;
        })
        .map(({ file }) => file);
    }

    // Apply date filters
    if (createdAfter || createdBefore) {
      const afterDate = createdAfter ? new Date(createdAfter) : null;
      const beforeDate = createdBefore ? new Date(createdBefore) : null;

      matches = matchesWithMetadata
        .filter(({ timeCreated }) => {
          if (afterDate && timeCreated <= afterDate) return false;
          if (beforeDate && timeCreated >= beforeDate) return false;
          return true;
        })
        .map(({ file }) => file);
    }

    // Build result
    const results = await Promise.all(
      matches.map(async file => {
        const [metadata] = await file.getMetadata();
        return {
          name: file.name.split('/').pop() || file.name,
          fullPath: '/' + file.name,
          size: parseInt(String(metadata.size || 0)),
          contentType: metadata.contentType || 'application/octet-stream',
          timeCreated: metadata.timeCreated || '',
        };
      })
    );

    return {
      query: buildQueryString(input),
      matches: results,
      totalMatches: results.length,
    };
  } catch (error) {
    return {
      query: buildQueryString(input),
      matches: [],
      totalMatches: 0,
      error: `Failed to search files: ${error}`,
    };
  }
}

function buildQueryString(input: FirebaseStorageFindInput): string {
  const parts: string[] = [];
  if (input.path) parts.push(`path:${input.path}`);
  if (input.pattern) parts.push(`pattern:${input.pattern}`);
  if (input.contentType) parts.push(`type:${input.contentType}`);
  if (input.sizeGt) parts.push(`size>${input.sizeGt}`);
  if (input.sizeLt) parts.push(`size<${input.sizeLt}`);
  if (input.createdAfter) parts.push(`after:${input.createdAfter}`);
  if (input.createdBefore) parts.push(`before:${input.createdBefore}`);
  return parts.join(' ') || 'all files';
}

/**
 * MCP tool definition for firebase_storage_find
 */
export const firebaseStorageFindTool = {
  name: 'firebase_storage_find',
  description:
    'Search files in Firebase Storage with filters. Maps to Unix: find /path -name "*.png" -size +1M. Supports pattern matching (wildcards), content type filter, size filters, and date filters. Use for discovery like "find all large images" or "find PDFs from last month".',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Start path for search (default: root "/")',
      },
      pattern: {
        type: 'string',
        description: 'Filename pattern with wildcards: * (any chars), ? (single char). Example: "*.png" or "logo-*"',
      },
      contentType: {
        type: 'string',
        description: 'MIME type filter, supports wildcards. Example: "image/*" or "application/pdf"',
      },
      sizeGt: {
        type: 'number',
        description: 'Size greater than (bytes). Example: 1000000 for files > 1MB',
      },
      sizeLt: {
        type: 'number',
        description: 'Size less than (bytes). Example: 1000000 for files < 1MB',
      },
      createdAfter: {
        type: 'string',
        description: 'Created after date (ISO format). Example: "2025-01-01"',
      },
      createdBefore: {
        type: 'string',
        description: 'Created before date (ISO format). Example: "2025-12-31"',
      },
      recursive: {
        type: 'boolean',
        description: 'Search subdirectories recursively (default: true)',
        default: true,
      },
      bucketName: {
        type: 'string',
        description: 'Optional: specify bucket name (e.g., "my-app-backups"). Defaults to project default bucket.',
      },
    },
  },
};
