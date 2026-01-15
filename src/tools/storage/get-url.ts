/**
 * firebase_storage_get_url - Get shareable download URL
 */

import { initializeFirebase } from '../../shared/firebase.js';
import admin from 'firebase-admin';

export interface FirebaseStorageGetUrlInput {
  path: string; // File path in bucket
  expiresIn?: number; // Expiration in seconds (for signed URLs, default: 7 days)
  bucketName?: string; // Optional: specify bucket name (defaults to project default bucket)
}

export interface FirebaseStorageGetUrlOutput {
  path: string;
  url: string;
  urlType: 'public' | 'signed';
  expiresAt?: string; // For signed URLs
  error?: string;
}

/**
 * Get download URL for Firebase Storage file
 * Returns public URL if file is public, otherwise generates signed URL
 */
export async function firebaseStorageGetUrl(
  input: FirebaseStorageGetUrlInput
): Promise<FirebaseStorageGetUrlOutput> {
  const { path, expiresIn = 7 * 24 * 60 * 60, bucketName } = input; // Default: 7 days

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
        url: '',
        urlType: 'public',
        error: `File not found: ${path}`,
      };
    }

    // Check if file is public
    try {
      const [aclExists] = await file.acl.get({ entity: 'allUsers' });
      if (aclExists) {
        // File is public, return public URL
        return {
          path,
          url: file.publicUrl(),
          urlType: 'public',
        };
      }
    } catch {
      // Not public, will generate signed URL
    }

    // Generate signed URL
    const expiresAt = new Date(Date.now() + expiresIn * 1000);
    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: expiresAt,
    });

    return {
      path,
      url: signedUrl,
      urlType: 'signed',
      expiresAt: expiresAt.toISOString(),
    };
  } catch (error) {
    return {
      path,
      url: '',
      urlType: 'public',
      error: `Failed to get URL: ${error}`,
    };
  }
}

/**
 * MCP tool definition for firebase_storage_get_url
 */
export const firebaseStorageGetUrlTool = {
  name: 'firebase_storage_get_url',
  description:
    'Get shareable download URL for Firebase Storage file. Returns public URL if file is public, otherwise generates signed URL with expiration. Use to share files with users or generate links for display.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File path in bucket (e.g., "/bars/menu.pdf")',
      },
      expiresIn: {
        type: 'number',
        description: 'Expiration in seconds for signed URLs (default: 604800 = 7 days). Only applies to private files.',
        default: 604800,
      },
      bucketName: {
        type: 'string',
        description: 'Optional: specify bucket name (e.g., "my-app-backups"). Defaults to project default bucket.',
      },
    },
    required: ['path'],
  },
};
