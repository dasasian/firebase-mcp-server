/**
 * firebase_storage_get_access - Check file access permissions
 */

import { initializeFirebase } from '../../shared/firebase.js';
import admin from 'firebase-admin';

export interface FirebaseStorageGetAccessInput {
  path: string; // File path in bucket
  bucketName?: string; // Optional: specify bucket name (defaults to project default bucket)
}

export interface FirebaseStorageGetAccessOutput {
  path: string;
  isPublic: boolean;
  publicUrl?: string;
  metadata?: {
    size: number;
    contentType: string;
  };
  error?: string;
}

/**
 * Check if Firebase Storage file is publicly accessible
 */
export async function firebaseStorageGetAccess(
  input: FirebaseStorageGetAccessInput
): Promise<FirebaseStorageGetAccessOutput> {
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
        isPublic: false,
        error: `File not found: ${path}`,
      };
    }

    // Get metadata
    const [metadata] = await file.getMetadata();

    // Check if file is public
    let isPublic = false;
    let publicUrl: string | undefined;

    try {
      const [aclExists] = await file.acl.get({ entity: 'allUsers' });
      if (aclExists) {
        isPublic = true;
        publicUrl = file.publicUrl();
      }
    } catch {
      // Not public
      isPublic = false;
    }

    return {
      path,
      isPublic,
      publicUrl,
      metadata: {
        size: parseInt(String(metadata.size || 0)),
        contentType: metadata.contentType || 'application/octet-stream',
      },
    };
  } catch (error) {
    return {
      path,
      isPublic: false,
      error: `Failed to get access info: ${error}`,
    };
  }
}

/**
 * MCP tool definition for firebase_storage_get_access
 */
export const firebaseStorageGetAccessTool = {
  name: 'firebase_storage_get_access',
  description:
    'Check if Firebase Storage file is publicly accessible. Returns isPublic status and public URL if available. Use before sharing links to verify access permissions.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File path in bucket (e.g., "/bars/menu.pdf")',
      },
      bucketName: {
        type: 'string',
        description: 'Optional: specify bucket name (e.g., "my-app-backups"). Defaults to project default bucket.',
      },
    },
    required: ['path'],
  },
};
