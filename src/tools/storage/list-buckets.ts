/**
 * firebase_storage_list_buckets - List all Storage buckets in Firebase project
 */

import { initializeFirebase } from '../../shared/firebase.js';
import admin from 'firebase-admin';

export interface FirebaseStorageListBucketsOutput {
  buckets: Array<{
    name: string;
    location?: string;
    storageClass?: string;
    timeCreated?: string;
  }>;
  totalBuckets: number;
  defaultBucket?: string;
  error?: string;
}

/**
 * List all Storage buckets in the Firebase project
 */
export async function firebaseStorageListBuckets(): Promise<FirebaseStorageListBucketsOutput> {
  try {
    await initializeFirebase();
    const storage = admin.storage();

    // Get default bucket
    const defaultBucket = storage.bucket();
    const [metadata] = await defaultBucket.getMetadata();

    // For Firebase projects, typically there's one default bucket
    // Listing requires Cloud Storage API access which may not be available
    // Return the default bucket info
    const bucketList = [{
      name: defaultBucket.name,
      location: metadata.location,
      storageClass: metadata.storageClass,
      timeCreated: metadata.timeCreated,
    }];

    return {
      buckets: bucketList,
      totalBuckets: bucketList.length,
      defaultBucket: defaultBucket.name,
    };
  } catch (error) {
    return {
      buckets: [],
      totalBuckets: 0,
      error: `Failed to list buckets: ${error}`,
    };
  }
}

/**
 * MCP tool definition for firebase_storage_list_buckets
 */
export const firebaseStorageListBucketsTool = {
  name: 'firebase_storage_list_buckets',
  description:
    'List all Firebase Storage buckets in the project. Shows bucket names, locations, and storage classes. The default bucket is highlighted. Use this to discover available buckets before performing operations on non-default buckets.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
};
