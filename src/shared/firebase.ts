/**
 * Firebase Admin SDK initialization
 * Lazy initialization with service account credentials
 */

import admin from 'firebase-admin';
import { readFile } from 'fs/promises';
import { Logging } from '@google-cloud/logging';

let initialized = false;
let cachedServiceAccountPath: string | undefined;
let loggingClient: Logging | undefined;

/**
 * Initialize Firebase Admin SDK
 * Uses environment variables:
 * - FIREBASE_PROJECT_ID (required)
 * - FIREBASE_SERVICE_ACCOUNT_PATH (optional, for service account auth)
 * - GOOGLE_APPLICATION_CREDENTIALS (optional, alternative to service account path)
 */
export async function initializeFirebase(): Promise<void> {
  if (initialized) {
    return;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new Error(
      'FIREBASE_PROJECT_ID environment variable is required'
    );
  }

  try {
    // Check if service account path is provided
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

    if (serviceAccountPath) {
      // Load service account from file
      const serviceAccountContent = await readFile(serviceAccountPath, 'utf-8');
      const serviceAccount = JSON.parse(serviceAccountContent);

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId,
      });

      cachedServiceAccountPath = serviceAccountPath;
      console.error(`[Firebase] Initialized with service account from ${serviceAccountPath}`);
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      cachedServiceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      // Use application default credentials
      admin.initializeApp({
        projectId,
      });

      console.error('[Firebase] Initialized with application default credentials');
    } else {
      // Try to use application default credentials without explicit path
      admin.initializeApp({
        projectId,
      });

      console.error('[Firebase] Initialized with default credentials');
    }

    initialized = true;
  } catch (error) {
    console.error('[Firebase] Initialization failed:', error);
    throw new Error(`Failed to initialize Firebase: ${error}`);
  }
}

/**
 * Get Firestore instance (initializes Firebase if needed)
 */
export async function getFirestore(): Promise<admin.firestore.Firestore> {
  if (!initialized) {
    await initializeFirebase();
  }

  return admin.firestore();
}

/**
 * Check if Firebase is initialized
 */
export function isInitialized(): boolean {
  return initialized;
}

/**
 * Get the service account path used for initialization
 */
export function getServiceAccountPath(): string | undefined {
  return cachedServiceAccountPath;
}

/**
 * Get Cloud Logging instance (initializes Firebase if needed)
 */
export async function getLogging(): Promise<Logging> {
  if (!initialized) {
    await initializeFirebase();
  }

  if (!loggingClient) {
    loggingClient = new Logging(
      cachedServiceAccountPath ? { keyFilename: cachedServiceAccountPath } : undefined
    );
  }

  return loggingClient;
}
