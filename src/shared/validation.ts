/**
 * Schema validation with field status awareness
 * Supports 3 validation modes: strict, warn (default), permissive
 * Detects field status: official, experimental, legacy, unknown
 */

import Ajv, { type JSONSchemaType } from 'ajv';
import addFormats from 'ajv-formats';
import type { JSONSchema7 } from 'json-schema';
import type {
  ValidationResult,
  ValidationError,
  ValidationWarning,
  ValidationMode,
  FieldStatus,
} from './types.js';

// Initialize Ajv with JSON Schema Draft-07 and format validation
const ajv = new Ajv({
  strict: false,
  allErrors: true,
  verbose: true,
});
addFormats(ajv);

/**
 * Validate a document against its schema
 *
 * @param data - Document data to validate
 * @param schema - JSON Schema to validate against
 * @param mode - Validation mode (strict | warn | permissive)
 * @returns Validation result with errors, warnings, and field breakdown
 */
export function validateDocument(
  data: Record<string, unknown>,
  schema: JSONSchema7,
  mode: ValidationMode = 'warn'
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const fieldBreakdown = {
    official: [] as string[],
    experimental: [] as string[],
    legacy: [] as string[],
    unknown: [] as string[],
  };

  // Compile schema
  const validate = ajv.compile(schema);

  // Run validation
  const valid = validate(data);

  // Collect Ajv errors
  if (!valid && validate.errors) {
    for (const error of validate.errors) {
      const field = error.instancePath?.replace(/^\//, '') || 'root';

      // In strict mode, all Ajv errors are fatal
      // In warn/permissive, only required field errors are fatal
      if (mode === 'strict' || error.keyword === 'required') {
        errors.push({
          field,
          message: error.message || 'Validation error',
          value: error.data,
        });
      } else {
        // Other validation errors become warnings in warn/permissive mode
        warnings.push({
          field,
          message: error.message || 'Validation warning',
          type: 'unknown',
        });
      }
    }
  }

  // Analyze field status
  const schemaProperties = schema.properties || {};
  const dataFields = Object.keys(data);

  for (const field of dataFields) {
    const fieldSchema = schemaProperties[field] as JSONSchema7 | undefined;

    if (!fieldSchema) {
      // Unknown field (not in schema)
      fieldBreakdown.unknown.push(field);

      if (mode === 'strict') {
        errors.push({
          field,
          message: 'Unknown field not defined in schema',
          value: data[field],
        });
      } else {
        warnings.push({
          field,
          message: 'Field not defined in schema',
          type: 'unknown',
        });
      }
    } else {
      // Field exists in schema - check status
      const status = getFieldStatus(fieldSchema);

      switch (status) {
        case 'official':
          fieldBreakdown.official.push(field);
          break;

        case 'experimental':
          fieldBreakdown.experimental.push(field);
          if (mode !== 'permissive') {
            warnings.push({
              field,
              message: 'Experimental field',
              type: 'experimental',
              metadata: extractFieldMetadata(fieldSchema),
            });
          }
          break;

        case 'legacy':
          fieldBreakdown.legacy.push(field);
          if (mode === 'strict') {
            errors.push({
              field,
              message: 'Legacy field not allowed in strict mode',
              value: data[field],
            });
          } else if (mode === 'warn') {
            warnings.push({
              field,
              message: 'Deprecated legacy field',
              type: 'legacy',
              metadata: extractFieldMetadata(fieldSchema),
            });
          }
          break;

        case 'optional':
          fieldBreakdown.official.push(field);
          break;
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    fieldBreakdown,
  };
}

/**
 * Get field status from JSON Schema metadata
 */
function getFieldStatus(fieldSchema: JSONSchema7): FieldStatus {
  const status = (fieldSchema as { 'x-status'?: string })['x-status'];

  if (status === 'experimental') return 'experimental';
  if (status === 'legacy') return 'legacy';
  if (status === 'optional') return 'optional';

  return 'official';
}

/**
 * Extract field metadata from JSON Schema
 */
function extractFieldMetadata(fieldSchema: JSONSchema7): {
  status?: FieldStatus;
  deprecated?: string;
  replacedBy?: string;
  since?: string;
} {
  const schema = fieldSchema as {
    'x-status'?: string;
    'x-deprecated'?: string;
    'x-replacedBy'?: string;
    'x-since'?: string;
  };

  return {
    status: getFieldStatus(fieldSchema),
    deprecated: schema['x-deprecated'],
    replacedBy: schema['x-replacedBy'],
    since: schema['x-since'],
  };
}

/**
 * Format validation result as human-readable text
 */
export function formatValidationResult(result: ValidationResult): string {
  const lines: string[] = [];

  // Status
  if (result.valid) {
    lines.push('✅ Valid');
  } else {
    lines.push(`❌ Invalid (${result.errors.length} errors)`);
  }

  // Errors
  if (result.errors.length > 0) {
    lines.push('\nErrors:');
    for (const error of result.errors) {
      lines.push(`  ❌ ${error.field}: ${error.message}`);
    }
  }

  // Warnings
  if (result.warnings.length > 0) {
    lines.push('\nWarnings:');
    for (const warning of result.warnings) {
      const icon = warning.type === 'experimental' ? '🧪' : warning.type === 'legacy' ? '⚠️' : 'ℹ️';
      lines.push(`  ${icon} ${warning.field}: ${warning.message}`);

      if (warning.metadata) {
        if (warning.metadata.replacedBy) {
          lines.push(`     → Use ${warning.metadata.replacedBy} instead`);
        }
        if (warning.metadata.deprecated) {
          lines.push(`     → Deprecated: ${warning.metadata.deprecated}`);
        }
      }
    }
  }

  // Field breakdown
  const { official, experimental, legacy, unknown } = result.fieldBreakdown;
  lines.push('\nField Breakdown:');
  if (official.length > 0) {
    lines.push(`  ✅ Official (${official.length}): ${official.join(', ')}`);
  }
  if (experimental.length > 0) {
    lines.push(`  🧪 Experimental (${experimental.length}): ${experimental.join(', ')}`);
  }
  if (legacy.length > 0) {
    lines.push(`  ⚠️ Legacy (${legacy.length}): ${legacy.join(', ')}`);
  }
  if (unknown.length > 0) {
    lines.push(`  ❓ Unknown (${unknown.length}): ${unknown.join(', ')}`);
  }

  return lines.join('\n');
}
