/**
 * firebase_auth_delete_user - SQL-style user deletion
 * Maps to SQL: DELETE FROM users WHERE email=X OR uid=X
 */

import { initializeFirebase } from '../../shared/firebase.js';
import admin from 'firebase-admin';

export interface FirebaseAuthDeleteUserInput {
  email?: string;
  uid?: string;
}

export interface FirebaseAuthDeleteUserOutput {
  uid: string;
  email?: string;
  deleted: boolean;
  deletedUser?: {
    displayName?: string;
    customClaims?: Record<string, unknown>;
    creationTime: string;
  };
  error?: string;
}

/**
 * Delete Firebase Auth user by email or uid
 * SQL equivalent: DELETE FROM users WHERE email=X OR uid=X
 */
export async function firebaseAuthDeleteUser(
  input: FirebaseAuthDeleteUserInput
): Promise<FirebaseAuthDeleteUserOutput> {
  const { email, uid } = input;

  // Validate input
  if (!email && !uid) {
    return {
      uid: '',
      deleted: false,
      error: 'Must provide either email or uid',
    };
  }

  try {
    // Initialize Firebase if needed
    await initializeFirebase();
    const auth = admin.auth();

    // Get user first (to return what was deleted)
    let userRecord: admin.auth.UserRecord;
    if (uid) {
      userRecord = await auth.getUser(uid);
    } else {
      userRecord = await auth.getUserByEmail(email!);
    }

    // Delete user
    await auth.deleteUser(userRecord.uid);

    return {
      uid: userRecord.uid,
      email: userRecord.email,
      deleted: true,
      deletedUser: {
        displayName: userRecord.displayName,
        customClaims: userRecord.customClaims,
        creationTime: userRecord.metadata.creationTime,
      },
    };
  } catch (error: any) {
    if (error.code === 'auth/user-not-found') {
      return {
        uid: '',
        email: email,
        deleted: false,
        error: `User not found: ${email || uid}`,
      };
    }

    return {
      uid: '',
      deleted: false,
      error: `Failed to delete user: ${error}`,
    };
  }
}

/**
 * MCP tool definition for firebase_auth_delete_user
 */
export const firebaseAuthDeleteUserTool = {
  name: 'firebase_auth_delete_user',
  description:
    'SQL-style user deletion. Maps to: DELETE FROM users WHERE email=X OR uid=X. Permanently delete Firebase Auth user by email or uid. IRREVERSIBLE - user authentication and data will be permanently removed. Returns details of deleted user for confirmation.',
  inputSchema: {
    type: 'object',
    properties: {
      email: {
        type: 'string',
        description: 'User email to delete (provide email OR uid)',
      },
      uid: {
        type: 'string',
        description: 'User uid to delete (provide email OR uid)',
      },
    },
  },
};
