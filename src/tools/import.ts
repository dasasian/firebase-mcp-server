/**
 * firestore_import - Import document data to Firestore
 * Dry-run by default, shows diff before importing
 */

import admin from 'firebase-admin';
import { getFirestore } from '../shared/firebase.js';
import { getConfig } from '../shared/config-loader.js';
import { matchPath } from '../shared/path-matcher.js';
import { deserializeDocument } from '../shared/type-serializer.js';
import { validateDocument, formatValidationResult } from '../shared/validation.js';
import { calculateDiff, formatDiff, hasChanges } from '../shared/diff.js';
import type { ValidationMode } from '../shared/types.js';

export interface FirestoreImportInput {
  path: string;
  data: Record<string, unknown>;
  dryRun?: boolean;
  validate?: boolean;
  validationMode?: ValidationMode;
}

export interface FirestoreImportOutput {
  path: string;
  dryRun: boolean;
  executed: boolean;
  changes: {
    hasChanges: boolean;
    diff?: string;
  };
  validation?: {
    valid: boolean;
    details: string;
  };
  error?: string;
}

/**
 * Import document data to Firestore
 */
export async function firestoreImport(
  input: FirestoreImportInput
): Promise<FirestoreImportOutput> {
  const {
    path,
    data,
    dryRun = true,
    validate = true,
    validationMode = 'warn',
  } = input;

  // Get Firestore instance
  const db = await getFirestore();
  const docRef = db.doc(path);

  // Match schema
  const config = getConfig();
  const schemaMatch = matchPath(path, config);

  // Prepare data (deserialize timestamps)
  let preparedData = { ...data };

  if (schemaMatch.matched && schemaMatch.definition?.timestampFields) {
    preparedData = deserializeDocument(
      preparedData,
      schemaMatch.definition.timestampFields
    ) as Record<string, unknown>;
  }

  // Validate if requested
  if (validate && schemaMatch.matched && schemaMatch.definition) {
    const effectiveMode =
      schemaMatch.definition.validationMode || validationMode;

    const validationResult = validateDocument(
      data, // Validate against original data (not deserialized)
      schemaMatch.definition.schema,
      effectiveMode
    );

    if (!validationResult.valid && effectiveMode === 'strict') {
      return {
        path,
        dryRun,
        executed: false,
        changes: { hasChanges: false },
        validation: {
          valid: false,
          details: formatValidationResult(validationResult),
        },
        error: 'Validation failed in strict mode',
      };
    }

    if (!validationResult.valid || validationResult.warnings.length > 0) {
      // Include validation details in response
      const validationOutput = {
        valid: validationResult.valid,
        details: formatValidationResult(validationResult),
      };

      // Continue with import but include validation warnings
      if (dryRun) {
        // Get existing data for diff
        const existing = await docRef.get();
        const existingData = existing.exists
          ? (existing.data() as Record<string, unknown>)
          : null;

        const diff = calculateDiff(existingData, preparedData);

        return {
          path,
          dryRun: true,
          executed: false,
          changes: {
            hasChanges: hasChanges(diff),
            diff: formatDiff(diff, path),
          },
          validation: validationOutput,
        };
      }
    }
  }

  // Get existing data for diff
  const existing = await docRef.get();
  const existingData = existing.exists
    ? (existing.data() as Record<string, unknown>)
    : null;

  const diff = calculateDiff(existingData, preparedData);

  // Dry-run mode - just show diff
  if (dryRun) {
    return {
      path,
      dryRun: true,
      executed: false,
      changes: {
        hasChanges: hasChanges(diff),
        diff: formatDiff(diff, path),
      },
    };
  }

  // Execute import
  try {
    await docRef.set(preparedData);

    return {
      path,
      dryRun: false,
      executed: true,
      changes: {
        hasChanges: hasChanges(diff),
        diff: formatDiff(diff, path),
      },
    };
  } catch (error) {
    return {
      path,
      dryRun: false,
      executed: false,
      changes: { hasChanges: false },
      error: `Import failed: ${error}`,
    };
  }
}

/**
 * MCP tool definition for firestore_import
 */
export const firestoreImportTool = {
  name: 'firestore_import',
  description:
    'Import document data to Firestore. DRY-RUN BY DEFAULT - shows diff before executing. Set dryRun=false to execute. Validates data if schema available.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Document path (e.g., "users/user-123")',
      },
      data: {
        type: 'object',
        description: 'Document data to import',
      },
      dryRun: {
        type: 'boolean',
        description:
          'Dry-run mode: show diff without executing (default: true for safety)',
        default: true,
      },
      validate: {
        type: 'boolean',
        description: 'Validate data against schema before import (default: true)',
        default: true,
      },
      validationMode: {
        type: 'string',
        enum: ['strict', 'warn', 'permissive'],
        description: 'Validation mode (default: warn)',
        default: 'warn',
      },
    },
    required: ['path', 'data'],
  },
};
