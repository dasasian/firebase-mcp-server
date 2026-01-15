/**
 * firebase_storage_mv - Move/rename file within bucket
 * Maps to Unix: mv source dest
 */

import { initializeFirebase } from '../../shared/firebase.js';
import admin from 'firebase-admin';

export interface FirebaseStorageMvInput {
  source: string; // Source file path
  destination: string; // Destination file path
  bucketName?: string; // Optional: specify bucket name (defaults to project default bucket)
}

export interface FirebaseStorageMvOutput {
  source: string;
  destination: string;
  moved: boolean;
  metadata?: {
    size: number;
    contentType: string;
  };
  error?: string;
}

/**
 * Move/rename file within Firebase Storage bucket
 * Unix equivalent: mv source dest
 * Implementation: Copy to destination, then delete source
 */
export async function firebaseStorageMv(
  input: FirebaseStorageMvInput
): Promise<FirebaseStorageMvOutput> {
  const { source, destination, bucketName } = input;

  const cleanSource = source.replace(/^\//, '');
  const cleanDestination = destination.replace(/^\//, '');

  try {
    await initializeFirebase();
    const bucket = bucketName ? admin.storage().bucket(bucketName) : admin.storage().bucket();
    const sourceFile = bucket.file(cleanSource);

    // Check if source exists
    const [exists] = await sourceFile.exists();
    if (!exists) {
      return {
        source,
        destination,
        moved: false,
        error: `Source file not found: ${source}`,
      };
    }

    // Move file (copy then delete)
    const destFile = bucket.file(cleanDestination);
    await sourceFile.move(destFile);

    // Get metadata
    const [metadata] = await destFile.getMetadata();

    return {
      source,
      destination,
      moved: true,
      metadata: {
        size: parseInt(String(metadata.size || 0)),
        contentType: metadata.contentType || 'application/octet-stream',
      },
    };
  } catch (error) {
    return {
      source,
      destination,
      moved: false,
      error: `Failed to move file: ${error}`,
    };
  }
}

/**
 * MCP tool definition for firebase_storage_mv
 */
export const firebaseStorageMvTool = {
  name: 'firebase_storage_mv',
  description:
    'Move or rename file within Firebase Storage bucket. Maps to Unix: mv source dest. File is moved to new location and deleted from source. Use for organizing files, renaming, or moving to different folders.',
  inputSchema: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        description: 'Source file path (e.g., "/temp/draft.pdf")',
      },
      destination: {
        type: 'string',
        description: 'Destination file path (e.g., "/published/final.pdf")',
      },
      bucketName: {
        type: 'string',
        description: 'Optional: specify bucket name (e.g., "my-app-backups"). Defaults to project default bucket.',
      },
    },
    required: ['source', 'destination'],
  },
};
