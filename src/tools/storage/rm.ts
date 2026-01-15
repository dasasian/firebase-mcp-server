/**
 * firebase_storage_rm - Delete file from bucket
 * Maps to Unix: rm file
 */

import { initializeFirebase } from '../../shared/firebase.js';
import admin from 'firebase-admin';

export interface FirebaseStorageRmInput {
  path: string; // File path in bucket
  bucketName?: string; // Optional: specify bucket name (defaults to project default bucket)
}

export interface FirebaseStorageRmOutput {
  path: string;
  deleted: boolean;
  deletedFile?: {
    name: string;
    size: number;
    contentType: string;
  };
  error?: string;
}

/**
 * Delete file from Firebase Storage
 * Unix equivalent: rm file
 */
export async function firebaseStorageRm(
  input: FirebaseStorageRmInput
): Promise<FirebaseStorageRmOutput> {
  const { path, bucketName } = input;

  const cleanPath = path.replace(/^\//, '');

  try {
    await initializeFirebase();
    const bucket = bucketName ? admin.storage().bucket(bucketName) : admin.storage().bucket();
    const file = bucket.file(cleanPath);

    // Check if file exists and get metadata before deletion
    const [exists] = await file.exists();
    if (!exists) {
      return {
        path,
        deleted: false,
        error: `File not found: ${path}`,
      };
    }

    const [metadata] = await file.getMetadata();

    // Delete file
    await file.delete();

    return {
      path,
      deleted: true,
      deletedFile: {
        name: cleanPath.split('/').pop() || cleanPath,
        size: parseInt(String(metadata.size || 0)),
        contentType: metadata.contentType || 'application/octet-stream',
      },
    };
  } catch (error) {
    return {
      path,
      deleted: false,
      error: `Failed to delete file: ${error}`,
    };
  }
}

/**
 * MCP tool definition for firebase_storage_rm
 */
export const firebaseStorageRmTool = {
  name: 'firebase_storage_rm',
  description:
    'Delete file from Firebase Storage bucket. Maps to Unix: rm file. Permanently removes file from storage. Returns deleted file details for confirmation. IRREVERSIBLE operation.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File path in bucket to delete (e.g., "/temp/old-file.jpg")',
      },
      bucketName: {
        type: 'string',
        description: 'Optional: specify bucket name (e.g., "my-app-backups"). Defaults to project default bucket.',
      },
    },
    required: ['path'],
  },
};
