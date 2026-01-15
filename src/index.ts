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

// Import core tools
import { firestoreRead, firestoreReadTool } from './tools/read.js';
import { firestoreExport, firestoreExportTool } from './tools/export.js';
import { firestoreValidate, firestoreValidateTool } from './tools/validate.js';
import { firestoreImport, firestoreImportTool } from './tools/import.js';
import { firestoreUpdate, firestoreUpdateTool } from './tools/update.js';
import { firestoreDelete, firestoreDeleteTool } from './tools/delete.js';
import { firestoreQuerySelect, firestoreQuerySelectTool } from './tools/query-select.js';

// Import context-efficient tools
import { firestoreCount, firestoreCountTool } from './tools/count.js';
import { firestoreSum, firestoreSumTool } from './tools/sum.js';
import { firestoreStats, firestoreStatsTool } from './tools/stats.js';
import { firestoreQueryCollectionGroup, firestoreQueryCollectionGroupTool } from './tools/query-collection-group.js';
import { firestoreShowCollections, firestoreShowCollectionsTool } from './tools/show-collections.js';

// Import Firebase Auth tools
import { firebaseAuthCreateUser, firebaseAuthCreateUserTool } from './tools/auth/create-user.js';
import { firebaseAuthListUsers, firebaseAuthListUsersTool } from './tools/auth/list-users.js';
import { firebaseAuthGetUser, firebaseAuthGetUserTool } from './tools/auth/get-user.js';
import { firebaseAuthUpdateUser, firebaseAuthUpdateUserTool } from './tools/auth/update-user.js';
import { firebaseAuthDeleteUser, firebaseAuthDeleteUserTool } from './tools/auth/delete-user.js';
import { firebaseAuthRevokeSessions, firebaseAuthRevokeSessionsTool } from './tools/auth/revoke-sessions.js';

// Import Firebase Storage tools
import { firebaseStorageListBuckets, firebaseStorageListBucketsTool } from './tools/storage/list-buckets.js';
import { firebaseStorageLs, firebaseStorageLsTool } from './tools/storage/ls.js';
import { firebaseStorageRead, firebaseStorageReadTool } from './tools/storage/read.js';
import { firebaseStorageUpload, firebaseStorageUploadTool } from './tools/storage/upload.js';
import { firebaseStorageRm, firebaseStorageRmTool } from './tools/storage/rm.js';
import { firebaseStorageStat, firebaseStorageStatTool } from './tools/storage/stat.js';
import { firebaseStorageGetUrl, firebaseStorageGetUrlTool } from './tools/storage/get-url.js';
import { firebaseStorageCp, firebaseStorageCpTool } from './tools/storage/cp.js';
import { firebaseStorageMv, firebaseStorageMvTool } from './tools/storage/mv.js';
import { firebaseStorageFind, firebaseStorageFindTool } from './tools/storage/find.js';
import { firebaseStorageSync, firebaseStorageSyncTool } from './tools/storage/sync.js';
import { firebaseStoragePush, firebaseStoragePushTool } from './tools/storage/push.js';
import { firebaseStorageGetAccess, firebaseStorageGetAccessTool } from './tools/storage/get-access.js';
import { firebaseStorageSetAccess, firebaseStorageSetAccessTool } from './tools/storage/set-access.js';

// Import Firebase Functions Logging tools
import { firebaseFunctionsLogs, firebaseFunctionsLogsTool } from './tools/functions/logs.js';

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
 * List available tools
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      // Discovery
      firestoreShowCollectionsTool,
      // Core tools
      firestoreReadTool,
      firestoreExportTool,
      firestoreValidateTool,
      firestoreImportTool,
      firestoreUpdateTool,
      firestoreDeleteTool,
      firestoreQuerySelectTool,
      firestoreQueryCollectionGroupTool,
      // Context-efficient tools
      firestoreCountTool,
      firestoreSumTool,
      firestoreStatsTool,
      // Firebase Auth tools
      firebaseAuthCreateUserTool,
      firebaseAuthListUsersTool,
      firebaseAuthGetUserTool,
      firebaseAuthUpdateUserTool,
      firebaseAuthDeleteUserTool,
      firebaseAuthRevokeSessionsTool,
      // Firebase Storage tools
      firebaseStorageListBucketsTool,
      firebaseStorageLsTool,
      firebaseStorageReadTool,
      firebaseStorageUploadTool,
      firebaseStorageRmTool,
      firebaseStorageStatTool,
      firebaseStorageGetUrlTool,
      firebaseStorageCpTool,
      firebaseStorageMvTool,
      firebaseStorageFindTool,
      firebaseStorageSyncTool,
      firebaseStoragePushTool,
      firebaseStorageGetAccessTool,
      firebaseStorageSetAccessTool,
      // Firebase Functions Logging tools
      firebaseFunctionsLogsTool,
    ],
  };
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

  try {
    switch (name) {
      case 'firestore_show_collections':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await firestoreShowCollections(), null, 2),
            },
          ],
        };

      case 'firestore_read':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await firestoreRead(args as any), null, 2),
            },
          ],
        };

      case 'firestore_export':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await firestoreExport(args as any), null, 2),
            },
          ],
        };

      case 'firestore_validate':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await firestoreValidate(args as any), null, 2),
            },
          ],
        };

      case 'firestore_import':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await firestoreImport(args as any), null, 2),
            },
          ],
        };

      case 'firestore_update':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await firestoreUpdate(args as any), null, 2),
            },
          ],
        };

      case 'firestore_delete':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await firestoreDelete(args as any), null, 2),
            },
          ],
        };

      case 'firestore_query_select':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await firestoreQuerySelect(args as any), null, 2),
            },
          ],
        };

      case 'firestore_query_collection_group':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await firestoreQueryCollectionGroup(args as any), null, 2),
            },
          ],
        };

      case 'firestore_count':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await firestoreCount(args as any), null, 2),
            },
          ],
        };

      case 'firestore_sum':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await firestoreSum(args as any), null, 2),
            },
          ],
        };

      case 'firestore_stats':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await firestoreStats(args as any), null, 2),
            },
          ],
        };

      case 'firebase_auth_create_user':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await firebaseAuthCreateUser(args as any), null, 2),
            },
          ],
        };

      case 'firebase_auth_list_users':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await firebaseAuthListUsers(args as any), null, 2),
            },
          ],
        };

      case 'firebase_auth_get_user':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await firebaseAuthGetUser(args as any), null, 2),
            },
          ],
        };

      case 'firebase_auth_update_user':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await firebaseAuthUpdateUser(args as any), null, 2),
            },
          ],
        };

      case 'firebase_auth_delete_user':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await firebaseAuthDeleteUser(args as any), null, 2),
            },
          ],
        };

      case 'firebase_auth_revoke_sessions':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await firebaseAuthRevokeSessions(args as any), null, 2),
            },
          ],
        };

      case 'firebase_storage_list_buckets':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await firebaseStorageListBuckets(), null, 2),
            },
          ],
        };

      case 'firebase_storage_ls':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await firebaseStorageLs(args as any), null, 2),
            },
          ],
        };

      case 'firebase_storage_read':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await firebaseStorageRead(args as any), null, 2),
            },
          ],
        };

      case 'firebase_storage_upload':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await firebaseStorageUpload(args as any), null, 2),
            },
          ],
        };

      case 'firebase_storage_rm':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await firebaseStorageRm(args as any), null, 2),
            },
          ],
        };

      case 'firebase_storage_stat':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await firebaseStorageStat(args as any), null, 2),
            },
          ],
        };

      case 'firebase_storage_get_url':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await firebaseStorageGetUrl(args as any), null, 2),
            },
          ],
        };

      case 'firebase_storage_cp':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await firebaseStorageCp(args as any), null, 2),
            },
          ],
        };

      case 'firebase_storage_mv':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await firebaseStorageMv(args as any), null, 2),
            },
          ],
        };

      case 'firebase_storage_find':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await firebaseStorageFind(args as any), null, 2),
            },
          ],
        };

      case 'firebase_storage_sync':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await firebaseStorageSync(args as any), null, 2),
            },
          ],
        };

      case 'firebase_storage_push':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await firebaseStoragePush(args as any), null, 2),
            },
          ],
        };

      case 'firebase_storage_get_access':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await firebaseStorageGetAccess(args as any), null, 2),
            },
          ],
        };

      case 'firebase_storage_set_access':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await firebaseStorageSetAccess(args as any), null, 2),
            },
          ],
        };

      case 'firebase_functions_logs':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await firebaseFunctionsLogs(args as any), null, 2),
            },
          ],
        };

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

/**
 * Start the server
 */
async function main() {
  // Get config path from command line args or environment
  const configPath =
    process.argv[2] || process.env.FIRESTORE_SCHEMA_PATH || './firestore-schemas.json';

  const indexPath =
    process.argv[3] || process.env.FIRESTORE_INDEX_PATH || './firestore.indexes.json';

  console.error('[MCP] Firestore MCP Server starting...');
  console.error(`[MCP] Schema config: ${configPath}`);
  console.error(`[MCP] Index config: ${indexPath}`);

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
