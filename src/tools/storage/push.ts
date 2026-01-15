/**
 * firebase_storage_push - Upload directory from local to bucket
 * Maps to Unix: rsync local remote
 */

import { initializeFirebase } from '../../shared/firebase.js';
import admin from 'firebase-admin';
import { readdir, readFile, stat } from 'fs/promises';
import { join, extname, relative } from 'path';

export interface FirebaseStoragePushInput {
  localPath: string; // Local directory path
  remotePath: string; // Remote directory path in bucket
  pattern?: string; // Optional: only upload matching files (e.g., "*.json")
  bucketName?: string; // Optional: specify bucket name (defaults to project default bucket)
}

export interface FirebaseStoragePushOutput {
  localPath: string;
  remotePath: string;
  filesUploaded: number;
  files: Array<{
    localPath: string;
    remotePath: string;
    size: number;
  }>;
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
 * Recursively list all files in directory
 */
async function listFiles(dirPath: string, pattern?: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentPath: string) {
    const entries = await readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        // Apply pattern filter if specified
        if (pattern) {
          const regexPattern = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.');
          const regex = new RegExp(`^${regexPattern}$`, 'i');
          if (!regex.test(entry.name)) continue;
        }

        files.push(fullPath);
      }
    }
  }

  await walk(dirPath);
  return files;
}

/**
 * Upload entire directory from local filesystem to Firebase Storage
 * Unix equivalent: rsync local remote
 */
export async function firebaseStoragePush(
  input: FirebaseStoragePushInput
): Promise<FirebaseStoragePushOutput> {
  const { localPath, remotePath, pattern, bucketName } = input;

  const cleanRemotePath = remotePath.replace(/^\//, '').replace(/\/$/, '');

  try {
    await initializeFirebase();
    const bucket = bucketName ? admin.storage().bucket(bucketName) : admin.storage().bucket();

    // List all files in local directory
    const files = await listFiles(localPath, pattern);

    if (files.length === 0) {
      return {
        localPath,
        remotePath,
        filesUploaded: 0,
        files: [],
        error: pattern
          ? `No files matching pattern "${pattern}" found in ${localPath}`
          : `No files found in ${localPath}`,
      };
    }

    // Upload each file
    const uploadedFiles = [];

    for (const localFilePath of files) {
      // Calculate remote file path (preserve directory structure)
      const relativePath = relative(localPath, localFilePath);
      const remoteFilePath = cleanRemotePath ? join(cleanRemotePath, relativePath) : relativePath;

      // Read file
      const fileContent = await readFile(localFilePath);
      const fileStats = await stat(localFilePath);

      // Detect content type
      const contentType = detectContentType(localFilePath);

      // Upload file
      const file = bucket.file(remoteFilePath);
      await file.save(fileContent, {
        contentType,
      });

      uploadedFiles.push({
        localPath: localFilePath,
        remotePath: '/' + remoteFilePath,
        size: fileStats.size,
      });
    }

    return {
      localPath,
      remotePath,
      filesUploaded: uploadedFiles.length,
      files: uploadedFiles,
    };
  } catch (error) {
    return {
      localPath,
      remotePath,
      filesUploaded: 0,
      files: [],
      error: `Failed to push directory: ${error}`,
    };
  }
}

/**
 * MCP tool definition for firebase_storage_push
 */
export const firebaseStoragePushTool = {
  name: 'firebase_storage_push',
  description:
    'Upload entire directory from local filesystem to Firebase Storage bucket. Maps to Unix: rsync local remote. Uploads all files in local directory to bucket path, preserving folder structure. Supports pattern filtering (e.g., "*.json" to upload only JSON files). Use for bulk upload, backup, or publishing processed files.',
  inputSchema: {
    type: 'object',
    properties: {
      localPath: {
        type: 'string',
        description: 'Local directory path (e.g., "/tmp/processed/")',
      },
      remotePath: {
        type: 'string',
        description: 'Remote directory path in bucket (e.g., "/data/archive/")',
      },
      pattern: {
        type: 'string',
        description: 'Optional: only upload files matching pattern. Example: "*.json" or "*.png"',
      },
      bucketName: {
        type: 'string',
        description: 'Optional: specify bucket name (e.g., "my-app-backups"). Defaults to project default bucket.',
      },
    },
    required: ['localPath', 'remotePath'],
  },
};
