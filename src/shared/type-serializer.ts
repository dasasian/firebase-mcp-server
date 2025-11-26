/**
 * Type serialization utilities for Firestore data
 * Handles Timestamp ↔ ISO 8601 string conversion
 */

import admin from 'firebase-admin';

/**
 * Serialize Firestore document data for JSON output
 * Converts Firestore Timestamps to ISO 8601 strings
 *
 * @param data - Document data from Firestore
 * @param timestampFields - Array of field paths that contain timestamps
 * @returns Serialized data with timestamps as ISO strings
 */
export function serializeDocument(
  data: Record<string, unknown>,
  timestampFields: string[] = []
): Record<string, unknown> {
  const serialized = { ...data };

  for (const fieldPath of timestampFields) {
    // Handle wildcard paths specially (e.g., "instances.*.openedAt")
    if (fieldPath.includes('.*')) {
      serializeWildcardPath(serialized, fieldPath);
      continue;
    }

    // Handle non-wildcard paths
    const value = getNestedValue(serialized, fieldPath);

    if (value instanceof admin.firestore.Timestamp) {
      setNestedValue(serialized, fieldPath, value.toDate().toISOString());
    } else if (Array.isArray(value)) {
      // Handle arrays of timestamps
      const serializedArray = value.map(item =>
        item instanceof admin.firestore.Timestamp
          ? item.toDate().toISOString()
          : item
      );
      setNestedValue(serialized, fieldPath, serializedArray);
    }
  }

  return serialized;
}

/**
 * Serialize timestamps in wildcard paths (e.g., "instances.*.openedAt")
 * Navigates to array and serializes nested field in each array item
 */
function serializeWildcardPath(
  obj: Record<string, unknown>,
  path: string
): void {
  const parts = path.split('.');
  const wildcardIndex = parts.indexOf('*');

  if (wildcardIndex === -1) return; // No wildcard found

  // Split path: "instances.*.openedAt" → "instances" + "openedAt"
  const pathToArray = parts.slice(0, wildcardIndex).join('.');
  const fieldInArrayItem = parts.slice(wildcardIndex + 1).join('.');

  // Navigate to the array
  const arrayValue = getNestedValue(obj, pathToArray);

  if (!Array.isArray(arrayValue)) return;

  // Serialize the nested field in each array item
  for (const item of arrayValue) {
    if (item && typeof item === 'object') {
      const itemObj = item as Record<string, unknown>;
      const value = fieldInArrayItem
        ? getNestedValue(itemObj, fieldInArrayItem)
        : item;

      if (value instanceof admin.firestore.Timestamp) {
        if (fieldInArrayItem) {
          setNestedValue(itemObj, fieldInArrayItem, value.toDate().toISOString());
        }
      }
    }
  }
}

/**
 * Deserialize JSON data for Firestore import
 * Converts ISO 8601 strings to Firestore Timestamps
 *
 * @param data - Data from JSON file
 * @param timestampFields - Array of field paths that should be timestamps
 * @returns Data with ISO strings converted to Firestore Timestamps
 */
export function deserializeDocument(
  data: Record<string, unknown>,
  timestampFields: string[] = []
): Record<string, unknown> {
  const deserialized = { ...data };

  for (const fieldPath of timestampFields) {
    // Handle wildcard paths specially (e.g., "instances.*.openedAt")
    if (fieldPath.includes('.*')) {
      deserializeWildcardPath(deserialized, fieldPath);
      continue;
    }

    // Handle non-wildcard paths
    const value = getNestedValue(deserialized, fieldPath);

    if (typeof value === 'string') {
      try {
        const date = new Date(value);
        setNestedValue(deserialized, fieldPath, admin.firestore.Timestamp.fromDate(date));
      } catch (error) {
        console.warn(`Failed to parse timestamp field ${fieldPath}:`, error);
      }
    } else if (Array.isArray(value)) {
      // Handle arrays of timestamp strings
      const deserializedArray = value.map(item => {
        if (typeof item === 'string') {
          try {
            return admin.firestore.Timestamp.fromDate(new Date(item));
          } catch {
            return item;
          }
        }
        return item;
      });
      setNestedValue(deserialized, fieldPath, deserializedArray);
    }
  }

  return deserialized;
}

/**
 * Deserialize timestamps in wildcard paths (e.g., "instances.*.openedAt")
 * Navigates to array and deserializes nested field in each array item
 */
function deserializeWildcardPath(
  obj: Record<string, unknown>,
  path: string
): void {
  const parts = path.split('.');
  const wildcardIndex = parts.indexOf('*');

  if (wildcardIndex === -1) return; // No wildcard found

  // Split path: "instances.*.openedAt" → "instances" + "openedAt"
  const pathToArray = parts.slice(0, wildcardIndex).join('.');
  const fieldInArrayItem = parts.slice(wildcardIndex + 1).join('.');

  // Navigate to the array
  const arrayValue = getNestedValue(obj, pathToArray);

  if (!Array.isArray(arrayValue)) return;

  // Deserialize the nested field in each array item
  for (const item of arrayValue) {
    if (item && typeof item === 'object') {
      const itemObj = item as Record<string, unknown>;
      const value = fieldInArrayItem
        ? getNestedValue(itemObj, fieldInArrayItem)
        : item;

      if (typeof value === 'string') {
        try {
          const timestamp = admin.firestore.Timestamp.fromDate(new Date(value));
          if (fieldInArrayItem) {
            setNestedValue(itemObj, fieldInArrayItem, timestamp);
          }
        } catch (error) {
          console.warn(`Failed to parse timestamp in wildcard path ${path}:`, error);
        }
      }
    }
  }
}

/**
 * Get nested value from object using dot notation path
 * Supports wildcards for arrays: "items.*.timestamp"
 *
 * @example
 * getNestedValue({ user: { profile: { name: 'Alice' }}}, 'user.profile.name')
 * // Returns: 'Alice'
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (part === '*' && Array.isArray(current)) {
      // Wildcard: return array of values
      return current;
    }

    if (current && typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * Set nested value in object using dot notation path
 * Supports wildcards for arrays: "items.*.timestamp"
 *
 * @example
 * setNestedValue({ user: { profile: {}}}, 'user.profile.name', 'Alice')
 * // Sets: obj.user.profile.name = 'Alice'
 */
function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  const parts = path.split('.');
  let current: unknown = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];

    if (part === '*' && Array.isArray(current)) {
      // Wildcard: set value in all array items
      const remainingPath = parts.slice(i + 1).join('.');
      for (const item of current) {
        if (item && typeof item === 'object') {
          setNestedValue(item as Record<string, unknown>, remainingPath, value);
        }
      }
      return;
    }

    if (current && typeof current === 'object') {
      const currentObj = current as Record<string, unknown>;
      if (!(part in currentObj)) {
        currentObj[part] = {};
      }
      current = currentObj[part];
    } else {
      return;
    }
  }

  const lastPart = parts[parts.length - 1];
  if (current && typeof current === 'object') {
    (current as Record<string, unknown>)[lastPart] = value;
  }
}

/**
 * Recursively serialize all Firestore special types in an object
 * Useful when schema doesn't specify timestamp fields
 */
export function autoSerializeFirestoreTypes(data: unknown): unknown {
  if (data instanceof admin.firestore.Timestamp) {
    return data.toDate().toISOString();
  }

  if (Array.isArray(data)) {
    return data.map(autoSerializeFirestoreTypes);
  }

  if (data && typeof data === 'object') {
    const serialized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      serialized[key] = autoSerializeFirestoreTypes(value);
    }
    return serialized;
  }

  return data;
}
