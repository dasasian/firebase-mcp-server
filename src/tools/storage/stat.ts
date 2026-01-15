/**
 * firebase_storage_stat - Get file metadata
 * Maps to Unix: stat file
 */

import { initializeFirebase } from '../../shared/firebase.js';
import admin from 'firebase-admin';

export interface FirebaseStorageStatInput {
  path: string; // File path in bucket
  bucketName?: string; // Optional: specify bucket name (defaults to project default bucket)
}

export interface FirebaseStorageStatOutput {
  path: string;
  exists: boolean;
  metadata?: {
    name: string;
    size: number;
    contentType: string;
    timeCreated: string;
    updated: string;
    bucket: string;
    md5Hash?: string;
    cacheControl?: string;
    contentEncoding?: string;
  };
  error?: string;
}

/**
 * Get file metadata from Firebase Storage
 * Unix equivalent: stat file
 */
export async function firebaseStorageStat(
  input: FirebaseStorageStatInput
): Promise<FirebaseStorageStatOutput> {
  const { path, bucketName } = input;

  const cleanPath = path.replace(/^\//, '');

  try {
    await initializeFirebase();
    const bucket = bucketName ? admin.storage().bucket(bucketName) : admin.storage().bucket();
    const file = bucket.file(cleanPath);

    // Check if file exists
    const [exists] = await file.exists();
    if (!exists) {
      return {
        path,
        exists: false,
        error: `File not found: ${path}`,
      };
    }

    // Get metadata
    const [metadata] = await file.getMetadata();

    return {
      path,
      exists: true,
      metadata: {
        name: cleanPath.split('/').pop() || cleanPath,
        size: parseInt(String(metadata.size || 0)),
        contentType: metadata.contentType || 'application/octet-stream',
        timeCreated: metadata.timeCreated || '',
        updated: metadata.updated || '',
        bucket: bucket.name,
        md5Hash: metadata.md5Hash,
        cacheControl: metadata.cacheControl,
        contentEncoding: metadata.contentEncoding,
      },
    };
  } catch (error) {
    return {
      path,
      exists: false,
      error: `Failed to get file metadata: ${error}`,
    };
  }
}

/**
 * MCP tool definition for firebase_storage_stat
 */
export const firebaseStorageStatTool = {
  name: 'firebase_storage_stat',
  description:
    'Get file metadata from Firebase Storage. Maps to Unix: stat file. Returns detailed information about file including size, content type, creation/update times, MD5 hash. Use to check if file exists or get file info without downloading.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File path in bucket (e.g., "/bars/logo.png")',
      },
      bucketName: {
        type: 'string',
        description: 'Optional: specify bucket name (e.g., "my-app-backups"). Defaults to project default bucket.',
      },
    },
    required: ['path'],
  },
};
