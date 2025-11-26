/**
 * Shared TypeScript interfaces for the Firestore MCP server
 */

import type { JSONSchema7 } from 'json-schema';

/**
 * Validation modes for schema enforcement
 */
export type ValidationMode = 'strict' | 'warn' | 'permissive';

/**
 * Field status flags for schema evolution
 */
export type FieldStatus = 'official' | 'experimental' | 'legacy' | 'optional';

/**
 * Schema configuration following firestore.rules path convention
 */
export interface SchemaConfig {
  schemas: {
    [documentPath: string]: DocumentSchemaDefinition;
  };
  collectionGroups?: {
    [groupName: string]: CollectionGroupDefinition;
  };
  definitions?: {
    [name: string]: JSONSchema7;
  };
}

/**
 * Schema definition for a document path pattern
 */
export interface DocumentSchemaDefinition {
  description?: string;
  schema: JSONSchema7;
  timestampFields?: string[];
  validationMode?: ValidationMode;
}

/**
 * Collection group query definition
 */
export interface CollectionGroupDefinition {
  description?: string;
  schema: JSONSchema7 | { $ref: string };
}

/**
 * Path parameter extracted from a pattern
 * Example: /users/{userId} matches /users/user-123 → { userId: 'user-123' }
 */
export interface PathParams {
  [param: string]: string;
}

/**
 * Result of matching a document path to a schema pattern
 */
export interface PathMatchResult {
  matched: boolean;
  schemaPath?: string;
  params?: PathParams;
  definition?: DocumentSchemaDefinition;
}

/**
 * Validation result with field status breakdown
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  fieldBreakdown: {
    official: string[];
    experimental: string[];
    legacy: string[];
    unknown: string[];
  };
}

/**
 * Validation error
 */
export interface ValidationError {
  field: string;
  message: string;
  value?: unknown;
}

/**
 * Validation warning
 */
export interface ValidationWarning {
  field: string;
  message: string;
  type: 'experimental' | 'legacy' | 'unknown';
  metadata?: {
    status?: FieldStatus;
    deprecated?: string;
    replacedBy?: string;
    since?: string;
  };
}

/**
 * Firestore timestamp serialization options
 */
export interface SerializationOptions {
  timestampFields?: string[];
  format?: 'iso' | 'unix' | 'object';
}

/**
 * Diff result for import dry-run
 */
export interface DiffResult {
  added: Record<string, unknown>;
  removed: Record<string, unknown>;
  modified: Array<{
    field: string;
    oldValue: unknown;
    newValue: unknown;
  }>;
}
