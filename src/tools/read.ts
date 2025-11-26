/**
 * firestore_read - Read a single Firestore document
 * Supports timestamp serialization and schema validation
 */

import { getFirestore } from '../shared/firebase.js';
import { getConfig } from '../shared/config-loader.js';
import { matchPath } from '../shared/path-matcher.js';
import { serializeDocument, autoSerializeFirestoreTypes } from '../shared/type-serializer.js';
import { validateDocument, formatValidationResult } from '../shared/validation.js';
import { trackDocumentAccess } from '../shared/resource-discovery.js';
import type { ValidationMode } from '../shared/types.js';

export interface FirestoreReadInput {
  path: string;
  validate?: boolean;
  validationMode?: ValidationMode;
}

export interface FirestoreReadOutput {
  path: string;
  exists: boolean;
  data?: Record<string, unknown>;
  schema?: {
    matched: boolean;
    schemaPath?: string;
  };
  validation?: {
    valid: boolean;
    errors: number;
    warnings: number;
    details: string;
  };
}

/**
 * Read a single document from Firestore
 */
export async function firestoreRead(
  input: FirestoreReadInput
): Promise<FirestoreReadOutput> {
  const { path, validate = false, validationMode = 'warn' } = input;

  // Get Firestore instance
  const db = await getFirestore();

  // Read document
  const docRef = db.doc(path);
  const docSnap = await docRef.get();

  // Document doesn't exist
  if (!docSnap.exists) {
    return {
      path,
      exists: false,
      schema: { matched: false },
    };
  }

  // Get document data
  let data = docSnap.data() as Record<string, unknown>;

  // Try to match schema
  const config = getConfig();
  const schemaMatch = matchPath(path, config);

  // Serialize timestamps
  if (schemaMatch.matched && schemaMatch.definition?.timestampFields) {
    data = serializeDocument(data, schemaMatch.definition.timestampFields) as Record<
      string,
      unknown
    >;
  } else {
    // No schema - auto-serialize all Firestore types
    data = autoSerializeFirestoreTypes(data) as Record<string, unknown>;
  }

  // Build response
  const response: FirestoreReadOutput = {
    path,
    exists: true,
    data,
    schema: {
      matched: schemaMatch.matched,
      schemaPath: schemaMatch.schemaPath,
    },
  };

  // Validate if requested
  if (validate && schemaMatch.matched && schemaMatch.definition) {
    const effectiveMode =
      schemaMatch.definition.validationMode || validationMode;

    const validationResult = validateDocument(
      data,
      schemaMatch.definition.schema,
      effectiveMode
    );

    response.validation = {
      valid: validationResult.valid,
      errors: validationResult.errors.length,
      warnings: validationResult.warnings.length,
      details: formatValidationResult(validationResult),
    };
  } else if (validate && !schemaMatch.matched) {
    response.validation = {
      valid: true,
      errors: 0,
      warnings: 1,
      details: '⚠️ No schema found for this path - validation skipped',
    };
  }

  // Track document access for MRU cache
  trackDocumentAccess(path);

  return response;
}

/**
 * MCP tool definition for firestore_read
 */
export const firestoreReadTool = {
  name: 'firestore_read',
  description:
    'Read a single document from Firestore. Automatically serializes timestamps to ISO 8601 format. Optionally validates against schema if available.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          'Document path (e.g., "users/user-123" or "organizations/org-1/products/prod-456")',
      },
      validate: {
        type: 'boolean',
        description: 'Whether to validate document against schema (default: false)',
        default: false,
      },
      validationMode: {
        type: 'string',
        enum: ['strict', 'warn', 'permissive'],
        description:
          'Validation mode: strict (reject all issues), warn (show warnings), permissive (allow all)',
        default: 'warn',
      },
    },
    required: ['path'],
  },
};
