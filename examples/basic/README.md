# Basic Blog Example

Simple blog application schema demonstrating all Firestore MCP server features.

## Schema Structure

```
/users/{userId}               - User accounts
/posts/{postId}               - Blog posts
/posts/{postId}/comments/{commentId}  - Comments (nested collection)
/categories/{categoryId}      - Post categories
```

## Features Demonstrated

### 1. Path-Based Schema Matching
Schemas follow Firebase's `firestore.rules` path convention with parameters:
- `/users/{userId}` matches `/users/user-123`
- `/posts/{postId}/comments/{commentId}` matches `/posts/post-456/comments/comment-789`

### 2. Field Status Metadata
Shows schema evolution patterns:

**Experimental field** (new, in testing):
```json
"lastLoginAt": {
  "type": "string",
  "format": "date-time",
  "x-status": "experimental",
  "x-since": "2024-11-01"
}
```

**Legacy field** (deprecated, being phased out):
```json
"category": {
  "type": "string",
  "x-status": "legacy",
  "x-deprecated": "2024-10-01",
  "x-replacedBy": "categoryId"
}
```

### 3. Validation Modes
- `posts`: **warn** mode (show warnings, don't block)
- `categories`: **strict** mode (reject unknown fields)
- `users`: **warn** mode (default)

### 4. Timestamp Serialization
Automatic Firestore Timestamp ↔ ISO 8601 conversion:
```json
"timestampFields": ["createdAt", "updatedAt", "publishedAt"]
```

### 5. Nested Collections
Comments are nested under posts:
```
/posts/post-123/comments/comment-456
```

### 6. Collection Groups
All comments across all posts queryable via collection group:
```json
"collectionGroups": {
  "comments": {
    "description": "All comments across all posts"
  }
}
```

### 7. Composite Indexes
Query validation against `firestore.indexes.json`:
- Posts by status + published date
- Posts by author + created date
- Posts by category + view count
- Comments by author (collection group)

## Usage Examples

### Read a user
```typescript
<firestore_read path="users/user-123" validate={true} />
```

### Export all published posts
```typescript
<firestore_query
  collection="posts"
  where={[{ field: "status", operator: "==", value: "published" }]}
  orderBy={[{ field: "publishedAt", direction: "desc" }]}
  limit={10}
/>
```

### Count comments by author
```typescript
<firestore_count
  collection="posts/post-123/comments"
  where={[{ field: "authorId", operator: "==", value: "user-456" }]}
/>
```

### Validate post data
```typescript
<firestore_validate
  path="posts/post-123"
  mode="strict"
/>
```

### Get collection stats
```typescript
<firestore_stats
  collection="posts"
  sampleSize={20}
/>
```

## Running the Server

```bash
# From project root
npm run build

# Start server with this example
node dist/index.js \
  examples/basic/firestore-schemas.json \
  examples/basic/firestore.indexes.json
```

## Environment Variables

```bash
export FIREBASE_PROJECT_ID="your-project-id"
export FIREBASE_SERVICE_ACCOUNT_PATH="./path/to/service-account.json"
```
