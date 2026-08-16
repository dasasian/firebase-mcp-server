/**
 * Tool registry — the single table mapping every MCP tool to its handler, its
 * safety annotations, and the shape of what it returns.
 *
 * Keeping annotations here rather than in each of the 33 tool files means the
 * whole safety posture of the server can be audited on one screen: which tools
 * are read-only, which are destructive, which can be safely retried.
 */

import Ajv from 'ajv';

// Core Firestore tools
import { firestoreRead, firestoreReadTool } from './read.js';
import { firestoreExport, firestoreExportTool } from './export.js';
import { firestoreValidate, firestoreValidateTool } from './validate.js';
import { firestoreImport, firestoreImportTool } from './import.js';
import { firestoreUpdate, firestoreUpdateTool } from './update.js';
import { firestoreDelete, firestoreDeleteTool } from './delete.js';
import { firestoreQuerySelect, firestoreQuerySelectTool } from './query-select.js';
import { firestoreCount, firestoreCountTool } from './count.js';
import { firestoreSum, firestoreSumTool } from './sum.js';
import { firestoreStats, firestoreStatsTool } from './stats.js';
import {
  firestoreQueryCollectionGroup,
  firestoreQueryCollectionGroupTool,
} from './query-collection-group.js';
import {
  firestoreShowCollections,
  firestoreShowCollectionsTool,
} from './show-collections.js';

// Firebase Auth tools
import { firebaseAuthCreateUser, firebaseAuthCreateUserTool } from './auth/create-user.js';
import { firebaseAuthListUsers, firebaseAuthListUsersTool } from './auth/list-users.js';
import { firebaseAuthGetUser, firebaseAuthGetUserTool } from './auth/get-user.js';
import { firebaseAuthUpdateUser, firebaseAuthUpdateUserTool } from './auth/update-user.js';
import { firebaseAuthDeleteUser, firebaseAuthDeleteUserTool } from './auth/delete-user.js';
import {
  firebaseAuthRevokeSessions,
  firebaseAuthRevokeSessionsTool,
} from './auth/revoke-sessions.js';

// Firebase Storage tools
import {
  firebaseStorageListBuckets,
  firebaseStorageListBucketsTool,
} from './storage/list-buckets.js';
import { firebaseStorageLs, firebaseStorageLsTool } from './storage/ls.js';
import { firebaseStorageRead, firebaseStorageReadTool } from './storage/read.js';
import { firebaseStorageUpload, firebaseStorageUploadTool } from './storage/upload.js';
import { firebaseStorageRm, firebaseStorageRmTool } from './storage/rm.js';
import { firebaseStorageStat, firebaseStorageStatTool } from './storage/stat.js';
import { firebaseStorageGetUrl, firebaseStorageGetUrlTool } from './storage/get-url.js';
import { firebaseStorageCp, firebaseStorageCpTool } from './storage/cp.js';
import { firebaseStorageMv, firebaseStorageMvTool } from './storage/mv.js';
import { firebaseStorageFind, firebaseStorageFindTool } from './storage/find.js';
import { firebaseStorageSync, firebaseStorageSyncTool } from './storage/sync.js';
import { firebaseStoragePush, firebaseStoragePushTool } from './storage/push.js';
import {
  firebaseStorageGetAccess,
  firebaseStorageGetAccessTool,
} from './storage/get-access.js';
import {
  firebaseStorageSetAccess,
  firebaseStorageSetAccessTool,
} from './storage/set-access.js';

// Cloud Logging tools
import { firebaseFunctionsLogs, firebaseFunctionsLogsTool } from './functions/logs.js';

/**
 * Behavioural hints a client uses to decide whether a call needs confirmation.
 * When these are omitted the MCP spec assumes the worst case — destructive,
 * non-idempotent, open-world — so every tool here declares them explicitly.
 */
export interface ToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint: boolean;
}

export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: ToolAnnotations;
}

export interface ToolEntry {
  tool: ToolDescriptor;
  run: (args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * A read-only tool. `destructiveHint` and `idempotentHint` are only meaningful
 * when a tool writes, so they are left off deliberately.
 *
 * Every tool in this server talks to one known Firebase project rather than an
 * open-ended set of external entities, so `openWorldHint` is always false.
 */
const reads = (title: string): ToolAnnotations => ({
  title,
  readOnlyHint: true,
  openWorldHint: false,
});

/**
 * A writing tool.
 *
 * @param destructive - true when the write overwrites or removes existing
 *   state. Not just deletion: overwriting a document, replacing a file, or
 *   revoking a session all count, because none can be trivially undone.
 * @param idempotent - true when repeating the same call leaves the same end
 *   state. "Set this field" is idempotent; "create this user" is not.
 */
const writes = (
  title: string,
  destructive: boolean,
  idempotent: boolean
): ToolAnnotations => ({
  title,
  readOnlyHint: false,
  destructiveHint: destructive,
  idempotentHint: idempotent,
  openWorldHint: false,
});

// --- JSON Schema shorthands -------------------------------------------------
// Output schemas describe the fields a caller can rely on. They stay permissive
// (no `additionalProperties: false`, `required` only where a field is always
// present) so a client that validates them never rejects a legitimate result.

const str = { type: 'string' };
const num = { type: 'number' };
const bool = { type: 'boolean' };
const strMap = { type: 'object', additionalProperties: { type: 'string' } };
const anyMap = { type: 'object', additionalProperties: true };

const obj = (properties: Record<string, unknown>, required?: string[]) => ({
  type: 'object',
  properties,
  ...(required ? { required } : {}),
});

const arr = (items: unknown) => ({ type: 'array', items });

/** Documents come back in the same envelope from every read tool. */
const documentList = arr(obj({ id: str, path: str, data: anyMap }, ['id', 'path', 'data']));

/** Most tools surface a recoverable failure as an `error` string. */
const err = { error: str };

/** Firestore describes matched schemas the same way in several tools. */
const schemaMatch = obj({ matched: bool, schemaPath: str }, ['matched']);

const fileMetadata = obj({
  size: num,
  contentType: str,
  timeCreated: str,
  updated: str,
  bucket: str,
  md5Hash: str,
  cacheControl: str,
  contentEncoding: str,
});

const authUser = obj(
  {
    uid: str,
    email: str,
    displayName: str,
    phoneNumber: str,
    emailVerified: bool,
    disabled: bool,
    customClaims: anyMap,
    metadata: obj({ creationTime: str, lastSignInTime: str, lastRefreshTime: str }),
  },
  ['uid']
);

/**
 * Every tool the server exposes, in the order it is advertised.
 *
 * The spec asks for a deterministic `tools/list` order so clients can cache the
 * list and keep prompt-cache hits — this array is that order.
 */
export const TOOL_ENTRIES: ToolEntry[] = [
  // --- Discovery ------------------------------------------------------------
  {
    tool: {
      ...firestoreShowCollectionsTool,
      annotations: reads('Show collections'),
      outputSchema: obj(
        {
          collections: arr(
            obj({ name: str, path: str, type: str, description: str }, ['name', 'path', 'type'])
          ),
        },
        ['collections']
      ),
    },
    run: () => firestoreShowCollections(),
  },

  // --- Firestore reads ------------------------------------------------------
  {
    tool: {
      ...firestoreReadTool,
      annotations: reads('Read document'),
      outputSchema: obj(
        {
          path: str,
          exists: bool,
          data: anyMap,
          schema: schemaMatch,
          validation: obj({ valid: bool, errors: num, warnings: num, details: str }),
        },
        ['path', 'exists']
      ),
    },
    run: args => firestoreRead(args as never),
  },
  {
    tool: {
      ...firestoreExportTool,
      annotations: reads('Export collection'),
      outputSchema: obj(
        {
          collection: str,
          documentCount: num,
          schema: schemaMatch,
          documents: documentList,
        },
        ['collection', 'documentCount', 'documents']
      ),
    },
    run: args => firestoreExport(args as never),
  },
  {
    tool: {
      ...firestoreValidateTool,
      annotations: reads('Validate against schema'),
      outputSchema: obj(
        { path: str, schemaPath: str, valid: bool, errors: num, warnings: num, details: str },
        ['path', 'valid', 'errors', 'warnings', 'details']
      ),
    },
    run: args => firestoreValidate(args as never),
  },
  {
    tool: {
      ...firestoreQuerySelectTool,
      annotations: reads('Query documents'),
      outputSchema: obj(
        {
          collection: str,
          documentCount: num,
          indexCheck: obj({ valid: bool, requiresIndex: bool, suggestion: str }),
          scanRequired: obj({
            reason: str,
            docsToScan: num,
            scanLimit: num,
            maxLimit: num,
            message: str,
          }),
          documents: documentList,
        },
        ['collection', 'documentCount', 'documents']
      ),
    },
    run: args => firestoreQuerySelect(args as never),
  },
  {
    tool: {
      ...firestoreQueryCollectionGroupTool,
      annotations: reads('Query collection group'),
      outputSchema: obj(
        { collectionId: str, documentCount: num, documents: documentList },
        ['collectionId', 'documentCount', 'documents']
      ),
    },
    run: args => firestoreQueryCollectionGroup(args as never),
  },
  {
    tool: {
      ...firestoreCountTool,
      annotations: reads('Count documents'),
      outputSchema: obj({ collection: str, count: num, filter: str }, ['collection', 'count']),
    },
    run: args => firestoreCount(args as never),
  },
  {
    tool: {
      ...firestoreSumTool,
      annotations: reads('Sum a field'),
      outputSchema: obj(
        { collection: str, field: str, sum: num, count: num, average: num },
        ['collection', 'field', 'sum', 'count', 'average']
      ),
    },
    run: args => firestoreSum(args as never),
  },
  {
    tool: {
      ...firestoreStatsTool,
      annotations: reads('Collection statistics'),
      outputSchema: obj(
        {
          collection: str,
          documentCount: num,
          sampleSize: num,
          fieldCoverage: {
            type: 'object',
            additionalProperties: obj({ count: num, percentage: str }),
          },
          schema: strMap,
          sampleDocuments: arr(anyMap),
        },
        ['collection', 'documentCount', 'sampleSize', 'fieldCoverage', 'schema']
      ),
    },
    run: args => firestoreStats(args as never),
  },

  // --- Firestore writes -----------------------------------------------------
  // `firestore_import` uses set() without merge, so it replaces the whole
  // document rather than adding to it.
  {
    tool: {
      ...firestoreImportTool,
      annotations: writes('Import document', true, true),
      outputSchema: obj(
        {
          path: str,
          dryRun: bool,
          executed: bool,
          changes: obj({ hasChanges: bool, diff: str }, ['hasChanges']),
          validation: obj({ valid: bool, details: str }),
          ...err,
        },
        ['path', 'dryRun', 'executed', 'changes']
      ),
    },
    run: args => firestoreImport(args as never),
  },
  {
    tool: {
      ...firestoreUpdateTool,
      annotations: writes('Update documents', true, true),
      outputSchema: obj(
        {
          path: str,
          collection: str,
          updatedCount: num,
          updatedPaths: arr(str),
          dryRun: bool,
          wouldUpdate: arr(str),
          fieldsUpdated: arr(str),
          ...err,
        },
        ['updatedCount', 'updatedPaths']
      ),
    },
    run: args => firestoreUpdate(args as never),
  },
  {
    tool: {
      ...firestoreDeleteTool,
      annotations: writes('Delete documents', true, true),
      outputSchema: obj(
        {
          collection: str,
          deletedCount: num,
          deletedPaths: arr(str),
          dryRun: bool,
          wouldDelete: arr(str),
          ...err,
        },
        ['collection', 'deletedCount', 'deletedPaths']
      ),
    },
    run: args => firestoreDelete(args as never),
  },

  // --- Firebase Auth --------------------------------------------------------
  {
    tool: {
      ...firebaseAuthListUsersTool,
      annotations: reads('List users'),
      outputSchema: obj({ users: arr(authUser), totalCount: num }, ['users', 'totalCount']),
    },
    run: args => firebaseAuthListUsers(args as never),
  },
  {
    tool: {
      ...firebaseAuthGetUserTool,
      annotations: reads('Get user'),
      outputSchema: obj(
        {
          uid: str,
          email: str,
          displayName: str,
          phoneNumber: str,
          emailVerified: bool,
          disabled: bool,
          customClaims: anyMap,
          metadata: obj({ creationTime: str, lastSignInTime: str, lastRefreshTime: str }),
          exists: bool,
          ...err,
        },
        ['uid', 'exists']
      ),
    },
    run: args => firebaseAuthGetUser(args as never),
  },
  // Creating a user is additive, but running it twice does not leave the same
  // state — the second call collides on the email or mints a second account.
  {
    tool: {
      ...firebaseAuthCreateUserTool,
      annotations: writes('Create user', false, false),
      outputSchema: obj(
        {
          uid: str,
          email: str,
          displayName: str,
          phoneNumber: str,
          emailVerified: bool,
          disabled: bool,
          customClaims: anyMap,
          created: bool,
          ...err,
        },
        ['uid', 'created']
      ),
    },
    run: args => firebaseAuthCreateUser(args as never),
  },
  {
    tool: {
      ...firebaseAuthUpdateUserTool,
      annotations: writes('Update user', true, true),
      outputSchema: obj(
        {
          uid: str,
          email: str,
          updated: bool,
          fieldsUpdated: arr(str),
          previousClaims: anyMap,
          newClaims: anyMap,
          ...err,
        },
        ['uid', 'updated', 'fieldsUpdated']
      ),
    },
    run: args => firebaseAuthUpdateUser(args as never),
  },
  {
    tool: {
      ...firebaseAuthDeleteUserTool,
      annotations: writes('Delete user', true, true),
      outputSchema: obj(
        {
          uid: str,
          email: str,
          deleted: bool,
          deletedUser: obj({ displayName: str, customClaims: anyMap, creationTime: str }),
          ...err,
        },
        ['uid', 'deleted']
      ),
    },
    run: args => firebaseAuthDeleteUser(args as never),
  },
  // Revoking cannot be undone — every existing session is signed out.
  {
    tool: {
      ...firebaseAuthRevokeSessionsTool,
      annotations: writes('Revoke sessions', true, true),
      outputSchema: obj(
        { uid: str, email: str, revoked: bool, tokensValidAfterTime: str, message: str, ...err },
        ['uid', 'revoked']
      ),
    },
    run: args => firebaseAuthRevokeSessions(args as never),
  },

  // --- Firebase Storage reads ----------------------------------------------
  {
    tool: {
      ...firebaseStorageListBucketsTool,
      annotations: reads('List buckets'),
      outputSchema: obj(
        {
          buckets: arr(obj({ name: str, location: str, storageClass: str, timeCreated: str }, ['name'])),
          totalBuckets: num,
          defaultBucket: str,
          ...err,
        },
        ['buckets', 'totalBuckets']
      ),
    },
    run: () => firebaseStorageListBuckets(),
  },
  {
    tool: {
      ...firebaseStorageLsTool,
      annotations: reads('List files'),
      outputSchema: obj(
        {
          path: str,
          files: arr(
            obj({
              name: str,
              fullPath: str,
              size: num,
              contentType: str,
              timeCreated: str,
              updated: str,
              bucket: str,
              isPublic: bool,
              publicUrl: str,
            })
          ),
          totalFiles: num,
          ...err,
        },
        ['path', 'files', 'totalFiles']
      ),
    },
    run: args => firebaseStorageLs(args as never),
  },
  {
    tool: {
      ...firebaseStorageStatTool,
      annotations: reads('File metadata'),
      outputSchema: obj({ path: str, exists: bool, metadata: fileMetadata, ...err }, ['path', 'exists']),
    },
    run: args => firebaseStorageStat(args as never),
  },
  {
    tool: {
      ...firebaseStorageFindTool,
      annotations: reads('Find files'),
      outputSchema: obj(
        {
          query: str,
          matches: arr(
            obj({ name: str, fullPath: str, size: num, contentType: str, timeCreated: str })
          ),
          totalMatches: num,
          ...err,
        },
        ['query', 'matches', 'totalMatches']
      ),
    },
    run: args => firebaseStorageFind(args as never),
  },
  {
    tool: {
      ...firebaseStorageGetUrlTool,
      annotations: reads('Get file URL'),
      outputSchema: obj({ path: str, url: str, urlType: str, expiresAt: str, ...err }, ['path', 'url']),
    },
    run: args => firebaseStorageGetUrl(args as never),
  },
  {
    tool: {
      ...firebaseStorageGetAccessTool,
      annotations: reads('Get file access'),
      outputSchema: obj(
        { path: str, isPublic: bool, publicUrl: str, metadata: obj({ size: num, contentType: str }), ...err },
        ['path', 'isPublic']
      ),
    },
    run: args => firebaseStorageGetAccess(args as never),
  },

  // --- Firebase Storage writes ---------------------------------------------
  // Reading a remote file writes it to a local temp path, so it cannot claim
  // to be read-only — but it only creates a new file, so it is not destructive.
  {
    tool: {
      ...firebaseStorageReadTool,
      annotations: writes('Download file to temp', false, true),
      outputSchema: obj(
        {
          path: str,
          tempPath: str,
          url: str,
          metadata: obj({ size: num, contentType: str, timeCreated: str, updated: str }),
          downloaded: bool,
          ...err,
        },
        ['path', 'tempPath', 'downloaded']
      ),
    },
    run: args => firebaseStorageRead(args as never),
  },
  {
    tool: {
      ...firebaseStorageUploadTool,
      annotations: writes('Upload file', true, true),
      outputSchema: obj(
        {
          localPath: str,
          remotePath: str,
          uploaded: bool,
          url: str,
          metadata: obj({ size: num, contentType: str, timeCreated: str }),
          ...err,
        },
        ['localPath', 'remotePath', 'uploaded']
      ),
    },
    run: args => firebaseStorageUpload(args as never),
  },
  {
    tool: {
      ...firebaseStorageRmTool,
      annotations: writes('Delete file', true, true),
      outputSchema: obj(
        {
          path: str,
          deleted: bool,
          deletedFile: obj({ name: str, size: num, contentType: str }),
          ...err,
        },
        ['path', 'deleted']
      ),
    },
    run: args => firebaseStorageRm(args as never),
  },
  {
    tool: {
      ...firebaseStorageCpTool,
      annotations: writes('Copy file', true, true),
      outputSchema: obj(
        {
          source: str,
          destination: str,
          copied: bool,
          metadata: obj({ size: num, contentType: str }),
          ...err,
        },
        ['source', 'destination', 'copied']
      ),
    },
    run: args => firebaseStorageCp(args as never),
  },
  // Moving is not idempotent: after the first call the source is gone, so a
  // repeat fails rather than reaching the same state.
  {
    tool: {
      ...firebaseStorageMvTool,
      annotations: writes('Move file', true, false),
      outputSchema: obj(
        {
          source: str,
          destination: str,
          moved: bool,
          metadata: obj({ size: num, contentType: str }),
          ...err,
        },
        ['source', 'destination', 'moved']
      ),
    },
    run: args => firebaseStorageMv(args as never),
  },
  // sync pulls remote files down onto the local disk, overwriting what is there.
  {
    tool: {
      ...firebaseStorageSyncTool,
      annotations: writes('Sync bucket to local', true, true),
      outputSchema: obj(
        {
          remotePath: str,
          localPath: str,
          filesDownloaded: num,
          files: arr(obj({ remotePath: str, localPath: str, size: num })),
          ...err,
        },
        ['remotePath', 'localPath', 'filesDownloaded', 'files']
      ),
    },
    run: args => firebaseStorageSync(args as never),
  },
  {
    tool: {
      ...firebaseStoragePushTool,
      annotations: writes('Push local to bucket', true, true),
      outputSchema: obj(
        {
          localPath: str,
          remotePath: str,
          filesUploaded: num,
          files: arr(obj({ localPath: str, remotePath: str, size: num })),
          ...err,
        },
        ['localPath', 'remotePath', 'filesUploaded', 'files']
      ),
    },
    run: args => firebaseStoragePush(args as never),
  },
  // Changing who can reach a file is a security-relevant write.
  {
    tool: {
      ...firebaseStorageSetAccessTool,
      annotations: writes('Set file access', true, true),
      outputSchema: obj(
        { path: str, isPublic: bool, publicUrl: str, message: str, ...err },
        ['path', 'isPublic', 'message']
      ),
    },
    run: args => firebaseStorageSetAccess(args as never),
  },

  // --- Cloud Logging --------------------------------------------------------
  // Reading logs also updates the auto-discovered logging schema on disk and
  // bumps its query counter, so this is neither read-only nor idempotent.
  {
    tool: {
      ...firebaseFunctionsLogsTool,
      annotations: writes('Query function logs', false, false),
      outputSchema: obj(
        {
          entries: arr(
            obj(
              {
                timestamp: str,
                severity: str,
                functionName: str,
                executionId: str,
                textPayload: str,
                jsonPayload: anyMap,
                region: str,
                labels: strMap,
                resource: anyMap,
                insertId: str,
              },
              ['timestamp', 'severity', 'functionName', 'insertId']
            )
          ),
          aggregatedResults: arr(anyMap),
          totalEntries: num,
          cloudLoggingFilter: str,
          isAggregated: bool,
          ...err,
        },
        ['totalEntries', 'cloudLoggingFilter', 'isAggregated']
      ),
    },
    run: args => firebaseFunctionsLogs(args as never),
  },
];

/** Tool descriptors in advertised order, for `tools/list`. */
export const TOOL_DEFINITIONS: ToolDescriptor[] = TOOL_ENTRIES.map(entry => entry.tool);

const entriesByName = new Map(TOOL_ENTRIES.map(entry => [entry.tool.name, entry]));

/** Look up a tool by the name a client called. */
export function getToolEntry(name: string): ToolEntry | undefined {
  return entriesByName.get(name);
}

// Ajv is lenient about unknown keywords so an imperfect hand-written schema
// never blocks a legitimate call; it only reports genuine shape errors.
const ajv = new Ajv({ strict: false, allErrors: true });
const validators = new Map<string, ReturnType<typeof ajv.compile>>();

/**
 * Check tool arguments against the tool's own inputSchema.
 *
 * @returns null when the arguments are acceptable, otherwise a message naming
 *   what is wrong. Previously arguments were cast straight to `any` and a bad
 *   call surfaced as an opaque failure deep inside the Firebase SDK.
 */
export function validateToolArgs(
  entry: ToolEntry,
  args: Record<string, unknown>
): string | null {
  let validate = validators.get(entry.tool.name);

  if (!validate) {
    try {
      validate = ajv.compile(entry.tool.inputSchema);
    } catch {
      // An uncompilable schema must not take the tool offline.
      return null;
    }
    validators.set(entry.tool.name, validate);
  }

  if (validate(args)) {
    return null;
  }

  const problems = (validate.errors || [])
    .map(e => `${e.instancePath || '(root)'} ${e.message}`)
    .join('; ');

  return `Invalid arguments for ${entry.tool.name}: ${problems}`;
}
