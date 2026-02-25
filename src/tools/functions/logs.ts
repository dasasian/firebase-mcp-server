/**
 * firebase_functions_logs - SQL-style query for Cloud Functions logs
 * Maps to SQL: SELECT [DISTINCT] fields FROM logs WHERE conditions GROUP BY fields ORDER BY fields LIMIT n
 */

import { updateAutoDiscoveredSchema } from '../../shared/logging-schema-loader.js';
import { getLogging } from '../../shared/firebase.js';
import { readJsonlFile, resolveLogFiles } from '../../shared/jsonl-reader.js';
import {
  applyClientSideFiltering,
  processDistinct,
  processGroupBy,
  projectFields,
  applyOrdering,
} from '../../shared/logging-query-processor.js';

export interface FirebaseFunctionsLogsInput {
  source?: 'local' | 'cloud';  // Log source: "local" reads DEV_LOG_DIR directory, "cloud" queries Cloud Logging. Default: "cloud"
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
 * Query Firebase Cloud Functions logs (cloud or local source)
 */
export async function firebaseFunctionsLogs(
  input: FirebaseFunctionsLogsInput
): Promise<FirebaseFunctionsLogsOutput> {
  try {
    const {
      source = 'cloud',
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

    let entries: any[];
    let cloudLoggingFilter = '';

    // Route based on source parameter
    if (source === 'local') {
      const devLogDir = process.env.DEV_LOG_DIR;

      if (!devLogDir) {
        return {
          totalEntries: 0,
          cloudLoggingFilter: '',
          isAggregated: false,
          error: 'DEV_LOG_DIR environment variable not set',
        };
      }

      try {
        const logFiles = resolveLogFiles(devLogDir);
        if (logFiles.length === 0) {
          return {
            totalEntries: 0,
            cloudLoggingFilter: '',
            isAggregated: false,
            error: `No log files found in ${devLogDir}`,
          };
        }
        // Read all files newest-first and merge
        const allEntries = await Promise.all(logFiles.map(f => readJsonlFile(f)));
        entries = allEntries.flat().sort((a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
      } catch (err) {
        return {
          totalEntries: 0,
          cloudLoggingFilter: '',
          isAggregated: false,
          error: `Failed to read local logs: ${err}`,
        };
      }
    } else {
      // Query Cloud Logging (existing logic)
      cloudLoggingFilter = buildCloudLoggingFilter(resourceTypes, where);

      // Get Cloud Logging client (uses same credentials as Firebase)
      const logging = await getLogging();

      // Fetch logs
      const [cloudEntries] = await logging.getEntries({
        filter: cloudLoggingFilter,
        pageSize: effectiveScanLimit,
        orderBy: 'timestamp desc',
      });

      // Process entries
      entries = cloudEntries.map(entry => processLogEntry(entry));
    }

    // Apply client-side filtering (for LIKE and complex queries)
    let processedEntries = applyClientSideFiltering(entries, where);

    // Handle DISTINCT
    if (distinct) {
      return processDistinct(processedEntries, distinct, cloudLoggingFilter);
    }

    // Handle GROUP BY (aggregation)
    if (groupBy && groupBy.length > 0) {
      return processGroupBy(
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
    '\n\nERROR SUMMARY EXAMPLE (group by error type): ' +
    '\n- {"groupBy": ["jsonPayload.error.name"], "aggregates": [{"field": "*", "operation": "count", "alias": "count"}, {"field": "timestamp", "operation": "max", "alias": "last_seen"}], "where": [{"field": "severity", "operator": "==", "value": "ERROR"}], "orderBy": [{"field": "count", "direction": "desc"}]} ' +
    '\n- Project nested fields: {"fields": ["timestamp", "jsonPayload.error.name", "jsonPayload.error.message", "jsonPayload.context.screen"]} ' +
    '\n\nQueryable fields: functionName, severity, timestamp, executionId, region, textPayload, jsonPayload, jsonPayload.* (dot-notation for any nested path), labels.* ' +
    '\nField projection reduces token usage. LIKE patterns for text search. GROUP BY works with labels. ' +
    '\nRequires IAM role: roles/logging.viewer (minimum).',
  inputSchema: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        enum: ['local', 'cloud'],
        description: 'Log source: "local" reads DEV_LOG_FILE environment variable, "cloud" queries Cloud Logging. Default: "cloud"',
        default: 'cloud',
      },
      resourceTypes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Resource types to query. Default: ["cloud_function", "cloud_run_revision"]. Options: cloud_function (1st gen), cloud_run_revision (2nd gen/Cloud Run), gae_app (App Engine), k8s_container (GKE), cloud_run_job (Cloud Run Jobs). Ignored when source is "local".',
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
