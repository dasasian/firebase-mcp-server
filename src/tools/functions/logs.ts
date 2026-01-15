/**
 * firebase_functions_logs - SQL-style query for Cloud Functions logs
 * Maps to SQL: SELECT [DISTINCT] fields FROM logs WHERE conditions GROUP BY fields ORDER BY fields LIMIT n
 */

import { updateAutoDiscoveredSchema } from '../../shared/logging-schema-loader.js';
import { getLogging } from '../../shared/firebase.js';

export interface FirebaseFunctionsLogsInput {
  resourceTypes?: string[];  // Resource types to query (default: ["cloud_function", "cloud_run_revision"])
  fields?: string[];  // SELECT specific fields
  distinct?: string;  // SELECT DISTINCT field
  where?: Array<{
    field: string;
    operator: '==' | '!=' | '<' | '<=' | '>' | '>=' | 'LIKE' | 'in';
    value: unknown;
  }>;
  groupBy?: string[];  // GROUP BY fields
  aggregates?: Array<{
    field: string;
    operation: 'count' | 'max' | 'min';
    alias?: string;
  }>;
  orderBy?: Array<{
    field: string;
    direction?: 'asc' | 'desc';
  }>;
  limit?: number;       // Default: 100, Max: 1000
  scanLimit?: number;   // Default: 5000, Max: 10000
}

export interface FirebaseFunctionsLogsOutput {
  entries?: Array<{
    timestamp: string;
    severity: string;
    functionName: string;
    executionId?: string;
    textPayload?: string;
    jsonPayload?: Record<string, unknown>;
    region?: string;
    labels?: Record<string, string>;
    resource: Record<string, unknown>;
    insertId: string;
  }>;
  aggregatedResults?: Array<Record<string, unknown>>;
  totalEntries: number;
  cloudLoggingFilter: string;
  isAggregated: boolean;
  error?: string;
}

/**
 * Query Firebase Cloud Functions logs
 */
export async function firebaseFunctionsLogs(
  input: FirebaseFunctionsLogsInput
): Promise<FirebaseFunctionsLogsOutput> {
  try {
    const {
      resourceTypes = ['cloud_function', 'cloud_run_revision'],
      fields,
      distinct,
      where = [],
      groupBy,
      aggregates = [],
      orderBy = [],
      limit = 100,
      scanLimit = 5000
    } = input;

    // Validate limits
    const effectiveLimit = Math.min(limit, 1000);
    const effectiveScanLimit = Math.min(scanLimit, 10000);

    // Build Cloud Logging filter
    const cloudLoggingFilter = buildCloudLoggingFilter(resourceTypes, where);

    // Get Cloud Logging client (uses same credentials as Firebase)
    const logging = await getLogging();

    // Fetch logs
    const [entries] = await logging.getEntries({
      filter: cloudLoggingFilter,
      pageSize: effectiveScanLimit,
      orderBy: 'timestamp desc',
    });

    // Process entries
    let processedEntries = entries.map(entry => processLogEntry(entry));

    // Apply client-side filtering (for LIKE and complex queries)
    processedEntries = applyClientSideFiltering(processedEntries, where);

    // Handle DISTINCT
    if (distinct) {
      return handleDistinct(processedEntries, distinct, cloudLoggingFilter);
    }

    // Handle GROUP BY (aggregation)
    if (groupBy && groupBy.length > 0) {
      return handleGroupBy(
        processedEntries,
        groupBy,
        aggregates,
        orderBy,
        effectiveLimit,
        cloudLoggingFilter
      );
    }

    // Handle regular query (no aggregation)
    // Apply field projection
    if (fields && fields.length > 0) {
      processedEntries = processedEntries.map(entry => projectFields(entry, fields));
    }

    // Apply ordering
    if (orderBy.length > 0) {
      processedEntries = applyOrdering(processedEntries, orderBy);
    }

    // Apply limit
    const limitedEntries = processedEntries.slice(0, effectiveLimit);

    // Update schema discovery (async, non-blocking)
    updateSchemaFromEntries(processedEntries).catch(err => {
      console.error('[LoggingTool] Schema update failed:', err);
    });

    return {
      entries: limitedEntries,
      totalEntries: limitedEntries.length,
      cloudLoggingFilter,
      isAggregated: false,
    };
  } catch (error) {
    return {
      totalEntries: 0,
      cloudLoggingFilter: '',
      isAggregated: false,
      error: `Failed to query logs: ${error}`,
    };
  }
}

/**
 * Build Cloud Logging filter from WHERE clauses
 */
function buildCloudLoggingFilter(
  resourceTypes: string[],
  where: Array<{ field: string; operator: string; value: unknown }>
): string {
  // Build resource type filter (supports multiple types)
  const resourceTypeFilter = resourceTypes.length === 1
    ? `resource.type="${resourceTypes[0]}"`
    : `(${resourceTypes.map(t => `resource.type="${t}"`).join(' OR ')})`;

  const filters: string[] = [resourceTypeFilter];

  for (const clause of where) {
    // Skip operators handled client-side
    if (clause.operator === 'LIKE' || clause.operator === '!=') {
      continue;
    }

    const { field, operator, value } = clause;

    // Map field names to Cloud Logging structure
    if (field === 'functionName') {
      if (operator === 'in' && Array.isArray(value)) {
        const conditions = value.map(v => `resource.labels.function_name="${v}"`).join(' OR ');
        filters.push(`(${conditions})`);
      } else if (operator === '==') {
        filters.push(`resource.labels.function_name="${value}"`);
      }
    } else if (field === 'executionId') {
      filters.push(`labels.execution_id="${value}"`);
    } else if (field === 'region') {
      filters.push(`resource.labels.region="${value}"`);
    } else if (field === 'severity') {
      if (operator === 'in' && Array.isArray(value)) {
        const conditions = value.map(v => `severity="${v}"`).join(' OR ');
        filters.push(`(${conditions})`);
      } else {
        filters.push(`severity="${value}"`);
      }
    } else if (field === 'timestamp') {
      // Handle timestamp comparisons
      const isoValue = parseTimeValue(value as string);
      if (operator === '>') {
        filters.push(`timestamp>="${isoValue}"`);
      } else if (operator === '>=') {
        filters.push(`timestamp>="${isoValue}"`);
      } else if (operator === '<') {
        filters.push(`timestamp<"${isoValue}"`);
      } else if (operator === '<=') {
        filters.push(`timestamp<="${isoValue}"`);
      }
    } else if (field.startsWith('labels.')) {
      // Custom labels
      const labelKey = field.substring(7);
      if (operator === 'in' && Array.isArray(value)) {
        const conditions = value.map(v => `labels.${labelKey}="${v}"`).join(' OR ');
        filters.push(`(${conditions})`);
      } else if (operator === '==') {
        filters.push(`labels.${labelKey}="${value}"`);
      }
    } else if (field === 'textPayload') {
      // Only handle simple equality for textPayload in Cloud Logging filter
      if (operator === '==') {
        filters.push(`textPayload="${value}"`);
      }
      // LIKE handled client-side
    }
  }

  return filters.join(' AND ');
}

/**
 * Parse time value (supports relative like "1h" or ISO timestamps)
 */
function parseTimeValue(value: string): string {
  // Try relative time format
  const match = value.match(/^(\d+)(h|d)$/);
  if (match) {
    const amount = parseInt(match[1]);
    const unit = match[2];
    const ms = unit === 'h' ? amount * 60 * 60 * 1000 : amount * 24 * 60 * 60 * 1000;
    return new Date(Date.now() - ms).toISOString();
  }
  // Return as-is (assume ISO format)
  return value;
}

/**
 * Process log entry from Cloud Logging into our format
 */
function processLogEntry(entry: any): any {
  const metadata = entry.metadata || {};
  const data = entry.data || {};

  return {
    timestamp: metadata.timestamp || new Date().toISOString(),
    severity: metadata.severity || 'DEFAULT',
    functionName: metadata.resource?.labels?.function_name || 'unknown',
    executionId: metadata.labels?.execution_id,
    textPayload: data.textPayload || data.message,
    jsonPayload: data.jsonPayload,
    region: metadata.resource?.labels?.region,
    labels: metadata.labels || {},
    resource: metadata.resource || {},
    insertId: metadata.insertId || '',
  };
}

/**
 * Apply client-side filtering (for LIKE and other complex operators)
 */
function applyClientSideFiltering(
  entries: any[],
  where: Array<{ field: string; operator: string; value: unknown }>
): any[] {
  return entries.filter(entry => {
    for (const clause of where) {
      if (clause.operator === 'LIKE') {
        if (!matchesLikeClause(entry, clause)) {
          return false;
        }
      } else if (clause.operator === '!=') {
        // != not supported by Cloud Logging, handle client-side
        const fieldValue = getNestedValue(entry, clause.field);
        if (fieldValue === clause.value) {
          return false;
        }
      }
      // Other operators already handled by Cloud Logging filter
    }
    return true;
  });
}

/**
 * Check if entry matches LIKE clause
 */
function matchesLikeClause(
  entry: any,
  clause: { field: string; value: unknown }
): boolean {
  const fieldValue = getNestedValue(entry, clause.field);

  if (typeof fieldValue !== 'string' || typeof clause.value !== 'string') {
    return false;
  }

  // Convert SQL LIKE pattern to regex
  // % -> .* (any characters)
  // _ -> . (single character)
  const pattern = (clause.value as string)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
    .replace(/%/g, '.*') // % -> .*
    .replace(/_/g, '.'); // _ -> .

  const regex = new RegExp(`^${pattern}$`, 'i'); // Case-insensitive
  return regex.test(fieldValue);
}

/**
 * Get nested value from object using dot notation
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
 * Handle DISTINCT query
 */
function handleDistinct(
  entries: any[],
  distinct: string,
  cloudLoggingFilter: string
): FirebaseFunctionsLogsOutput {
  const uniqueValues = new Set<string>();

  for (const entry of entries) {
    const value = getNestedValue(entry, distinct);
    if (value !== undefined && value !== null) {
      uniqueValues.add(String(value));
    }
  }

  const aggregatedResults = Array.from(uniqueValues)
    .sort()
    .map(value => ({ [distinct]: value }));

  return {
    aggregatedResults,
    totalEntries: aggregatedResults.length,
    cloudLoggingFilter,
    isAggregated: true,
  };
}

/**
 * Handle GROUP BY query (aggregation)
 */
function handleGroupBy(
  entries: any[],
  groupBy: string[],
  aggregates: Array<{ field: string; operation: string; alias?: string }>,
  orderBy: Array<{ field: string; direction?: string }>,
  limit: number,
  cloudLoggingFilter: string
): FirebaseFunctionsLogsOutput {
  // Group entries by composite key
  const groups = new Map<string, any[]>();

  for (const entry of entries) {
    const keyParts = groupBy.map(field => {
      const value = getNestedValue(entry, field);
      return value !== undefined ? String(value) : 'null';
    });
    const key = keyParts.join('||');

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(entry);
  }

  // Compute aggregates for each group
  const aggregatedResults: any[] = [];

  for (const [key, groupEntries] of groups) {
    const result: Record<string, unknown> = {};

    // Add groupBy fields to result
    const keyParts = key.split('||');
    groupBy.forEach((field, i) => {
      const value = keyParts[i];
      result[field] = value === 'null' ? null : value;
    });

    // Compute aggregates
    for (const agg of aggregates) {
      const alias = agg.alias || `${agg.operation}_${agg.field}`;

      if (agg.operation === 'count') {
        result[alias] = groupEntries.length;
      } else if (agg.operation === 'max') {
        if (agg.field === '*') {
          result[alias] = groupEntries.length;
        } else {
          const values = groupEntries.map(e => getNestedValue(e, agg.field)).filter(v => v !== undefined);
          if (values.length > 0) {
            // Find max value (handle dates, numbers, strings)
            result[alias] = values.reduce((max, v) => {
              const maxComp = max instanceof Date ? max.getTime() : (typeof max === 'number' ? max : String(max));
              const vComp = v instanceof Date ? v.getTime() : (typeof v === 'number' ? v : String(v));
              return vComp > maxComp ? v : max;
            });
          }
        }
      } else if (agg.operation === 'min') {
        if (agg.field === '*') {
          result[alias] = groupEntries.length;
        } else {
          const values = groupEntries.map(e => getNestedValue(e, agg.field)).filter(v => v !== undefined);
          if (values.length > 0) {
            // Find min value (handle dates, numbers, strings)
            result[alias] = values.reduce((min, v) => {
              const minComp = min instanceof Date ? min.getTime() : (typeof min === 'number' ? min : String(min));
              const vComp = v instanceof Date ? v.getTime() : (typeof v === 'number' ? v : String(v));
              return vComp < minComp ? v : min;
            });
          }
        }
      }
    }

    aggregatedResults.push(result);
  }

  // Apply ordering
  if (orderBy.length > 0) {
    aggregatedResults.sort((a, b) => {
      for (const order of orderBy) {
        const aVal = a[order.field];
        const bVal = b[order.field];
        const direction = order.direction === 'desc' ? -1 : 1;

        if (aVal < bVal) return -1 * direction;
        if (aVal > bVal) return 1 * direction;
      }
      return 0;
    });
  }

  // Apply limit
  const limited = aggregatedResults.slice(0, limit);

  return {
    aggregatedResults: limited,
    totalEntries: limited.length,
    cloudLoggingFilter,
    isAggregated: true,
  };
}

/**
 * Project only specified fields from entry
 */
function projectFields(entry: any, fields: string[]): any {
  const projected: Record<string, unknown> = {};

  for (const field of fields) {
    if (field.startsWith('labels.')) {
      // Handle nested label access
      const labelKey = field.substring(7);
      if (entry.labels && labelKey in entry.labels) {
        if (!projected.labels) {
          projected.labels = {};
        }
        (projected.labels as Record<string, unknown>)[labelKey] = entry.labels[labelKey];
      }
    } else if (field === 'labels') {
      // Include all labels
      projected.labels = entry.labels;
    } else if (field in entry) {
      projected[field] = entry[field];
    }
  }

  return projected;
}

/**
 * Apply ordering to entries
 */
function applyOrdering(
  entries: any[],
  orderBy: Array<{ field: string; direction?: string }>
): any[] {
  return entries.sort((a, b) => {
    for (const order of orderBy) {
      const aVal = getNestedValue(a, order.field);
      const bVal = getNestedValue(b, order.field);
      const direction = order.direction === 'desc' ? -1 : 1;

      // Handle undefined/null values
      if ((aVal === undefined || aVal === null) && (bVal === undefined || bVal === null)) continue;
      if (aVal === undefined || aVal === null) return 1 * direction;
      if (bVal === undefined || bVal === null) return -1 * direction;

      // Compare values (handle different types)
      const aComp = aVal instanceof Date ? aVal.getTime() : aVal;
      const bComp = bVal instanceof Date ? bVal.getTime() : bVal;

      if ((aComp as any) < (bComp as any)) return -1 * direction;
      if ((aComp as any) > (bComp as any)) return 1 * direction;
    }
    return 0;
  });
}

/**
 * Update schema discovery from processed entries
 */
async function updateSchemaFromEntries(entries: any[]): Promise<void> {
  if (entries.length === 0) return;

  // Extract function names and their labels
  const functionData = new Map<string, Set<string>>();
  const labelData = new Map<string, Set<string>>();

  for (const entry of entries) {
    const funcName = entry.functionName;
    if (!funcName || funcName === 'unknown') continue;

    if (!functionData.has(funcName)) {
      functionData.set(funcName, new Set());
    }

    if (entry.labels) {
      for (const [labelKey, labelValue] of Object.entries(entry.labels)) {
        // Track label for this function
        functionData.get(funcName)!.add(labelKey);

        // Track label values
        if (!labelData.has(labelKey)) {
          labelData.set(labelKey, new Set());
        }
        labelData.get(labelKey)!.add(String(labelValue));
      }
    }
  }

  // Convert to format expected by schema updater
  const functions = Array.from(functionData.entries()).map(([name, labels]) => ({
    name,
    labels: Array.from(labels),
  }));

  await updateAutoDiscoveredSchema({
    functions,
    labels: labelData,
  });
}

/**
 * MCP tool definition
 */
export const firebaseFunctionsLogsTool = {
  name: 'firebase_functions_logs',
  description:
    'SQL-style query for Cloud Logging with full aggregation and custom label support. Maps to: SELECT [DISTINCT] fields FROM logs WHERE conditions GROUP BY fields ORDER BY fields LIMIT n. ' +
    '\n\nSupports both raw log queries AND aggregated analytics with custom label filtering. ' +
    '\n\nRESOURCE TYPES (default: ["cloud_function", "cloud_run_revision"]): ' +
    '\n- 1st gen Functions: {"resourceTypes": ["cloud_function"]} ' +
    '\n- 2nd gen Functions: {"resourceTypes": ["cloud_run_revision"]} ' +
    '\n- Both generations: {"resourceTypes": ["cloud_function", "cloud_run_revision"]} (default) ' +
    '\n- Cloud Run services: {"resourceTypes": ["cloud_run_revision"]} ' +
    '\n- App Engine: {"resourceTypes": ["gae_app"]} ' +
    '\n- GKE containers: {"resourceTypes": ["k8s_container"]} ' +
    '\n- Multiple types: {"resourceTypes": ["cloud_function", "cloud_run_revision", "gae_app"]} ' +
    '\n\nDISCOVERY EXAMPLES (call these first): ' +
    '\n- List all functions: {"distinct": "functionName"} ' +
    '\n- Function health: {"groupBy": ["functionName", "severity"], "aggregates": [{"field": "*", "operation": "count", "alias": "count"}]} ' +
    '\n- Top errors: {"groupBy": ["textPayload"], "aggregates": [{"field": "*", "operation": "count", "alias": "occurrences"}], "where": [{"field": "severity", "operator": "==", "value": "ERROR"}], "orderBy": [{"field": "occurrences", "direction": "desc"}], "limit": 10} ' +
    '\n- What environments exist: {"distinct": "labels.environment"} ' +
    '\n- Error rate by environment: {"groupBy": ["labels.environment"], "aggregates": [{"field": "*", "operation": "count"}], "where": [{"field": "severity", "operator": "==", "value": "ERROR"}]} ' +
    '\n\nRAW LOG EXAMPLES: ' +
    '\n- Recent logs: {"limit": 50} ' +
    '\n- Function errors: {"where": [{"field": "functionName", "operator": "==", "value": "sendEmail"}, {"field": "severity", "operator": "==", "value": "ERROR"}], "fields": ["timestamp", "textPayload"]} ' +
    '\n- Search text: {"where": [{"field": "textPayload", "operator": "LIKE", "value": "%timeout%"}]} ' +
    '\n- Execution trace: {"where": [{"field": "executionId", "operator": "==", "value": "abc123"}], "orderBy": [{"field": "timestamp", "direction": "asc"}]} ' +
    '\n\nLABEL-BASED FILTERING (custom user labels): ' +
    '\n- User logs: {"where": [{"field": "labels.user_id", "operator": "==", "value": "123"}]} ' +
    '\n- Production errors: {"where": [{"field": "labels.environment", "operator": "==", "value": "production"}, {"field": "severity", "operator": "==", "value": "ERROR"}]} ' +
    '\n- Premium orders: {"where": [{"field": "labels.order_type", "operator": "==", "value": "premium"}]} ' +
    '\n\nQueryable fields: functionName, severity, timestamp, executionId, region, textPayload, jsonPayload, labels.* ' +
    '\nField projection reduces token usage. LIKE patterns for text search. GROUP BY works with labels. ' +
    '\nRequires IAM role: roles/logging.viewer (minimum).',
  inputSchema: {
    type: 'object',
    properties: {
      resourceTypes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Resource types to query. Default: ["cloud_function", "cloud_run_revision"]. Options: cloud_function (1st gen), cloud_run_revision (2nd gen/Cloud Run), gae_app (App Engine), k8s_container (GKE), cloud_run_job (Cloud Run Jobs).',
        default: ['cloud_function', 'cloud_run_revision'],
      },
      fields: {
        type: 'array',
        items: { type: 'string' },
        description: 'SELECT specific fields (e.g., ["timestamp", "severity", "textPayload"]). Omit for all fields.',
      },
      distinct: {
        type: 'string',
        description: 'SELECT DISTINCT field (e.g., "functionName", "labels.environment"). Returns unique values.',
      },
      where: {
        type: 'array',
        description: 'WHERE clauses for filtering',
        items: {
          type: 'object',
          properties: {
            field: {
              type: 'string',
              description: 'Field name: functionName, severity, timestamp, executionId, region, textPayload, labels.*',
            },
            operator: {
              type: 'string',
              enum: ['==', '!=', '<', '<=', '>', '>=', 'LIKE', 'in'],
              description: 'Comparison operator. LIKE supports % (any chars), _ (single char). Case-insensitive.',
            },
            value: {
              description: 'Value to compare. For "in" operator, use array. For LIKE, use % wildcards.',
            },
          },
          required: ['field', 'operator', 'value'],
        },
      },
      groupBy: {
        type: 'array',
        items: { type: 'string' },
        description: 'GROUP BY fields for aggregation. Works with labels.',
      },
      aggregates: {
        type: 'array',
        description: 'Aggregation functions (COUNT, MAX, MIN)',
        items: {
          type: 'object',
          properties: {
            field: {
              type: 'string',
              description: 'Field to aggregate. Use "*" for COUNT(*).',
            },
            operation: {
              type: 'string',
              enum: ['count', 'max', 'min'],
              description: 'Aggregation operation',
            },
            alias: {
              type: 'string',
              description: 'Output field name (e.g., "occurrences", "last_seen")',
            },
          },
          required: ['field', 'operation'],
        },
      },
      orderBy: {
        type: 'array',
        description: 'ORDER BY fields (can reference aggregate aliases)',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string' },
            direction: {
              type: 'string',
              enum: ['asc', 'desc'],
              default: 'asc',
            },
          },
          required: ['field'],
        },
      },
      limit: {
        type: 'number',
        description: 'LIMIT: Maximum results to return (default: 100, max: 1000)',
        default: 100,
      },
      scanLimit: {
        type: 'number',
        description: 'Maximum logs to fetch before filtering (default: 5000, max: 10000). Increase for broader searches.',
        default: 5000,
      },
    },
  },
};
