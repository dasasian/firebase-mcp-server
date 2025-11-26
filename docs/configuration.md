# Configuration Reference

## Schema File Format

The schema file (`firestore-schemas.json`) uses a path-based format following Firebase's `firestore.rules` convention.

## Basic Structure

```json
{
  "schemas": {
    "/path/{param}/to/{document}": {
      "description": "Document description",
      "schema": { /* JSON Schema */ },
      "timestampFields": ["createdAt", "updatedAt"],
      "validationMode": "warn"
    }
  },
  "collectionGroups": {
    "groupName": {
      "description": "Collection group description"
    }
  },
  "definitions": {
    "SharedType": { /* Reusable JSON Schema */ }
  }
}
```

## Path Patterns

### Firebase Rules Convention

Paths follow the same pattern as `firestore.rules`:

```json
{
  "schemas": {
    "/users/{userId}": { },
    "/users/{userId}/posts/{postId}": { },
    "/organizations/{orgId}/teams/{teamId}/members/{memberId}": { }
  }
}
```

### Path Parameters

Path parameters (e.g., `{userId}`) are:
- Extracted and available for reference
- Used for pattern matching
- Support any valid Firestore document ID

```json
"/users/{userId}"  // Matches: /users/abc123
"/posts/{postId}/comments/{commentId}"  // Matches: /posts/post-1/comments/comment-2
```

### Alternating Structure

Firestore requires alternating collection/document paths:

```
✅ /users                          (collection)
✅ /users/{id}                     (document)
✅ /users/{id}/posts               (collection)
✅ /users/{id}/posts/{postId}      (document)

❌ /users/posts                    (invalid: collection→collection)
❌ /users/{id}/{id2}               (invalid: document→document)
```

## Document Schema Definition

### Required Fields

```json
{
  "/users/{userId}": {
    "schema": {
      "type": "object",
      "required": ["id", "email", "username"],
      "properties": {
        "id": { "type": "string" },
        "email": { "type": "string", "format": "email" },
        "username": { "type": "string" }
      }
    }
  }
}
```

### Field Types

Uses JSON Schema Draft-07:

```json
{
  "properties": {
    "name": { "type": "string" },
    "age": { "type": "number", "minimum": 0 },
    "isActive": { "type": "boolean" },
    "tags": {
      "type": "array",
      "items": { "type": "string" }
    },
    "metadata": {
      "type": "object",
      "properties": {
        "key": { "type": "string" }
      }
    }
  }
}
```

### Field Constraints

```json
{
  "username": {
    "type": "string",
    "minLength": 3,
    "maxLength": 30,
    "pattern": "^[a-zA-Z0-9_]+$"
  },
  "email": {
    "type": "string",
    "format": "email"
  },
  "website": {
    "type": "string",
    "format": "uri"
  },
  "status": {
    "type": "string",
    "enum": ["active", "inactive", "suspended"]
  }
}
```

## Field Status Metadata

### Official Fields (Default)

No metadata needed:

```json
{
  "name": { "type": "string" }
}
```

### Experimental Fields

New fields in testing:

```json
{
  "aiSuggestions": {
    "type": "array",
    "items": { "type": "string" },
    "x-status": "experimental",
    "x-since": "2024-11-01",
    "x-description": "AI-generated content suggestions"
  }
}
```

### Legacy Fields

Deprecated fields being phased out:

```json
{
  "category": {
    "type": "string",
    "x-status": "legacy",
    "x-deprecated": "2024-10-01",
    "x-replacedBy": "categoryId",
    "x-removeAfter": "2025-01-01",
    "x-migrationNote": "Use categoryId (reference) instead of category (string)"
  }
}
```

### Field Status Summary

| Status | Description | Validation Behavior |
|--------|-------------|---------------------|
| *(none)* | Official/stable field | Full validation |
| `experimental` | In testing, may change | Validate with warning |
| `legacy` | Deprecated, being removed | Warn in warn mode, reject in strict mode |
| `optional` | Nice-to-have, not critical | Validate but never required |

## Timestamp Fields

### Configuration

```json
{
  "/posts/{postId}": {
    "schema": { /* ... */ },
    "timestampFields": ["createdAt", "updatedAt", "publishedAt"]
  }
}
```

### Automatic Serialization

- **Export/Read**: Firestore Timestamp → ISO 8601 string
- **Import**: ISO 8601 string → Firestore Timestamp

```json
// In Firestore
{ "createdAt": Timestamp(2024, 11, 25, 10, 30, 0) }

// Serialized (returned to Claude)
{ "createdAt": "2024-11-25T10:30:00.000Z" }
```

### Nested Timestamps

Use dot notation for nested fields:

```json
{
  "timestampFields": [
    "createdAt",
    "metadata.updatedAt",
    "events.*.timestamp"  // Array of timestamps
  ]
}
```

## Validation Modes

### Per-Schema Configuration

```json
{
  "/users/{userId}": {
    "schema": { /* ... */ },
    "validationMode": "strict"  // or "warn" or "permissive"
  }
}
```

### Mode Comparison

| Mode | Unknown Fields | Legacy Fields | Invalid Data |
|------|---------------|---------------|--------------|
| **strict** | ❌ Reject | ❌ Reject | ❌ Reject |
| **warn** (default) | ⚠️ Warn | ⚠️ Warn | ❌ Reject |
| **permissive** | ✅ Allow | ✅ Allow | ⚠️ Warn |

### When to Use Each

- **strict**: Production data, critical collections
- **warn**: Development, evolving schemas
- **permissive**: Data migration, exploration

## Collection Groups

For querying across nested collections:

```json
{
  "schemas": {
    "/posts/{postId}/comments/{commentId}": {
      "schema": { /* ... */ }
    }
  },
  "collectionGroups": {
    "comments": {
      "description": "All comments across all posts",
      "schema": { "$ref": "#/schemas//posts/{postId}/comments/{commentId}" }
    }
  }
}
```

## Shared Definitions

Reusable types:

```json
{
  "schemas": {
    "/users/{userId}": {
      "schema": {
        "properties": {
          "address": { "$ref": "#/definitions/Address" }
        }
      }
    }
  },
  "definitions": {
    "Address": {
      "type": "object",
      "properties": {
        "street": { "type": "string" },
        "city": { "type": "string" },
        "zip": { "type": "string" }
      }
    }
  }
}
```

## Complete Example

```json
{
  "schemas": {
    "/users/{userId}": {
      "description": "User account documents",
      "schema": {
        "type": "object",
        "required": ["id", "email", "createdAt"],
        "properties": {
          "id": { "type": "string" },
          "email": { "type": "string", "format": "email" },
          "legacyUsername": {
            "type": "string",
            "x-status": "legacy",
            "x-deprecated": "2024-01-01",
            "x-replacedBy": "username"
          },
          "username": {
            "type": "string",
            "minLength": 3
          },
          "betaFeatures": {
            "type": "array",
            "items": { "type": "string" },
            "x-status": "experimental",
            "x-since": "2024-11-01"
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          }
        }
      },
      "timestampFields": ["createdAt", "updatedAt"],
      "validationMode": "warn"
    }
  }
}
```

## Hot Reload

The server automatically watches the schema file and reloads when it changes:

```bash
# Edit firestore-schemas.json
# Server detects change
[Config] Schema file changed, reloaded

# No restart needed!
```

## Next Steps

- [Schema Creation Guide](./schema-guide.md) - Write your first schema
- [Examples](../examples/) - See complete examples
