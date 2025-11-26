/**
 * firestore_validate - Validate Firestore document against schema
 * Requires schema to be defined for the document path
 */

import { getFirestore } from '../shared/firebase.js';
import { getConfig } from '../shared/config-loader.js';
import { matchPath } from '../shared/path-matcher.js';
import { serializeDocument, autoSerializeFirestoreTypes } from '../shared/type-serializer.js';
import { validateDocument, formatValidationResult } from '../shared/validation.js';
import type { ValidationMode } from '../shared/types.js';

export interface FirestoreValidateInput {
  path: string;
  mode?: ValidationMode;
}

export interface FirestoreValidateOutput {
  path: string;
  schemaPath?: string;
  valid: boolean;
  errors: number;
  warnings: number;
  details: string;
}

/**
 * Validate document against its schema
 */
export async function firestoreValidate(
  input: FirestoreValidateInput
): Promise<FirestoreValidateOutput> {
  const { path, mode = 'warn' } = input;

  // Get Firestore instance
  const db = await getFirestore();

  // Read document
  const docRef = db.doc(path);
  const docSnap = await docRef.get();

  if (!docSnap.exists) {
    return {
      path,
      valid: false,
      errors: 1,
      warnings: 0,
      details: '❌ Document does not exist',
    };
  }

  // Get document data
  let data = docSnap.data() as Record<string, unknown>;

  // Match schema
  const config = getConfig();
  const schemaMatch = matchPath(path, config);

  if (!schemaMatch.matched || !schemaMatch.definition) {
    return {
      path,
      valid: false,
      errors: 1,
      warnings: 0,
      details: `❌ No schema defined for path: ${path}\n\nValidation requires a schema. Add one to your config file.`,
    };
  }

  // Serialize timestamps before validation
  if (schemaMatch.definition.timestampFields) {
    data = serializeDocument(data, schemaMatch.definition.timestampFields) as Record<
      string,
      unknown
    >;
  } else {
    data = autoSerializeFirestoreTypes(data) as Record<string, unknown>;
  }

  // Validate
  const effectiveMode = schemaMatch.definition.validationMode || mode;
  const validationResult = validateDocument(
    data,
    schemaMatch.definition.schema,
    effectiveMode
  );

  return {
    path,
    schemaPath: schemaMatch.schemaPath,
    valid: validationResult.valid,
    errors: validationResult.errors.length,
    warnings: validationResult.warnings.length,
    details: formatValidationResult(validationResult),
  };
}

/**
 * MCP tool definition for firestore_validate
 */
export const firestoreValidateTool = {
  name: 'firestore_validate',
  description:
    'Validate a Firestore document against its schema. Shows detailed errors, warnings, and field status breakdown (official/experimental/legacy/unknown). Requires schema to be defined.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Document path to validate (e.g., "users/user-123")',
      },
      mode: {
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
