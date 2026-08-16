# Firebase MCP Server

<p>
  <a href="https://www.npmjs.com/package/@dasasian/firebase-mcp-server"><img alt="npm" src="https://img.shields.io/npm/v/@dasasian/firebase-mcp-server?style=flat-square&color=235a9b"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-235a9b?style=flat-square"></a>
  <a href="https://modelcontextprotocol.io"><img alt="Model Context Protocol server" src="https://img.shields.io/badge/MCP-server-235a9b?style=flat-square"></a>
  <img alt="Node 18+" src="https://img.shields.io/badge/node-18%2B-5fa04e?style=flat-square">
</p>

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

## Install

Add it to your MCP client (e.g. Claude Code) — runs via `npx`, no global install needed:

```jsonc
{
  "mcpServers": {
    "firebase": {
      "command": "npx",
      "args": ["-y", "@dasasian/firebase-mcp-server", "start", "./firestore-schemas.json"]
    }
  }
}
```

`start` takes an optional schema config path (default `./firestore-schemas.json`) and an optional indexes path (default `./firestore.indexes.json`) — see [Schema Format](#schema-format). Firebase auth uses Application Default Credentials.

Or install the CLI globally:

```bash
npm install -g @dasasian/firebase-mcp-server
firebase-mcp start ./firestore-schemas.json
```

## Development (from source)

```bash
npm install
npm run build
npm run cli -- start --config ./examples/basic/firestore-schemas.json
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

The server ships 33 tools in four groups. Every tool declares MCP annotations
(`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) so a client
can auto-approve reads and ask before writes.

### Choosing which tools to load

All 33 tool definitions cost roughly 12k tokens of context on every session. If
you only need part of the surface, narrow it:

```bash
# Only Firestore (12 tools, ~4.3k tokens)
firebase-mcp start --tools firestore

# Firestore plus Auth
firebase-mcp start --tools firestore,auth
```

Or set it in your MCP client config:

```bash
export FIREBASE_MCP_TOOLS=firestore,storage
```

The `--tools` flag wins over the environment variable. Leaving both unset loads
everything, so upgrading never hides a tool you were already using. Calling a
tool from a group you switched off returns an error naming the group to add.

| Group | Tools | ~Tokens |
|---|---:|---:|
| `firestore` | 12 | 4,341 |
| `storage` | 14 | 4,152 |
| `auth` | 6 | 2,075 |
| `logs` | 1 | 1,817 |
| *all (default)* | *33* | *12,387* |

### Firestore (12) — `--tools firestore`

- `firestore_show_collections` — Show collections *(read)*
- `firestore_read` — Read document *(read)*
- `firestore_export` — Export collection *(read)*
- `firestore_validate` — Validate against schema *(read)*
- `firestore_query_select` — Query documents *(read)*
- `firestore_query_collection_group` — Query collection group *(read)*
- `firestore_count` — Count documents *(read)*
- `firestore_sum` — Sum a field *(read)*
- `firestore_stats` — Collection statistics *(read)*
- `firestore_import` — Import document *(write, destructive)*
- `firestore_update` — Update documents *(write, destructive)*
- `firestore_delete` — Delete documents *(write, destructive)*

### Firebase Auth (6) — `--tools auth`

- `firebase_auth_list_users` — List users *(read)*
- `firebase_auth_get_user` — Get user *(read)*
- `firebase_auth_create_user` — Create user *(write)*
- `firebase_auth_update_user` — Update user *(write, destructive)*
- `firebase_auth_delete_user` — Delete user *(write, destructive)*
- `firebase_auth_revoke_sessions` — Revoke sessions *(write, destructive)*

### Firebase Storage (14) — `--tools storage`

- `firebase_storage_list_buckets` — List buckets *(read)*
- `firebase_storage_ls` — List files *(read)*
- `firebase_storage_stat` — File metadata *(read)*
- `firebase_storage_find` — Find files *(read)*
- `firebase_storage_get_url` — Get file URL *(read)*
- `firebase_storage_get_access` — Get file access *(read)*
- `firebase_storage_read` — Download file to a local temp path *(write)*
- `firebase_storage_upload` — Upload file *(write, destructive)*
- `firebase_storage_rm` — Delete file *(write, destructive)*
- `firebase_storage_cp` — Copy file *(write, destructive)*
- `firebase_storage_mv` — Move file *(write, destructive)*
- `firebase_storage_sync` — Sync bucket to local *(write, destructive)*
- `firebase_storage_push` — Push local to bucket *(write, destructive)*
- `firebase_storage_set_access` — Set file access *(write, destructive)*

### Cloud Logging (1) — `--tools logs`

- `firebase_functions_logs` — Query Cloud Functions logs with SQL-like syntax *(write)*

`firebase_storage_read` and `firebase_functions_logs` are not marked read-only
because they write: the first downloads to a local temp file, the second updates
its auto-discovered logging schema on disk.

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
