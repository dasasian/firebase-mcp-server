/**
 * firebase_auth_list_users - SQL-style user listing with filtering
 * Maps to SQL: SELECT * FROM users WHERE ... ORDER BY ... LIMIT n
 */

import { initializeFirebase } from '../../shared/firebase.js';
import admin from 'firebase-admin';

export interface FirebaseAuthListUsersInput {
  where?: Array<{
    field: string;
    operator: '==' | '!=' | 'LIKE';
    value: unknown;
  }>;
  limit?: number;
  maxResults?: number; // Max users to fetch before filtering (default: all)
}

export interface FirebaseAuthListUsersOutput {
  users: Array<{
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
    };
  }>;
  totalCount: number;
}

/**
 * List Firebase Auth users with client-side filtering
 * SQL equivalent: SELECT * FROM users WHERE ... LIMIT n
 */
export async function firebaseAuthListUsers(
  input: FirebaseAuthListUsersInput = {}
): Promise<FirebaseAuthListUsersOutput> {
  const { where = [], limit, maxResults } = input;

  try {
    // Initialize Firebase if needed
    await initializeFirebase();
    const auth = admin.auth();

    // Fetch all users (paginated automatically)
    const allUsers: admin.auth.UserRecord[] = [];
    let pageToken: string | undefined;
    let fetchedCount = 0;

    do {
      const listResult = await auth.listUsers(1000, pageToken);
      allUsers.push(...listResult.users);
      pageToken = listResult.pageToken;
      fetchedCount += listResult.users.length;

      // Stop if we've fetched maxResults
      if (maxResults && fetchedCount >= maxResults) {
        break;
      }
    } while (pageToken);

    // Apply client-side filtering
    let filteredUsers = allUsers;

    for (const clause of where) {
      filteredUsers = filteredUsers.filter(user => matchesWhereClause(user, clause));
    }

    // Apply limit
    if (limit && limit > 0) {
      filteredUsers = filteredUsers.slice(0, limit);
    }

    // Map to output format
    const users = filteredUsers.map(user => ({
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      phoneNumber: user.phoneNumber,
      emailVerified: user.emailVerified,
      disabled: user.disabled,
      customClaims: user.customClaims,
      metadata: {
        creationTime: user.metadata.creationTime,
        lastSignInTime: user.metadata.lastSignInTime,
      },
    }));

    return {
      users,
      totalCount: users.length,
    };
  } catch (error) {
    throw new Error(`Failed to list users: ${error}`);
  }
}

/**
 * Check if user matches a WHERE clause (client-side filtering)
 */
function matchesWhereClause(
  user: admin.auth.UserRecord,
  clause: { field: string; operator: string; value: unknown }
): boolean {
  const fieldValue = getNestedValue(user, clause.field);

  switch (clause.operator) {
    case '==':
      return fieldValue === clause.value;

    case '!=':
      return fieldValue !== clause.value;

    case 'LIKE':
      if (typeof fieldValue !== 'string' || typeof clause.value !== 'string') {
        return false;
      }
      // Convert SQL LIKE pattern to regex
      const pattern = clause.value
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
        .replace(/%/g, '.*') // % -> .*
        .replace(/_/g, '.'); // _ -> .
      const regex = new RegExp(`^${pattern}$`, 'i');
      return regex.test(fieldValue);

    default:
      return false;
  }
}

/**
 * Get nested value from object using dot notation (e.g., "customClaims.admin")
 */
function getNestedValue(obj: any, path: string): unknown {
  const parts = path.split('.');
  let current: any = obj;

  for (const part of parts) {
    if (current && typeof current === 'object') {
      current = current[part];
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * MCP tool definition for firebase_auth_list_users
 */
export const firebaseAuthListUsersTool = {
  name: 'firebase_auth_list_users',
  description:
    'SQL-style user listing with filtering. Maps to: SELECT * FROM users WHERE ... LIMIT n. Lists Firebase Auth users with client-side filtering support. Supports email LIKE patterns (%@domain.com) and customClaims matching ({admin: true}). Auto-fetches all pages. Use for discovery before updating users.',
  inputSchema: {
    type: 'object',
    properties: {
      where: {
        type: 'array',
        description: 'WHERE clauses for filtering. Supports email LIKE patterns and customClaims. Example: [{field: "email", operator: "LIKE", value: "%@colorado.com"}]',
        items: {
          type: 'object',
          properties: {
            field: {
              type: 'string',
              description: 'Field path (e.g., "email", "customClaims.admin", "disabled")',
            },
            operator: {
              type: 'string',
              enum: ['==', '!=', 'LIKE'],
              description: 'Comparison operator. LIKE supports % (any chars) and _ (single char)',
            },
            value: {
              description: 'Value to compare against',
            },
          },
          required: ['field', 'operator', 'value'],
        },
      },
      limit: {
        type: 'number',
        description: 'LIMIT: Maximum number of users to return after filtering',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum users to fetch before filtering (optional, default: fetch all)',
      },
    },
  },
};
