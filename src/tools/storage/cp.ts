/**
 * firebase_storage_cp - Copy file within bucket
 * Maps to Unix: cp source dest
 */

import { initializeFirebase } from '../../shared/firebase.js';
import admin from 'firebase-admin';

export interface FirebaseStorageCpInput {
  source: string; // Source file path
  destination: string; // Destination file path
  bucketName?: string; // Optional: specify bucket name (defaults to project default bucket)
}

export interface FirebaseStorageCpOutput {
  source: string;
  destination: string;
  copied: boolean;
  metadata?: {
    size: number;
    contentType: string;
  };
  error?: string;
}

/**
 * Copy file within Firebase Storage bucket
 * Unix equivalent: cp source dest
 * Implementation: Download source, upload to destination
 */
export async function firebaseStorageCp(
  input: FirebaseStorageCpInput
): Promise<FirebaseStorageCpOutput> {
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
        copied: false,
        error: `Source file not found: ${source}`,
      };
    }

    // Copy file (native copy operation)
    const destFile = bucket.file(cleanDestination);
    await sourceFile.copy(destFile);

    // Get metadata
    const [metadata] = await destFile.getMetadata();

    return {
      source,
      destination,
      copied: true,
      metadata: {
        size: parseInt(String(metadata.size || 0)),
        contentType: metadata.contentType || 'application/octet-stream',
      },
    };
  } catch (error) {
    return {
      source,
      destination,
      copied: false,
      error: `Failed to copy file: ${error}`,
    };
  }
}

/**
 * MCP tool definition for firebase_storage_cp
 */
export const firebaseStorageCpTool = {
  name: 'firebase_storage_cp',
  description:
    'Copy file within Firebase Storage bucket. Maps to Unix: cp source dest. Creates duplicate of file at new location. Original file remains unchanged. Use for backups, creating variants, or organizing files.',
  inputSchema: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        description: 'Source file path (e.g., "/bars/logo.png")',
      },
      destination: {
        type: 'string',
        description: 'Destination file path (e.g., "/archive/logo-backup.png")',
      },
      bucketName: {
        type: 'string',
        description: 'Optional: specify bucket name (e.g., "my-app-backups"). Defaults to project default bucket.',
      },
    },
    required: ['source', 'destination'],
  },
};
