/**
 * firebase_storage_set_access - Set file access permissions (public or private)
 */

import { initializeFirebase } from '../../shared/firebase.js';
import admin from 'firebase-admin';

export interface FirebaseStorageSetAccessInput {
  path: string; // File path in bucket
  public: boolean; // true = make public, false = make private
  bucketName?: string; // Optional: specify bucket name (defaults to project default bucket)
}

export interface FirebaseStorageSetAccessOutput {
  path: string;
  isPublic: boolean;
  publicUrl?: string;
  message: string;
  error?: string;
}

/**
 * Set Firebase Storage file access (public or private)
 */
export async function firebaseStorageSetAccess(
  input: FirebaseStorageSetAccessInput
): Promise<FirebaseStorageSetAccessOutput> {
  const { path, public: makePublic, bucketName } = input;

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
        message: '',
        error: `File not found: ${path}`,
      };
    }

    if (makePublic) {
      // Make file public
      await file.makePublic();

      return {
        path,
        isPublic: true,
        publicUrl: file.publicUrl(),
        message: `File is now publicly accessible at: ${file.publicUrl()}`,
      };
    } else {
      // Make file private (remove public access)
      try {
        await file.acl.delete({ entity: 'allUsers' });
      } catch {
        // May not have been public, ignore error
      }

      return {
        path,
        isPublic: false,
        message: `File is now private. Use firebase_storage_get_url to generate signed URLs.`,
      };
    }
  } catch (error) {
    return {
      path,
      isPublic: false,
      message: '',
      error: `Failed to set access: ${error}`,
    };
  }
}

/**
 * MCP tool definition for firebase_storage_set_access
 */
export const firebaseStorageSetAccessTool = {
  name: 'firebase_storage_set_access',
  description:
    'Set Firebase Storage file access permissions. Make file publicly accessible (public: true) or private (public: false). Public files have permanent URLs anyone can access. Private files require signed URLs with expiration. Use for controlling file visibility.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File path in bucket (e.g., "/bars/menu.pdf")',
      },
      public: {
        type: 'boolean',
        description: 'true = make public (anyone can access), false = make private (requires signed URLs)',
      },
      bucketName: {
        type: 'string',
        description: 'Optional: specify bucket name (e.g., "my-app-backups"). Defaults to project default bucket.',
      },
    },
    required: ['path', 'public'],
  },
};
