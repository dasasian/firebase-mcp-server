# @ Mention Support Guide

## Overview

The Firebase MCP server supports **@ mentions** in Claude Code, allowing you to reference Firestore documents and collections directly in your conversations.

## How It Works

When you type `@firebase` in Claude Code, you'll see a list of available resources:

```
📋 Users (User account documents)
📋 Posts (Blog post documents)
📋 Comments (Comments on posts)
🔍 analytics (Discovered - no schema)
🔍 sessions (Discovered - no schema)
📄 users/user-123 (Recent document - 5 accesses)
📄 products/prod-456 (Recent document - 2 accesses)
```

**Icons:**
- 📋 = Schema-validated collection (has validation rules)
- 🔍 = Auto-discovered collection (no schema)
- 📄 = Recently accessed document (MRU cache)

## Smart Autocomplete (MRU Cache)

The server tracks documents you access and shows them in the @ mention list for quick re-access.

**How it works:**
1. Use a tool to find a document: `firestore_query`, `firestore_read`, etc.
2. Document is automatically tracked in MRU (Most Recently Used) cache
3. Next time you type `@firebase`, that document appears in the dropdown
4. Frequently accessed documents stay at the top (max 50 documents)

**Tracked from:**
- @ mentions: `@firebase:firestore://users/user-123`
- Tool calls: `firestore_read`, `firestore_query`, `firestore_export`, `firestore_update`

**Cache details:**
- In-memory only (resets on server restart)
- Max 50 documents
- Sorted by: access count → recency
- Least-used documents evicted when limit reached

**Example workflow:**
```
1. Find users: firestore_query(collection="users", where=[...])
   → Returns: users/alice-123, users/bob-456

2. Type @firebase
   → Autocomplete shows: users/alice-123, users/bob-456

3. Select from dropdown for instant access!
```

## Usage Examples

### Reference a Specific Document

```
What's the email for @firebase:firestore://users/user-123?
```

Claude Code automatically:
1. Fetches the document data
2. Includes it in the conversation context
3. Answers your question using the data

### Reference a Collection

```
Show me the recent posts: @firebase:firestore://posts/*
```

Returns up to 10 documents from the collection (limited for context efficiency).

### Use in Analysis

```
Compare @firebase:firestore://users/user-123 with @firebase:firestore://users/user-456
```

Both documents are fetched and included for comparison.

## Resource URIs

### Format

```
firebase:firestore://<path>
```

### Examples

| URI | Description |
|-----|-------------|
| `firebase:firestore://users/user-123` | Specific user document |
| `firebase:firestore://posts/post-456` | Specific post document |
| `firebase:firestore://posts/post-1/comments/comment-2` | Nested comment document |
| `firebase:firestore://users/*` | Users collection (up to 10 docs) |
| `firebase:firestore://posts/*` | Posts collection (up to 10 docs) |

### Resource Templates

Each schema path is also published as a resource template, so a client can
address any document in that collection without the server listing them all:

| Template | Built from schema path |
|---|---|
| `firestore://users/{userId}` | `/users/{userId}` |
| `firestore://posts/{postId}/comments/{commentId}` | `/posts/{postId}/comments/{commentId}` |

Fill in the placeholder to get a real URI — `firestore://users/user-123`.

Templates come from `resources/templates/list`; the concrete `firestore://users/*`
browse entries come from `resources/list`. Nested schemas appear only as
templates, because there is no browsable collection until a parent id is chosen.

### Change Notifications

The server declares the `resources.listChanged` capability and sends
`notifications/resources/list_changed` when the resource list actually changes —
a document joining the recently-used list, an eviction dropping one off the end,
or auto-discovery finding a different set of collections.

Re-reading a document already in the list does not notify. It only bumps that
document's access count, and a batch export would otherwise fire a notification
per document. Notifications are coalesced onto the next tick, so one batch
produces one notification.

## Schema-Based vs Discovered

### Schema-Based Collections (📋)

**Shown when:**
- Collection is defined in `firestore-schemas.json`

**Benefits:**
- Rich metadata (description, field count)
- Validation available
- Timestamp serialization
- Field status tracking (experimental/legacy)

**Example:**
```json
{
  "schemas": {
    "/users/{userId}": {
      "description": "User account documents",
      "schema": { /* ... */ }
    }
  }
}
```

Shows as: `📋 User account documents`

### Auto-Discovered Collections (🔍)

**Shown when:**
- Collection exists in Firestore
- NOT defined in schema

**Benefits:**
- Explore unknown databases
- Discover new collections
- No configuration needed

**Limitations:**
- No validation
- Auto-serialize only (may miss custom types)
- Generic description

## Configuration

### Enable/Disable Auto-Discovery

```bash
# In .mcp.json env section
{
  "env": {
    "FIRESTORE_AUTO_DISCOVER": "true"  // or "false"
  }
}
```

**Default:** `true`

### Cache Duration

```bash
{
  "env": {
    "FIRESTORE_DISCOVERY_CACHE_TTL": "300"  // seconds (5 minutes default)
  }
}
```

Auto-discovery results are cached to minimize Firestore reads.

**Cache behavior:**
- First @ mention: Queries Firestore for collections
- Next 5 minutes: Uses cached results
- After 5 minutes: Refreshes cache automatically

## Performance & Cost

### Auto-Discovery Cost

**Operation:** `db.listCollections()`
- **Cost:** 1 read operation per call
- **Price:** ~$0.000001 per call
- **Frequency:** Once per 5 minutes (with default cache)
- **Daily cost:** ~$0.0003 (288 calls/day max)

**Verdict:** Negligible cost for the convenience.

### Context Limits

When referencing collections with `/*`:
- **Limit:** 10 documents max
- **Reason:** Prevent context overflow
- **Solution:** Use `firestore_query` tool for larger queries

## Advanced Usage

### Nested Collections

```
@firebase:firestore://posts/post-123/comments/comment-456
```

Works with deeply nested paths.

### Schema Validation

Documents from schema-based resources are automatically validated:

```
@firebase:firestore://users/user-123
```

**If valid:**
```json
{
  "id": "user-123",
  "email": "alice@example.com",
  "username": "alice",
  "createdAt": "2024-01-15T10:30:00Z"
}
```

**If invalid:**
Validation warnings included (if configured in schema).

### Combining with Tools

@ mentions and tools work together:

```
Get user data: @firebase:firestore://users/user-123

Then count their posts:
<firestore_count
  collection="posts"
  where={[{ field: "authorId", operator: "==", value: "user-123" }]}
/>
```

## Troubleshooting

### "No resources found"

**Cause:** No schema file loaded or auto-discovery disabled

**Solution:**
1. Check schema file path in startup logs
2. Verify `FIRESTORE_AUTO_DISCOVER=true`
3. Check Firebase credentials

### "Document not found"

**Cause:** Document doesn't exist or incorrect path

**Solution:**
1. Verify path format: `collection/docId` or `collection/docId/subcollection/docId`
2. Check document exists in Firestore Console
3. Verify permissions (service account has read access)

### "Auto-discovery failed"

**Cause:** Firebase initialization issue or permissions

**Solution:**
1. Check Firebase credentials
2. Verify service account has `roles/datastore.viewer` permission
3. Check startup logs for Firebase errors

### Slow Performance

**Cause:** Auto-discovery not cached

**Solution:**
1. Increase cache TTL: `FIRESTORE_DISCOVERY_CACHE_TTL=600` (10 minutes)
2. Or disable auto-discovery: `FIRESTORE_AUTO_DISCOVER=false`

## Best Practices

### 1. Use Schema for Important Collections

Define schemas for frequently accessed collections:
- Better performance (no runtime discovery)
- Validation and field status
- Rich metadata for Claude

### 2. Limit Collection References

When referencing collections with `/*`:
- Remember: Only 10 documents returned
- Use tools for larger queries
- Use filters to get relevant subset

### 3. Cache Configuration

For databases with many collections:
- Increase cache TTL to reduce API calls
- Consider disabling auto-discovery if schema is complete

### 4. Security

Service account permissions:
- **Minimum:** `roles/datastore.viewer` (read-only)
- **Recommended:** Don't grant write permissions to MCP server
- Use separate service accounts for read vs write operations

## Next Steps

- [Configuration Guide](./configuration.md) - Define schemas
- [Installation Guide](./installation.md) - Setup instructions
- [Examples](../examples/) - See working examples
