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
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Initialize config and Firebase
import { initializeConfigLoader, getConfig, isInitialized } from './shared/config-loader.js';
import { initializeIndexLoader } from './shared/index-loader.js';
import { initializeFirebase } from './shared/firebase.js';
import { getDiscoveredCollections, getSchemaCollectionPaths, getMRUDocuments, trackDocumentAccess, onResourceListChanged } from './shared/resource-discovery.js';
import { getCollectionPath, hasPathParameter, normalizePath } from './shared/path-matcher.js';
import { parseServerArgs } from './shared/cli-args.js';
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
    version: '1.1.0',
  },
  {
    capabilities: {
      tools: {},
      // listChanged: the MRU document list and the auto-discovered collection
      // list both move while the server runs.
      resources: { listChanged: true },
    },
  }
);

/**
 * Which tool groups this process exposes. Assigned in main() before the
 * transport is connected, so no request can observe it unset.
 */
let tools: ToolSelection;

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
  //
  // A schema path like "/users/{userId}" describes a shape, not a document, so
  // it is advertised through resources/templates/list. What belongs here is the
  // collection it lives in — "firestore://users/*" — which the read handler can
  // actually serve. Nested schemas such as "/posts/{postId}/comments/{id}" have
  // no browsable collection until a parent id is chosen, so they are templates
  // only.
  if (isInitialized()) {
    const config = getConfig();
    const schemaCollections = getSchemaCollectionPaths(config.schemas);

    for (const [path, definition] of Object.entries(config.schemas)) {
      const collectionPath = getCollectionPath(normalizePath(path));

      if (!collectionPath || hasPathParameter(collectionPath)) {
        continue;
      }

      resources.push({
        uri: `firestore://${collectionPath}/*`,
        name: `📋 ${definition.description || collectionPath}`,
        description: 'Schema-validated collection',
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
 * List resource templates (@ mention support for documents that are not in the
 * recently-used list yet)
 *
 * Each schema path becomes an RFC 6570 template — "/users/{userId}" is already
 * in that syntax — so a client can build a URI for any document without the
 * server having to enumerate them. These were previously published as concrete
 * resources, which meant reading one looked up a document whose id was the
 * literal text "{userId}" and always failed.
 */
server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
  if (!isInitialized()) {
    return { resourceTemplates: [] };
  }

  const config = getConfig();

  const resourceTemplates = Object.entries(config.schemas).map(([path, definition]) => {
    const cleanPath = normalizePath(path);

    return {
      uriTemplate: `firestore://${cleanPath}`,
      name: `📋 ${definition.description || cleanPath}`,
      description: `Schema-validated document at ${cleanPath}`,
      mimeType: 'application/json',
    };
  });

  return { resourceTemplates };
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
 * Tell the client its copy of the resource list is out of date.
 *
 * Coalesced onto the next tick: exporting a collection tracks every document
 * it touched, and the client only needs one notification for the batch.
 */
function watchResourceList() {
  let pending = false;

  onResourceListChanged(() => {
    if (pending) return;
    pending = true;

    setTimeout(() => {
      pending = false;
      server.sendResourceListChanged().catch(error => {
        // A client that never connected, or has gone away, is not fatal.
        console.error('[Resources] Failed to send list_changed:', error);
      });
    }, 0);
  });
}

/**
 * Start the server
 */
async function main() {
  const { positional, toolsSpec } = parseServerArgs(process.argv.slice(2));

  // Get config path from command line args or environment
  const configPath =
    positional[0] || process.env.FIRESTORE_SCHEMA_PATH || './firestore-schemas.json';

  const indexPath =
    positional[1] || process.env.FIRESTORE_INDEX_PATH || './firestore.indexes.json';

  // Narrow the tool surface. The flag wins over the environment variable.
  const selection = parseToolGroups(toolsSpec ?? process.env.FIREBASE_MCP_TOOLS);
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

    // Only start notifying once there is a client to notify.
    watchResourceList();

    console.error('[MCP] Server ready');
  } catch (error) {
    console.error('[MCP] Startup failed:', error);
    process.exit(1);
  }
}

// Run the server
main().catch(console.error);
