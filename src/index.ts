#!/usr/bin/env node

/**
 * Firestore MCP Server
 * Main entry point for the Model Context Protocol server
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Initialize config and Firebase
import { initializeConfigLoader, getConfig, isInitialized } from './shared/config-loader.js';
import { initializeIndexLoader } from './shared/index-loader.js';
import { initializeFirebase } from './shared/firebase.js';
import { getDiscoveredCollections, getSchemaCollectionPaths, getMRUDocuments, trackDocumentAccess } from './shared/resource-discovery.js';
import { initializeLoggingSchemaLoader } from './shared/logging-schema-loader.js';

// The tool table: handlers, safety annotations, and output shapes
import {
  parseToolGroups,
  selectTools,
  validateToolArgs,
  type ToolSelection,
} from './tools/registry.js';

// Tools used directly to serve resources
import { firestoreRead } from './tools/read.js';
import { firestoreExport } from './tools/export.js';

/**
 * Main server instance
 */
const server = new Server(
  {
    name: 'firebase-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

/**
 * Which tool groups this process exposes. Set during startup, before the
 * transport is connected, so no request can observe the default.
 */
let tools: ToolSelection = selectTools(parseToolGroups(undefined).groups);

/**
 * List available tools
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: tools.definitions };
});

/**
 * List available resources (@ mention support)
 * Shows schema-based collections + auto-discovered collections + MRU documents
 */
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const resources: Array<{
    uri: string;
    name: string;
    description?: string;
    mimeType: string;
  }> = [];

  const knownCollections = new Set<string>();

  // 1. Add schema-based resources (rich metadata)
  if (isInitialized()) {
    const config = getConfig();
    const schemaCollections = getSchemaCollectionPaths(config.schemas);

    for (const [path, definition] of Object.entries(config.schemas)) {
      const cleanPath = path.replace(/^\/+/, '');

      resources.push({
        uri: `firestore://${cleanPath}`,
        name: `📋 ${definition.description || cleanPath}`,
        description: `Schema-validated collection`,
        mimeType: 'application/json',
      });
    }

    // Track known collections
    schemaCollections.forEach(col => knownCollections.add(col));
  }

  // 2. Auto-discover collections
  try {
    const discoveredCollections = await getDiscoveredCollections();

    for (const collectionId of discoveredCollections) {
      // Only add if NOT already in schema
      if (!knownCollections.has(collectionId)) {
        resources.push({
          uri: `firestore://${collectionId}/*`,
          name: `🔍 ${collectionId}`,
          description: 'Discovered collection (no schema)',
          mimeType: 'application/json',
        });
      }
    }
  } catch (error) {
    console.error('[Resources] Auto-discovery failed:', error);
  }

  // 3. Add MRU (Most Recently Used) documents
  const mruDocs = getMRUDocuments();
  resources.push(...mruDocs);

  return { resources };
});

/**
 * Read a resource by URI
 * Supports: firestore://path/to/document
 */
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;

  // Parse URI: firestore://users/user-123
  if (!uri.startsWith('firestore://')) {
    throw new Error('Invalid URI scheme. Expected firestore://');
  }

  const path = uri.replace('firestore://', '');

  // Handle wildcard collection URIs
  if (path.endsWith('/*')) {
    const collectionPath = path.replace('/*', '');

    // Export collection
    const result = await firestoreExport({
      collection: collectionPath,
      limit: 10, // Limit for @ mention context
    });

    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  // Handle specific document URIs
  const result = await firestoreRead({ path });

  if (!result.exists) {
    throw new Error(`Document not found: ${path}`);
  }

  // Track document access for MRU cache
  trackDocumentAccess(path);

  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(result.data, null, 2),
      },
    ],
  };
});

/**
 * Handle tool calls
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const entry = tools.get(name);

  if (!entry) {
    const group = tools.disabledGroup(name);

    // Distinguish "this tool does not exist" from "you switched its group
    // off", so a narrowed surface is a clear message rather than a mystery.
    return errorResult(
      group
        ? `Tool ${name} is in the "${group}" group, which is not enabled. ` +
            `Enabled groups: ${tools.groups.join(', ')}. ` +
            `Add "${group}" to --tools or FIREBASE_MCP_TOOLS to use it.`
        : `Unknown tool: ${name}`
    );
  }

  const invalid = validateToolArgs(entry, args ?? {});

  if (invalid) {
    return errorResult(invalid);
  }

  try {
    const result = await entry.run(args ?? {});

    return {
      // `content` keeps older clients working; `structuredContent` is the
      // typed result described by the tool's outputSchema.
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      structuredContent: result as Record<string, unknown>,
    };
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
});

/**
 * Build a tool result that reports failure to the model rather than throwing.
 * Error results carry no structuredContent — the spec exempts them from the
 * tool's outputSchema.
 */
function errorResult(message: string) {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}

/**
 * Start the server
 */
async function main() {
  // Split flags from the positional [config] [indexes] arguments, so passing
  // --tools does not get mistaken for a schema path.
  const argv = process.argv.slice(2);
  const flags = argv.filter(arg => arg.startsWith('--'));
  const positional = argv.filter(arg => !arg.startsWith('--'));

  // Get config path from command line args or environment
  const configPath =
    positional[0] || process.env.FIRESTORE_SCHEMA_PATH || './firestore-schemas.json';

  const indexPath =
    positional[1] || process.env.FIRESTORE_INDEX_PATH || './firestore.indexes.json';

  // Narrow the tool surface. The flag wins over the environment variable.
  const toolsFlag = flags
    .find(arg => arg === '--tools' || arg.startsWith('--tools='))
    ?.split('=')[1];

  const selection = parseToolGroups(toolsFlag ?? process.env.FIREBASE_MCP_TOOLS);
  tools = selectTools(selection.groups);

  console.error('[MCP] Firestore MCP Server starting...');
  console.error(`[MCP] Schema config: ${configPath}`);
  console.error(`[MCP] Index config: ${indexPath}`);

  if (selection.unknown.length > 0) {
    console.error(`[MCP] Warning: unknown tool groups ignored: ${selection.unknown.join(', ')}`);
  }

  console.error(
    selection.usedDefault
      ? `[MCP] Tools: all ${tools.definitions.length} (set --tools or FIREBASE_MCP_TOOLS to narrow)`
      : `[MCP] Tools: ${tools.definitions.length} from groups ${tools.groups.join(', ')}`
  );

  try {
    // Initialize configuration (optional - discovery mode if not found)
    try {
      await initializeConfigLoader(configPath);
      console.error('[MCP] Schema configuration loaded');
    } catch (error) {
      console.error('[MCP] Warning: Schema configuration not loaded (discovery-only mode)');
    }

    // Initialize indexes (optional)
    try {
      await initializeIndexLoader(indexPath);
      console.error('[MCP] Index configuration loaded');
    } catch (error) {
      console.error('[MCP] Warning: Index configuration not loaded (query validation disabled)');
    }

    // Initialize Firebase
    await initializeFirebase();
    console.error('[MCP] Firebase initialized');

    // Initialize logging schema (optional)
    try {
      await initializeLoggingSchemaLoader();
      console.error('[MCP] Logging schema loaded');
    } catch (error) {
      console.error('[MCP] Warning: Logging schema not loaded (will create on first query)');
    }

    // Log dev log file config if set
    if (process.env.DEV_LOG_FILE) {
      console.error('[MCP] Local log file configured:', process.env.DEV_LOG_FILE);
    }

    // Start stdio transport
    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error('[MCP] Server ready');
  } catch (error) {
    console.error('[MCP] Startup failed:', error);
    process.exit(1);
  }
}

// Run the server
main().catch(console.error);
