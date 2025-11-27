/**
 * firebase_auth_create_user - SQL-style user creation
 * Maps to SQL: INSERT INTO users (email, password, ...) VALUES (...)
 */

import { initializeFirebase } from '../../shared/firebase.js';
import admin from 'firebase-admin';

export interface FirebaseAuthCreateUserInput {
  email: string;
  password?: string;
  displayName?: string;
  phoneNumber?: string;
  emailVerified?: boolean;
  disabled?: boolean;
  customClaims?: Record<string, unknown>;
}

export interface FirebaseAuthCreateUserOutput {
  uid: string;
  email: string;
  displayName?: string;
  phoneNumber?: string;
  emailVerified: boolean;
  disabled: boolean;
  customClaims?: Record<string, unknown>;
  created: boolean;
  error?: string;
}

/**
 * Create a new Firebase Auth user
 * SQL equivalent: INSERT INTO users (email, password, ...) VALUES (...)
 */
export async function firebaseAuthCreateUser(
  input: FirebaseAuthCreateUserInput
): Promise<FirebaseAuthCreateUserOutput> {
  const { email, password, displayName, phoneNumber, emailVerified, disabled, customClaims } = input;

  try {
    // Initialize Firebase if needed
    await initializeFirebase();
    const auth = admin.auth();

    // Create user with provided properties
    const createRequest: admin.auth.CreateRequest = {
      email,
      emailVerified: emailVerified ?? false,
      disabled: disabled ?? false,
    };

    if (password) createRequest.password = password;
    if (displayName) createRequest.displayName = displayName;
    if (phoneNumber) createRequest.phoneNumber = phoneNumber;

    const userRecord = await auth.createUser(createRequest);

    // Set custom claims if provided
    if (customClaims && Object.keys(customClaims).length > 0) {
      await auth.setCustomUserClaims(userRecord.uid, customClaims);
    }

    // Fetch updated user to get claims
    const updatedUser = await auth.getUser(userRecord.uid);

    return {
      uid: updatedUser.uid,
      email: updatedUser.email!,
      displayName: updatedUser.displayName,
      phoneNumber: updatedUser.phoneNumber,
      emailVerified: updatedUser.emailVerified,
      disabled: updatedUser.disabled,
      customClaims: updatedUser.customClaims,
      created: true,
    };
  } catch (error) {
    return {
      uid: '',
      email,
      emailVerified: false,
      disabled: false,
      created: false,
      error: `Failed to create user: ${error}`,
    };
  }
}

/**
 * MCP tool definition for firebase_auth_create_user
 */
export const firebaseAuthCreateUserTool = {
  name: 'firebase_auth_create_user',
  description:
    'SQL-style user creation. Maps to: INSERT INTO users (email, password, displayName, customClaims) VALUES (...). Creates new Firebase Auth user with optional properties. Use customClaims to set authorization data on creation (e.g., {admin: true, orgId: "org_123"}). No client-side rate limiting.',
  inputSchema: {
    type: 'object',
    properties: {
      email: {
        type: 'string',
        description: 'User email address (required)',
      },
      password: {
        type: 'string',
        description: 'User password (optional - can be set later)',
      },
      displayName: {
        type: 'string',
        description: 'User display name (optional)',
      },
      phoneNumber: {
        type: 'string',
        description: 'User phone number in E.164 format (optional, e.g., +15555551234)',
      },
      emailVerified: {
        type: 'boolean',
        description: 'Whether email is verified (default: false)',
        default: false,
      },
      disabled: {
        type: 'boolean',
        description: 'Whether account is disabled (default: false)',
        default: false,
      },
      customClaims: {
        type: 'object',
        description: 'Custom claims for authorization (optional). Example: {admin: true, orgId: "org_123", role: "manager"}',
      },
    },
    required: ['email'],
  },
};
