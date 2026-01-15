/**
 * firebase_storage_sync - Download directory from bucket to local
 * Maps to Unix: rsync remote local
 */

import { initializeFirebase } from '../../shared/firebase.js';
import admin from 'firebase-admin';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';

export interface FirebaseStorageSyncInput {
  remotePath: string; // Remote directory path in bucket
  localPath: string; // Local directory path
  overwrite?: boolean; // Overwrite existing files (default: true)
  bucketName?: string; // Optional: specify bucket name (defaults to project default bucket)
}

export interface FirebaseStorageSyncOutput {
  remotePath: string;
  localPath: string;
  filesDownloaded: number;
  files: Array<{
    remotePath: string;
    localPath: string;
    size: number;
  }>;
  error?: string;
}

/**
 * Download directory from Firebase Storage to local filesystem
 * Unix equivalent: rsync remote local
 */
export async function firebaseStorageSync(
  input: FirebaseStorageSyncInput
): Promise<FirebaseStorageSyncOutput> {
  const { remotePath, localPath, overwrite = true, bucketName } = input;

  const cleanRemotePath = remotePath.replace(/^\//, '').replace(/\/$/, '');

  try {
    await initializeFirebase();
    const bucket = bucketName ? admin.storage().bucket(bucketName) : admin.storage().bucket();

    // List all files in remote directory
    const [files] = await bucket.getFiles({
      prefix: cleanRemotePath,
    });

    if (files.length === 0) {
      return {
        remotePath,
        localPath,
        filesDownloaded: 0,
        files: [],
        error: `No files found in ${remotePath}`,
      };
    }

    // Download each file
    const downloadedFiles = [];

    for (const file of files) {
      // Calculate local file path (preserve directory structure)
      const relativePath = file.name.substring(cleanRemotePath.length).replace(/^\//, '');
      const localFilePath = join(localPath, relativePath);

      // Create directory if needed
      await mkdir(dirname(localFilePath), { recursive: true });

      // Download file
      await file.download({ destination: localFilePath });

      const [metadata] = await file.getMetadata();
      downloadedFiles.push({
        remotePath: '/' + file.name,
        localPath: localFilePath,
        size: parseInt(String(metadata.size || 0)),
      });
    }

    return {
      remotePath,
      localPath,
      filesDownloaded: downloadedFiles.length,
      files: downloadedFiles,
    };
  } catch (error) {
    return {
      remotePath,
      localPath,
      filesDownloaded: 0,
      files: [],
      error: `Failed to sync directory: ${error}`,
    };
  }
}

/**
 * MCP tool definition for firebase_storage_sync
 */
export const firebaseStorageSyncTool = {
  name: 'firebase_storage_sync',
  description:
    'Download entire directory from Firebase Storage to local filesystem. Maps to Unix: rsync remote local. Downloads all files in remote directory to local path, preserving folder structure. Use for bulk backup, local development with real data, or batch processing.',
  inputSchema: {
    type: 'object',
    properties: {
      remotePath: {
        type: 'string',
        description: 'Remote directory path in bucket (e.g., "/bars/photos/")',
      },
      localPath: {
        type: 'string',
        description: 'Local directory path (e.g., "/tmp/backup/")',
      },
      overwrite: {
        type: 'boolean',
        description: 'Overwrite existing local files (default: true)',
        default: true,
      },
      bucketName: {
        type: 'string',
        description: 'Optional: specify bucket name (e.g., "my-app-backups"). Defaults to project default bucket.',
      },
    },
    required: ['remotePath', 'localPath'],
  },
};
