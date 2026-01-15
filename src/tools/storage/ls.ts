/**
 * firebase_storage_ls - List files in storage bucket path
 * Maps to Unix: ls -la /path
 */

import { initializeFirebase } from '../../shared/firebase.js';
import admin from 'firebase-admin';

export interface FirebaseStorageLsInput {
  path?: string; // Bucket path (default: root "/")
  recursive?: boolean; // List subdirectories recursively
  bucketName?: string; // Optional: specify bucket name (defaults to project default bucket)
}

export interface FirebaseStorageLsOutput {
  path: string;
  files: Array<{
    name: string;
    fullPath: string;
    size: number;
    contentType: string;
    timeCreated: string;
    updated: string;
    bucket: string;
    isPublic?: boolean;
    publicUrl?: string;
  }>;
  totalFiles: number;
  error?: string;
}

/**
 * List files in Firebase Storage bucket
 * Unix equivalent: ls -la /path
 */
export async function firebaseStorageLs(
  input: FirebaseStorageLsInput = {}
): Promise<FirebaseStorageLsOutput> {
  const { path = '', recursive = false, bucketName } = input;

  try {
    await initializeFirebase();
    const bucket = bucketName ? admin.storage().bucket(bucketName) : admin.storage().bucket();

    // List files with optional prefix
    const [files] = await bucket.getFiles({
      prefix: path ? path.replace(/^\//, '') : undefined,
      delimiter: recursive ? undefined : '/',
    });

    const fileList = await Promise.all(
      files.map(async (file) => {
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
          // Not public, ignore error
        }

        return {
          name: file.name.split('/').pop() || file.name,
          fullPath: '/' + file.name,
          size: parseInt(String(metadata.size || 0)),
          contentType: metadata.contentType || 'application/octet-stream',
          timeCreated: metadata.timeCreated || '',
          updated: metadata.updated || '',
          bucket: bucket.name,
          isPublic,
          publicUrl,
        };
      })
    );

    return {
      path: '/' + (path || ''),
      files: fileList,
      totalFiles: fileList.length,
    };
  } catch (error) {
    return {
      path: '/' + (path || ''),
      files: [],
      totalFiles: 0,
      error: `Failed to list files: ${error}`,
    };
  }
}

/**
 * MCP tool definition for firebase_storage_ls
 */
export const firebaseStorageLsTool = {
  name: 'firebase_storage_ls',
  description:
    'List files in Firebase Storage bucket. Maps to Unix: ls -la /path. Lists files with metadata including name, size, contentType, timestamps, and public URLs if available. Use for discovering files before read/download operations.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Bucket path to list (e.g., "/images/bars" or "/"). Default: root',
      },
      recursive: {
        type: 'boolean',
        description: 'List subdirectories recursively (default: false)',
        default: false,
      },
      bucketName: {
        type: 'string',
        description: 'Optional: specify bucket name (e.g., "my-app-backups"). Defaults to project default bucket.',
      },
    },
  },
};
