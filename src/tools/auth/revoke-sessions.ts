/**
 * firebase_auth_revoke_sessions - Revoke all user sessions (force sign-out everywhere)
 * Maps to SQL: UPDATE users SET tokensValidAfterTime = NOW() WHERE uid = X
 */

import { initializeFirebase } from '../../shared/firebase.js';
import admin from 'firebase-admin';

export interface FirebaseAuthRevokeSessionsInput {
  email?: string;
  uid?: string;
}

export interface FirebaseAuthRevokeSessionsOutput {
  uid: string;
  email?: string;
  revoked: boolean;
  tokensValidAfterTime: string;
  message: string;
  error?: string;
}

/**
 * Revoke all refresh tokens for a user (signs them out everywhere)
 * SQL equivalent: UPDATE users SET tokensValidAfterTime = NOW() WHERE uid = X
 */
export async function firebaseAuthRevokeSessions(
  input: FirebaseAuthRevokeSessionsInput
): Promise<FirebaseAuthRevokeSessionsOutput> {
  const { email, uid } = input;

  // Validate input
  if (!email && !uid) {
    return {
      uid: '',
      revoked: false,
      tokensValidAfterTime: '',
      message: '',
      error: 'Must provide either email or uid',
    };
  }

  try {
    // Initialize Firebase if needed
    await initializeFirebase();
    const auth = admin.auth();

    // Get user first
    let userRecord: admin.auth.UserRecord;
    if (uid) {
      userRecord = await auth.getUser(uid);
    } else {
      userRecord = await auth.getUserByEmail(email!);
    }

    // Revoke all refresh tokens
    await auth.revokeRefreshTokens(userRecord.uid);

    // Get updated user to retrieve tokensValidAfterTime
    const updatedUser = await auth.getUser(userRecord.uid);

    return {
      uid: updatedUser.uid,
      email: updatedUser.email || undefined,
      revoked: true,
      tokensValidAfterTime: updatedUser.tokensValidAfterTime || new Date().toISOString(),
      message: `All sessions revoked for ${updatedUser.email || updatedUser.uid}. User must sign in again.`,
    };
  } catch (error: any) {
    if (error.code === 'auth/user-not-found') {
      return {
        uid: '',
        email: email,
        revoked: false,
        tokensValidAfterTime: '',
        message: '',
        error: `User not found: ${email || uid}`,
      };
    }

    return {
      uid: '',
      revoked: false,
      tokensValidAfterTime: '',
      message: '',
      error: `Failed to revoke sessions: ${error}`,
    };
  }
}

/**
 * MCP tool definition for firebase_auth_revoke_sessions
 */
export const firebaseAuthRevokeSessionsTool = {
  name: 'firebase_auth_revoke_sessions',
  description:
    'SQL-style session revocation. Maps to: UPDATE users SET tokensValidAfterTime = NOW() WHERE uid = X. Revokes all refresh tokens for a Firebase Auth user, forcing them to sign out on all devices. User must sign in again to get new tokens. Use for security (compromised account, force logout) or administrative actions (suspend access temporarily).',
  inputSchema: {
    type: 'object',
    properties: {
      email: {
        type: 'string',
        description: 'User email to revoke sessions for (provide email OR uid)',
      },
      uid: {
        type: 'string',
        description: 'User uid to revoke sessions for (provide email OR uid)',
      },
    },
  },
};
