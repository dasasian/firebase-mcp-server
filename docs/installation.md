# Installation Guide

## Prerequisites

- Node.js >= 18.0.0
- npm (comes with Node.js)
- Firebase project with Firestore
- Service account credentials (optional, for authentication)

## Installation

### Option 1: Local Development (Recommended)

```bash
# Clone or navigate to the project
cd /path/to/firebase-mcp-server

# Install dependencies
npm install

# Build the project
npm run build
```

### Option 2: Global Installation (Future)

```bash
# Not yet published to npm
# Will be available as:
npm install -g firebase-mcp-server
```

## Firebase Setup

### 1. Get Service Account Credentials

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project
3. Navigate to **Project Settings** → **Service Accounts**
4. Click **Generate New Private Key**
5. Save the JSON file securely (e.g., `./credentials/service-account.json`)

**⚠️ Never commit this file to git!**

### 2. Set Environment Variables

Create a `.env` file or export variables:

```bash
export FIREBASE_PROJECT_ID="your-project-id"
export FIREBASE_SERVICE_ACCOUNT_PATH="./credentials/service-account.json"
```

## Configuration

### 1. Create Schema File

Create `firestore-schemas.json` (see [Configuration Guide](./configuration.md)):

```json
{
  "schemas": {
    "/users/{userId}": {
      "description": "User documents",
      "schema": {
        "type": "object",
        "required": ["id", "email"],
        "properties": {
          "id": { "type": "string" },
          "email": { "type": "string", "format": "email" }
        }
      },
      "timestampFields": ["createdAt"]
    }
  }
}
```

### 2. (Optional) Create Index File

Copy your existing `firestore.indexes.json` or reference it:

```bash
# If you already have firestore.indexes.json in your project
cp /path/to/your/project/firestore.indexes.json ./
```

## Claude Code Integration

### 1. Add to `.mcp.json` (Claude Code Configuration)

In your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "firebase": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/Users/damith/Work/Dasasian/firebase-mcp-server/dist/index.js",
        "./config/firestore-schemas.json",
        "./firestore.indexes.json"
      ],
      "env": {
        "FIREBASE_PROJECT_ID": "your-project-id",
        "FIREBASE_SERVICE_ACCOUNT_PATH": "./.credentials/service-account.json"
      }
    }
  }
}
```

### 2. Restart Claude Code

```bash
# Claude Code will automatically detect the new MCP server
# You should see "firebase" in the available servers list
```

## Verify Installation

### Test the Server Manually

```bash
# Start the server
node dist/index.js \
  examples/basic/firestore-schemas.json \
  examples/basic/firestore.indexes.json

# Should output:
# [MCP] Firebase MCP Server starting...
# [MCP] Schema configuration loaded
# [MCP] Index configuration loaded
# [MCP] Firebase initialized
# [MCP] Server ready
```

### Test with Claude Code

In Claude Code, try:

```
List available Firestore tools
```

You should see:
- `firestore_read`
- `firestore_export`
- `firestore_validate`
- `firestore_import`
- `firestore_update`
- `firestore_query`
- `firestore_count`
- `firestore_select`
- `firestore_sum`
- `firestore_stats`

## Troubleshooting

### "Module not found" errors

```bash
# Rebuild the project
npm run build
```

### "Firebase initialization failed"

Check:
1. `FIREBASE_PROJECT_ID` is set correctly
2. Service account file path is correct
3. Service account has Firestore permissions

### "Schema file not found"

```bash
# Use absolute paths in .mcp.json
"args": [
  "/absolute/path/to/dist/index.js",
  "/absolute/path/to/firestore-schemas.json"
]
```

### Hot Reload Not Working

The server automatically watches the schema file for changes. If changes aren't detected:
1. Verify file watcher permissions
2. Check for editor quirks (some editors use atomic writes)
3. Restart Claude Code

## Next Steps

- [Configuration Guide](./configuration.md) - Learn schema format
- [Schema Creation Guide](./schema-guide.md) - Write your first schema
- [Examples](../examples/) - See working examples
