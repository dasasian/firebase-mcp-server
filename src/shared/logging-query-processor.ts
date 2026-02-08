/**
 * Shared query processing logic for logs
 * Extracted from logs.ts to support both cloud and local sources
 */

export interface QueryContext {
  where: Array<{ field: string; operator: string; value: unknown }>;
  distinct?: string;
  fields?: string[];
  groupBy?: string[];
  aggregates: Array<{ field: string; operation: string; alias?: string }>;
  orderBy: Array<{ field: string; direction?: string }>;
  limit: number;
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
 * Apply client-side filtering (for LIKE and other complex operators)
 */
export function applyClientSideFiltering(
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
      } else if (clause.operator === '==') {
        const fieldValue = getNestedValue(entry, clause.field);
        if (fieldValue !== clause.value) {
          return false;
        }
      } else if (clause.operator === '<') {
        const fieldValue = getNestedValue(entry, clause.field);
        if (!((fieldValue as any) < (clause.value as any))) {
          return false;
        }
      } else if (clause.operator === '<=') {
        const fieldValue = getNestedValue(entry, clause.field);
        if (!((fieldValue as any) <= (clause.value as any))) {
          return false;
        }
      } else if (clause.operator === '>') {
        const fieldValue = getNestedValue(entry, clause.field);
        if (!((fieldValue as any) > (clause.value as any))) {
          return false;
        }
      } else if (clause.operator === '>=') {
        const fieldValue = getNestedValue(entry, clause.field);
        if (!((fieldValue as any) >= (clause.value as any))) {
          return false;
        }
      } else if (clause.operator === 'in') {
        const fieldValue = getNestedValue(entry, clause.field);
        if (!Array.isArray(clause.value) || !clause.value.includes(fieldValue as any)) {
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
export function matchesLikeClause(
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
export function getNestedValue(obj: any, path: string): unknown {
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
export function processDistinct(
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
export function processGroupBy(
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
export function projectFields(entry: any, fields: string[]): any {
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
export function applyOrdering(
  entries: any[],
  orderBy: Array<{ field: string; direction?: string }>
): any[] {
  if (orderBy.length === 0) {
    return entries;
  }

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
 * Execute unified query pipeline
 * Pipeline: filter → distinct/groupBy/project → order → limit
 */
export function executeQuery(
  entries: any[],
  context: QueryContext
): FirebaseFunctionsLogsOutput {
  let processed = applyClientSideFiltering(entries, context.where);

  if (context.distinct) {
    return processDistinct(processed, context.distinct, '');
  }

  if (context.groupBy && context.groupBy.length > 0) {
    return processGroupBy(processed, context.groupBy, context.aggregates,
                          context.orderBy, context.limit, '');
  }

  if (context.fields && context.fields.length > 0) {
    processed = processed.map(e => projectFields(e, context.fields!));
  }

  processed = applyOrdering(processed, context.orderBy);

  return {
    entries: processed.slice(0, context.limit),
    totalEntries: processed.length,
    cloudLoggingFilter: '',
    isAggregated: false
  };
}
