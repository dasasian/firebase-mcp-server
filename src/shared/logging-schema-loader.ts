/**
 * Logging schema loader with dual-file support:
 * - logging-schemas.json (optional manual schema)
 * - .firebase-logging-schema.json (auto-discovered cache)
 *
 * Follows the Firestore pattern (firestore-schemas.json + .firebase-mcp-cache.json)
 */

import { readFile, writeFile, access } from 'fs/promises';
import { constants } from 'fs';
import { resolve } from 'path';

/**
 * Manual schema definition (optional user documentation)
 */
export interface LoggingManualSchema {
  functions?: Record<string, {
    description?: string;
    expectedLabels?: Record<string, string>; // label_name -> description
  }>;
}

/**
 * Auto-discovered schema (cached from actual log queries)
 */
export interface LoggingAutoSchema {
  lastUpdated: string; // ISO timestamp
  totalQueriesRun: number;
  functions: Record<string, {
    lastSeen: string; // ISO timestamp
    logCount: number;
    labels: string[]; // List of label keys seen
  }>;
  labels: Record<string, {
    functions: string[]; // Which functions use this label
    type: 'identifier' | 'enum' | 'numeric' | 'text';
    sampleValues?: string[]; // Sample values (max 10)
    values?: string[]; // For enums: all unique values seen (if ≤10 total)
  }>;
}

/**
 * Merged schema view (manual + auto-discovered)
 */
export interface LoggingSchema {
  functions: Map<string, {
    description?: string;
    expectedLabels?: Record<string, string>;
    lastSeen?: string;
    logCount?: number;
    observedLabels?: string[];
  }>;
  labels: Map<string, {
    type?: 'identifier' | 'enum' | 'numeric' | 'text';
    functions?: string[];
    sampleValues?: string[];
    values?: string[];
    description?: string; // From manual schema
  }>;
}

let manualSchema: LoggingManualSchema | null = null;
let autoSchema: LoggingAutoSchema | null = null;
let mergedSchema: LoggingSchema | null = null;

const MANUAL_SCHEMA_PATH = resolve(process.cwd(), 'logging-schemas.json');
const AUTO_SCHEMA_PATH = resolve(process.cwd(), '.firebase-logging-schema.json');

/**
 * Initialize logging schema loader
 * Loads both manual and auto-discovered schemas if they exist
 */
export async function initializeLoggingSchemaLoader(): Promise<void> {
  // Try loading manual schema (optional)
  try {
    await access(MANUAL_SCHEMA_PATH, constants.R_OK);
    const content = await readFile(MANUAL_SCHEMA_PATH, 'utf-8');
    manualSchema = JSON.parse(content) as LoggingManualSchema;
    console.error('[LoggingSchema] Manual schema loaded');
  } catch (err) {
    // Manual schema is optional - not an error if it doesn't exist
    console.error('[LoggingSchema] No manual schema found (optional)');
  }

  // Try loading auto-discovered schema (optional, created on first use)
  try {
    await access(AUTO_SCHEMA_PATH, constants.R_OK);
    const content = await readFile(AUTO_SCHEMA_PATH, 'utf-8');
    autoSchema = JSON.parse(content) as LoggingAutoSchema;
    console.error('[LoggingSchema] Auto-discovered schema loaded');
  } catch (err) {
    // Auto schema doesn't exist yet - will be created on first query
    console.error('[LoggingSchema] No auto-discovered schema yet (will create on first query)');
  }

  // Merge schemas
  mergeSchemas();
}

/**
 * Merge manual and auto-discovered schemas into unified view
 */
function mergeSchemas(): void {
  const functions = new Map<string, any>();
  const labels = new Map<string, any>();

  // Start with manual schema
  if (manualSchema?.functions) {
    for (const [funcName, funcData] of Object.entries(manualSchema.functions)) {
      functions.set(funcName, {
        description: funcData.description,
        expectedLabels: funcData.expectedLabels,
      });
    }
  }

  // Merge in auto-discovered data
  if (autoSchema?.functions) {
    for (const [funcName, funcData] of Object.entries(autoSchema.functions)) {
      const existing = functions.get(funcName) || {};
      functions.set(funcName, {
        ...existing,
        lastSeen: funcData.lastSeen,
        logCount: funcData.logCount,
        observedLabels: funcData.labels,
      });
    }
  }

  // Labels from manual schema
  if (manualSchema?.functions) {
    for (const [funcName, funcData] of Object.entries(manualSchema.functions)) {
      if (funcData.expectedLabels) {
        for (const [labelKey, labelDesc] of Object.entries(funcData.expectedLabels)) {
          const existing = labels.get(labelKey) || {};
          labels.set(labelKey, {
            ...existing,
            description: labelDesc,
          });
        }
      }
    }
  }

  // Labels from auto-discovered
  if (autoSchema?.labels) {
    for (const [labelKey, labelData] of Object.entries(autoSchema.labels)) {
      const existing = labels.get(labelKey) || {};
      labels.set(labelKey, {
        ...existing,
        type: labelData.type,
        functions: labelData.functions,
        sampleValues: labelData.sampleValues,
        values: labelData.values,
      });
    }
  }

  mergedSchema = { functions, labels };
}

/**
 * Get merged schema (manual + auto-discovered)
 */
export function getLoggingSchema(): LoggingSchema | null {
  return mergedSchema;
}

/**
 * Update auto-discovered schema with new discoveries from log queries
 */
export async function updateAutoDiscoveredSchema(discoveries: {
  functions: Array<{ name: string; labels: string[] }>;
  labels: Map<string, Set<string>>; // labelKey -> set of values
}): Promise<void> {
  // Initialize if doesn't exist
  if (!autoSchema) {
    autoSchema = {
      lastUpdated: new Date().toISOString(),
      totalQueriesRun: 0,
      functions: {},
      labels: {},
    };
  }

  autoSchema.totalQueriesRun++;
  autoSchema.lastUpdated = new Date().toISOString();

  // Update functions
  for (const func of discoveries.functions) {
    const existing = autoSchema.functions[func.name];
    if (existing) {
      existing.lastSeen = new Date().toISOString();
      existing.logCount++;
      // Merge labels (union)
      const existingLabels = new Set(existing.labels);
      for (const label of func.labels) {
        existingLabels.add(label);
      }
      existing.labels = Array.from(existingLabels).sort();
    } else {
      autoSchema.functions[func.name] = {
        lastSeen: new Date().toISOString(),
        logCount: 1,
        labels: func.labels.sort(),
      };
    }
  }

  // Update labels
  for (const [labelKey, values] of discoveries.labels) {
    const existing = autoSchema.labels[labelKey];
    const valueArray = Array.from(values);

    if (existing) {
      // Merge previously seen values (enums store `values`, everything else
      // stores `sampleValues`) with the new ones, keeping them unique.
      const allValues = new Set([
        ...(existing.values || []),
        ...(existing.sampleValues || []),
        ...valueArray,
      ]);

      // Detect type
      const type = detectLabelType(allValues);
      existing.type = type;

      // If enum (≤10 unique values), store all
      if (type === 'enum') {
        existing.values = Array.from(allValues).sort();
        delete existing.sampleValues;
      } else {
        existing.sampleValues = Array.from(allValues).slice(0, 10);
        delete existing.values;
      }

      // Update functions list (union)
      const funcSet = new Set(existing.functions);
      for (const func of discoveries.functions) {
        if (func.labels.includes(labelKey)) {
          funcSet.add(func.name);
        }
      }
      existing.functions = Array.from(funcSet).sort();
    } else {
      const type = detectLabelType(values);
      autoSchema.labels[labelKey] = {
        functions: discoveries.functions
          .filter(f => f.labels.includes(labelKey))
          .map(f => f.name)
          .sort(),
        type,
        ...(type === 'enum' && values.size <= 10
          ? { values: valueArray.sort() }
          : { sampleValues: valueArray.slice(0, 10) }),
      };
    }
  }

  // Save to disk (async, non-blocking)
  saveAutoSchema().catch(err => {
    console.error('[LoggingSchema] Failed to save auto-discovered schema:', err);
  });

  // Re-merge schemas
  mergeSchemas();
}

/**
 * Detect label type from values
 */
function detectLabelType(values: Set<string>): 'identifier' | 'enum' | 'numeric' | 'text' {
  const valueArray = Array.from(values);

  // If ≤10 unique values, consider it an enum
  if (valueArray.length <= 10) {
    return 'enum';
  }

  // If all values are numeric, mark as numeric
  const allNumeric = valueArray.every(v => !isNaN(Number(v)));
  if (allNumeric) {
    return 'numeric';
  }

  // If values look like IDs (short, alphanumeric), mark as identifier
  const avgLength = valueArray.reduce((sum, v) => sum + v.length, 0) / valueArray.length;
  if (avgLength < 20) {
    return 'identifier';
  }

  // Otherwise, free text
  return 'text';
}

/**
 * Save auto-discovered schema to disk
 */
async function saveAutoSchema(): Promise<void> {
  if (!autoSchema) return;

  try {
    const content = JSON.stringify(autoSchema, null, 2);
    await writeFile(AUTO_SCHEMA_PATH, content, 'utf-8');
    console.error('[LoggingSchema] Auto-discovered schema saved');
  } catch (err) {
    console.error('[LoggingSchema] Failed to save schema:', err);
    throw err;
  }
}

/**
 * Check if schema loader is initialized
 */
export function isLoggingSchemaInitialized(): boolean {
  return mergedSchema !== null;
}

/**
 * Clear schema cache (useful for testing)
 */
export function clearLoggingSchemaCache(): void {
  manualSchema = null;
  autoSchema = null;
  mergedSchema = null;
}
