/**
 * firebase_storage_read - Download file to temp for analysis
 * Maps to Unix: cat file or download
 */

import { initializeFirebase } from '../../shared/firebase.js';
import admin from 'firebase-admin';
import { writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { join, extname } from 'path';

export interface FirebaseStorageReadInput {
  path: string; // File path in bucket
  bucketName?: string; // Optional: specify bucket name (defaults to project default bucket)
}

export interface FirebaseStorageReadOutput {
  path: string;
  tempPath: string; // Local temp file path for Read tool
  url?: string;
  metadata: {
    size: number;
    contentType: string;
    timeCreated: string;
    updated: string;
  };
  downloaded: boolean;
  error?: string;
}

/**
 * Download Firebase Storage file to temp directory
 * Unix equivalent: cat file or download
 * Returns temp path for Claude's Read tool to analyze
 */
export async function firebaseStorageRead(
  input: FirebaseStorageReadInput
): Promise<FirebaseStorageReadOutput> {
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
        tempPath: '',
        downloaded: false,
        metadata: { size: 0, contentType: '', timeCreated: '', updated: '' },
        error: `File not found: ${path}`,
      };
    }

    // Get metadata
    const [metadata] = await file.getMetadata();

    // Generate temp file path
    const filename = cleanPath.split('/').pop() || 'file';
    const ext = extname(filename);
    const tempPath = join(tmpdir(), `firebase-${randomUUID()}${ext}`);

    // Download file
    await file.download({ destination: tempPath });

    // Try to get public URL
    let url: string | undefined;
    try {
      const [aclExists] = await file.acl.get({ entity: 'allUsers' });
      if (aclExists) {
        url = file.publicUrl();
      }
    } catch {
      // Not public, no URL
    }

    return {
      path,
      tempPath,
      url,
      metadata: {
        size: parseInt(String(metadata.size || 0)),
        contentType: metadata.contentType || 'application/octet-stream',
        timeCreated: metadata.timeCreated || '',
        updated: metadata.updated || '',
      },
      downloaded: true,
    };
  } catch (error) {
    return {
      path,
      tempPath: '',
      downloaded: false,
      metadata: { size: 0, contentType: '', timeCreated: '', updated: '' },
      error: `Failed to download file: ${error}`,
    };
  }
}

/**
 * MCP tool definition for firebase_storage_read
 */
export const firebaseStorageReadTool = {
  name: 'firebase_storage_read',
  description:
    'Download Firebase Storage file to temp directory for analysis. Maps to Unix: cat file. Downloads file to /tmp/firebase-{uuid}-{filename} and returns tempPath. Use Read tool on tempPath to analyze content (images, PDFs, text files, etc.). Enables Claude to work with Storage files like local files.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File path in bucket (e.g., "/bars/logo.png" or "/data/inventory.csv")',
      },
      bucketName: {
        type: 'string',
        description: 'Optional: specify bucket name (e.g., "my-app-backups"). Defaults to project default bucket.',
      },
    },
    required: ['path'],
  },
};
