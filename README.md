# Firebase MCP Server

General-purpose Model Context Protocol (MCP) server for Firebase (Firestore, Storage, Auth, Functions Logging) with schema-driven validation and context-efficient tools.

## Features

- **@ Mention Support** - Reference Firestore documents with `@firebase:firestore://users/user-123`
- **Smart Autocomplete** - MRU cache tracks accessed documents for quick re-reference
- **Auto-Discovery** - Shows both schema-based AND discovered collections
- **Path-based schemas** - Follows Firebase `firestore.rules` convention
- **Schema evolution** - Field status metadata (experimental → official → legacy)
- **Hot reload** - File watching, no restart needed when schemas change
- **Flexible validation** - Three modes: strict, warn (default), permissive
- **Works without schemas** - Discovery mode for exploring unknown databases
- **Context-efficient tools** - 99% token reduction for large datasets
- **Index-aware queries** - Validates queries against `firestore.indexes.json`
- **Functions logging** - SQL-like queries for Cloud Functions logs with aggregations and label filtering

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# Run CLI
npm run cli -- start --config ./examples/neatpour/firestore-schemas.json
```

## @ Mention Support (Resources)

Reference Firestore documents directly in Claude Code:

```
What's the email for @firebase:firestore://users/user-123?
Show me all posts: @firebase:firestore://posts/*
```

### How It Works

When you type `@firebase` in Claude Code:

**Shows schema-based collections** (with validation):
- 📋 Users (User account documents)
- 📋 Posts (Blog post documents)
- 📋 Comments (Comments on posts)

**Plus auto-discovered collections** (no schema):
- 🔍 analytics
- 🔍 sessions
- 🔍 audit_logs

### Configuration

```bash
# Enable/disable auto-discovery (default: true)
export FIRESTORE_AUTO_DISCOVER=true

# Cache duration in seconds (default: 300 = 5 minutes)
export FIRESTORE_DISCOVERY_CACHE_TTL=300
```

**Auto-discovery cost**: ~$0.0003/day (negligible)

## Tools

### Core Tools (6)
- `firestore_read` - Read single document
- `firestore_export` - Batch export collections
- `firestore_validate` - Schema validation
- `firestore_import` - Import with dry-run
- `firestore_update` - Safe field updates
- `firestore_query` - Index-aware queries

### Context-Efficient Tools (4)
- `firestore_count` - Count without fetching documents (99.96% savings)
- `firestore_select` - Field projection (90% savings)
- `firestore_sum` - Aggregate without fetching (99.91% savings)
- `firestore_stats` - Collection overview (99.3% savings)

### Firebase Functions Tools (1)
- `firebase_functions_logs` - Query Cloud Functions logs with SQL-like syntax

**Example queries:**
```json
// Discover what functions exist
{"distinct": "functionName"}

// Show recent errors
{"where": [{"field": "severity", "operator": "==", "value": "ERROR"}], "limit": 20}

// Top error patterns with counts
{"groupBy": ["textPayload"], "aggregates": [{"field": "*", "operation": "count", "alias": "count"}], "where": [{"field": "severity", "operator": "==", "value": "ERROR"}], "orderBy": [{"field": "count", "direction": "desc"}], "limit": 10}

// Filter by custom labels (e.g., user, environment)
{"where": [{"field": "labels.user_id", "operator": "==", "value": "123"}]}
```

## Schema Format

Schemas follow Firebase's path-based convention:

```json
{
  "schemas": {
    "/organizations/{organizationId}": {
      "description": "Organization documents",
      "schema": {
        "type": "object",
        "required": ["id", "name"],
        "properties": {
          "id": { "type": "string" },
          "name": { "type": "string" }
        }
      }
    },
    "/organizations/{organizationId}/products/{productId}": {
      "description": "Product catalog",
      "schema": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "category": {
            "type": "string",
            "x-status": "legacy",
            "x-replacedBy": "productType"
          },
          "productType": {
            "type": "string",
            "x-status": "experimental"
          }
        }
      },
      "timestampFields": ["createdAt", "updatedAt"]
    }
  }
}
```

## Documentation

- [Installation Guide](docs/installation.md)
- [@ Mention Support Guide](docs/resources-guide.md) - How to use `@firebase:firestore://` references
- [Configuration Reference](docs/configuration.md)
- [Schema Creation Guide](docs/schema-guide.md)
- [Functions Logging Guide](docs/logging-guide.md) - Query Cloud Functions logs with SQL-like syntax, aggregations, and custom labels

## License

MIT
