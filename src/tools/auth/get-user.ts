/**
 * firebase_auth_get_user - SQL-style single user lookup
 * Maps to SQL: SELECT * FROM users WHERE email=X OR uid=X
 */

import { initializeFirebase } from '../../shared/firebase.js';
import admin from 'firebase-admin';

export interface FirebaseAuthGetUserInput {
  email?: string;
  uid?: string;
}

export interface FirebaseAuthGetUserOutput {
  uid: string;
  email?: string;
  displayName?: string;
  phoneNumber?: string;
  emailVerified: boolean;
  disabled: boolean;
  customClaims?: Record<string, unknown>;
  metadata: {
    creationTime: string;
    lastSignInTime?: string;
    lastRefreshTime?: string;
  };
  exists: boolean;
  error?: string;
}

/**
 * Get Firebase Auth user by email or uid
 * SQL equivalent: SELECT * FROM users WHERE email=X OR uid=X
 */
export async function firebaseAuthGetUser(
  input: FirebaseAuthGetUserInput
): Promise<FirebaseAuthGetUserOutput> {
  const { email, uid } = input;

  // Validate input
  if (!email && !uid) {
    return {
      uid: '',
      emailVerified: false,
      disabled: false,
      exists: false,
      error: 'Must provide either email or uid',
      metadata: { creationTime: '' },
    };
  }

  try {
    // Initialize Firebase if needed
    await initializeFirebase();
    const auth = admin.auth();

    // Lookup user
    let userRecord: admin.auth.UserRecord;
    if (uid) {
      userRecord = await auth.getUser(uid);
    } else {
      userRecord = await auth.getUserByEmail(email!);
    }

    return {
      uid: userRecord.uid,
      email: userRecord.email || undefined,
      displayName: userRecord.displayName || undefined,
      phoneNumber: userRecord.phoneNumber || undefined,
      emailVerified: userRecord.emailVerified,
      disabled: userRecord.disabled,
      customClaims: userRecord.customClaims,
      metadata: {
        creationTime: userRecord.metadata.creationTime,
        lastSignInTime: userRecord.metadata.lastSignInTime || undefined,
        lastRefreshTime: userRecord.metadata.lastRefreshTime || undefined,
      },
      exists: true,
    };
  } catch (error: any) {
    if (error.code === 'auth/user-not-found') {
      return {
        uid: '',
        email: email,
        emailVerified: false,
        disabled: false,
        exists: false,
        error: `User not found: ${email || uid}`,
        metadata: { creationTime: '' },
      };
    }

    return {
      uid: '',
      emailVerified: false,
      disabled: false,
      exists: false,
      error: `Failed to get user: ${error}`,
      metadata: { creationTime: '' },
    };
  }
}

/**
 * MCP tool definition for firebase_auth_get_user
 */
export const firebaseAuthGetUserTool = {
  name: 'firebase_auth_get_user',
  description:
    'SQL-style single user lookup. Maps to: SELECT * FROM users WHERE email=X OR uid=X. Get Firebase Auth user by email or uid. Returns full user data including customClaims (authorization data), account status, and metadata. Use before updating to see current state.',
  inputSchema: {
    type: 'object',
    properties: {
      email: {
        type: 'string',
        description: 'User email address (provide email OR uid)',
      },
      uid: {
        type: 'string',
        description: 'User unique ID (provide email OR uid)',
      },
    },
  },
};
