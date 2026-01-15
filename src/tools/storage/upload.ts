/**
 * firebase_storage_upload - Upload local file to bucket
 * Maps to Unix: cp local remote
 */

import { initializeFirebase } from '../../shared/firebase.js';
import admin from 'firebase-admin';
import { readFile } from 'fs/promises';
import { extname } from 'path';

export interface FirebaseStorageUploadInput {
  localPath: string; // Local file path
  remotePath: string; // Destination in bucket
  contentType?: string; // Optional: auto-detect if not provided
  bucketName?: string; // Optional: specify bucket name (defaults to project default bucket)
}

export interface FirebaseStorageUploadOutput {
  localPath: string;
  remotePath: string;
  uploaded: boolean;
  url?: string;
  metadata: {
    size: number;
    contentType: string;
    timeCreated: string;
  };
  error?: string;
}

/**
 * Auto-detect content type from file extension
 */
function detectContentType(filename: string): string {
  const ext = extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.json': 'application/json',
    '.csv': 'text/csv',
    '.txt': 'text/plain',
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.mp4': 'video/mp4',
    '.mp3': 'audio/mpeg',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Upload local file to Firebase Storage
 * Unix equivalent: cp local remote
 */
export async function firebaseStorageUpload(
  input: FirebaseStorageUploadInput
): Promise<FirebaseStorageUploadOutput> {
  const { localPath, remotePath, contentType, bucketName } = input;

  const cleanRemotePath = remotePath.replace(/^\//, '');

  try {
    await initializeFirebase();
    const bucket = bucketName ? admin.storage().bucket(bucketName) : admin.storage().bucket();

    // Read local file
    const fileContent = await readFile(localPath);

    // Detect content type if not provided
    const detectedContentType = contentType || detectContentType(localPath);

    // Upload file
    const file = bucket.file(cleanRemotePath);
    await file.save(fileContent, {
      contentType: detectedContentType,
      metadata: {
        firebaseStorageDownloadTokens: undefined, // Generate new token
      },
    });

    // Get metadata
    const [metadata] = await file.getMetadata();

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
      localPath,
      remotePath,
      uploaded: true,
      url,
      metadata: {
        size: parseInt(String(metadata.size || 0)),
        contentType: metadata.contentType || detectedContentType,
        timeCreated: metadata.timeCreated || new Date().toISOString(),
      },
    };
  } catch (error) {
    return {
      localPath,
      remotePath,
      uploaded: false,
      metadata: { size: 0, contentType: '', timeCreated: '' },
      error: `Failed to upload file: ${error}`,
    };
  }
}

/**
 * MCP tool definition for firebase_storage_upload
 */
export const firebaseStorageUploadTool = {
  name: 'firebase_storage_upload',
  description:
    'Upload local file to Firebase Storage bucket. Maps to Unix: cp local remote. Uploads file from local filesystem to bucket path. Auto-detects contentType from extension if not specified. Use after creating/editing files locally (via Write tool) to sync to cloud storage.',
  inputSchema: {
    type: 'object',
    properties: {
      localPath: {
        type: 'string',
        description: 'Local file path to upload (e.g., "/tmp/logo.png" or "/tmp/data.csv")',
      },
      remotePath: {
        type: 'string',
        description: 'Destination path in bucket (e.g., "/bars/logo.png" or "/data/inventory.csv")',
      },
      contentType: {
        type: 'string',
        description: 'Optional: MIME type (e.g., "image/png"). Auto-detected from extension if not provided.',
      },
      bucketName: {
        type: 'string',
        description: 'Optional: specify bucket name (e.g., "my-app-backups"). Defaults to project default bucket.',
      },
    },
    required: ['localPath', 'remotePath'],
  },
};
