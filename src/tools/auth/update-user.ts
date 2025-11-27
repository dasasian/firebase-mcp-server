/**
 * firebase_auth_update_user - SQL-style user update with claims merging
 * Maps to SQL: UPDATE users SET customClaims.admin=true, email=X WHERE uid=Y
 */

import { initializeFirebase } from '../../shared/firebase.js';
import admin from 'firebase-admin';

export interface FirebaseAuthUpdateUserInput {
  email?: string; // Identify user by email
  uid?: string;   // Or by uid
  set: Record<string, unknown>; // Properties to update (SQL SET clause)
}

export interface FirebaseAuthUpdateUserOutput {
  uid: string;
  email?: string;
  updated: boolean;
  fieldsUpdated: string[];
  previousClaims?: Record<string, unknown>;
  newClaims?: Record<string, unknown>;
  error?: string;
}

/**
 * Update Firebase Auth user properties and/or customClaims
 * SQL equivalent: UPDATE users SET field1=value1, field2=value2 WHERE ...
 */
export async function firebaseAuthUpdateUser(
  input: FirebaseAuthUpdateUserInput
): Promise<FirebaseAuthUpdateUserOutput> {
  const { email, uid, set } = input;

  // Validate input
  if (!email && !uid) {
    return {
      uid: '',
      updated: false,
      fieldsUpdated: [],
      error: 'Must provide either email or uid',
    };
  }

  if (!set || Object.keys(set).length === 0) {
    return {
      uid: '',
      updated: false,
      fieldsUpdated: [],
      error: 'Must provide fields to update in "set" parameter',
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

    // Separate customClaims updates from other property updates
    const claimsUpdates: Record<string, unknown> = {};
    const propertyUpdates: admin.auth.UpdateRequest = {};
    const fieldsUpdated: string[] = [];

    for (const [key, value] of Object.entries(set)) {
      // Handle dot notation for customClaims (e.g., "customClaims.admin")
      if (key.startsWith('customClaims.')) {
        const claimKey = key.substring('customClaims.'.length);
        claimsUpdates[claimKey] = value;
        fieldsUpdated.push(key);
      } else if (key === 'customClaims') {
        // Direct customClaims object
        Object.assign(claimsUpdates, value as Record<string, unknown>);
        fieldsUpdated.push(key);
      } else {
        // Other properties (email, password, displayName, etc.)
        (propertyUpdates as any)[key] = value;
        fieldsUpdated.push(key);
      }
    }

    // Update regular properties if any
    if (Object.keys(propertyUpdates).length > 0) {
      await auth.updateUser(userRecord.uid, propertyUpdates);
    }

    // Update customClaims if any (with merging)
    let newClaims: Record<string, unknown> | undefined;
    if (Object.keys(claimsUpdates).length > 0) {
      const previousClaims = userRecord.customClaims || {};

      // Merge with existing claims
      const merged = { ...previousClaims, ...claimsUpdates };

      // Remove null values (Firebase deletion pattern)
      Object.keys(merged).forEach(k => {
        if (merged[k] === null) {
          delete merged[k];
        }
      });

      await auth.setCustomUserClaims(userRecord.uid, merged);
      newClaims = merged;
    }

    // Get updated user
    const updatedUser = await auth.getUser(userRecord.uid);

    return {
      uid: updatedUser.uid,
      email: updatedUser.email,
      updated: true,
      fieldsUpdated,
      previousClaims: userRecord.customClaims,
      newClaims: newClaims || updatedUser.customClaims,
    };
  } catch (error: any) {
    if (error.code === 'auth/user-not-found') {
      return {
        uid: '',
        updated: false,
        fieldsUpdated: [],
        error: `User not found: ${email || uid}`,
      };
    }

    return {
      uid: '',
      updated: false,
      fieldsUpdated: [],
      error: `Failed to update user: ${error}`,
    };
  }
}

/**
 * MCP tool definition for firebase_auth_update_user
 */
export const firebaseAuthUpdateUserTool = {
  name: 'firebase_auth_update_user',
  description:
    'SQL-style user update with claims merging. Maps to: UPDATE users SET customClaims.admin=true, email=X WHERE uid=Y. Updates Firebase Auth user properties and/or customClaims. Merges customClaims (doesn\'t replace) - only specified fields are updated. Use dot notation for claims: {"customClaims.admin": true} or direct object: {"customClaims": {admin: true}}. Set to null to remove: {"customClaims.admin": null}. Can also update email, password, displayName, disabled.',
  inputSchema: {
    type: 'object',
    properties: {
      email: {
        type: 'string',
        description: 'User email to identify which user to update (provide email OR uid)',
      },
      uid: {
        type: 'string',
        description: 'User uid to identify which user to update (provide email OR uid)',
      },
      set: {
        type: 'object',
        description: 'Fields to update (SQL SET clause). For customClaims use dot notation: {"customClaims.admin": true, "customClaims.orgId": "org_123"} or direct: {"customClaims": {admin: true}}. Remove claim with null: {"customClaims.admin": null}. Other fields: email, password, displayName, phoneNumber, disabled.',
      },
    },
    required: ['set'],
  },
};
