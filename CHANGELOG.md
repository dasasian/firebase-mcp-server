# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **`firebase_functions_logs` returned nothing for gen2 functions.** The Cloud Run
  service name was derived by kebab-casing the function name (`extractReceipt` →
  `extract-receipt`), but Firebase only lowercases it (`extractreceipt`), so the
  filter matched no entries. `functionName` now also compares case-insensitively
  client-side, so a camelCase name finds its gen2 service either way. A valid
  function name returning zero rows was indistinguishable from a function that had
  never run.
- **Structured logs looked empty.** Firebase's structured logger writes
  `jsonPayload.message` and no `textPayload`, so selecting `textPayload` — which the
  tool description suggested — returned entries with no text. Every entry now carries
  a `message` field holding whichever payload has the text, and `textPayload` falls
  back to it in projections, `LIKE` searches and `GROUP BY`.
- **Audit-log entries blew the token limit.** An unfiltered query could return
  300k+ characters, nearly all of it one protobuf `AuditLog` payload serialised as a
  byte-by-byte integer array. Cloud Audit Logs are now excluded by default (opt back
  in with `includeAuditLogs: true`), and any binary blob in a payload is replaced
  with a `<Buffer N bytes>` placeholder.

### Changed

- **Documented the IAM role the logs tool actually needs.** A Firebase Admin SDK
  service account has no Cloud Logging access at all, so `firebase_functions_logs`
  fails with `PERMISSION_DENIED: Permission denied for all log views` while every
  other tool works. README and the logging guide now call for
  `roles/logging.viewAccessor` and note that `roles/logging.viewer` alone may not be
  enough.

## [1.1.0] - 2026-08-16

### Added

- **Tool groups.** `--tools firestore,auth` or `FIREBASE_MCP_TOOLS=firestore,auth`
  narrows which tool families load. All 33 tool definitions cost roughly 12k tokens
  of context per session; Firestore alone is about 4.3k. Unset means everything, so
  upgrading never hides a tool you were using.
- **Tool annotations on all 33 tools** — `title`, `readOnlyHint`, and, for writes,
  `destructiveHint` and `idempotentHint`. With these omitted the MCP spec assumes the
  worst case for every tool, so read-only tools such as `firestore_count` were
  prompting for confirmation exactly like `firestore_delete`.
- **`outputSchema` on all 33 tools**, and `structuredContent` alongside the existing
  text content, so clients receive typed results rather than JSON inside a string.
- **`resources/templates/list`** — each schema path is published as an RFC 6570
  template, so a client can address any document without the server enumerating them.
- **`resources.listChanged`** — the server now notifies when the resource list really
  changes: a document joining the recently-used list, an eviction, or auto-discovery
  finding a different set of collections.

### Changed

- **MCP SDK 0.5.0 → 1.30.0.** The negotiated protocol moves from 2024-11-05 to
  2025-11-25.
- Tool arguments are validated against each tool's own `inputSchema` before dispatch.
  They were previously cast straight to `any`, so a bad call surfaced as an opaque
  failure inside the Firebase SDK.
- Tools are advertised in a deterministic order, which the spec asks for so clients
  can cache `tools/list`.

### Fixed

- **Schema paths were published as unreadable resources.** A config containing
  `/users/{userId}` advertised `firestore://users/{userId}` in `resources/list`;
  reading it looked up a document whose id was the literal text `{userId}` and always
  threw `Document not found`. Every schema defined produced one dead entry. Schema
  paths are now templates, and `resources/list` carries the browsable collection
  (`firestore://users/*`) instead.
- **The import dry-run preview could hide a change.** `deepEqual` treated an array and
  a plain object as equal, so switching a field from a list to a map showed as "no
  changes".
- **The auto-discovered logging schema forgot label values.** A label stored as an enum
  keeps its values under `values`, but each update merged only from `sampleValues`, so
  previously seen values were dropped instead of accumulating.
- **Hot reload died after one invalid save.** A failed reload threw out of the watch
  loop, leaving hot reload dead until the next restart. The last good config is now
  kept and watching continues.
- **`stopWatching()` could still fire one more reload.** An iteration already inside the
  100 ms debounce ignored the abort. On Linux, where a single save usually produces two
  change events, this was easy to hit.

### Notes

`resources/list` no longer contains the brace-shaped schema URIs. They were never
readable, so nothing that worked has been removed — but a client that hardcoded one
should read `resources/templates/list` instead.

## [1.0.0] - 2026-08-15

Initial public release. MCP server for Firebase — Firestore, Storage, Auth, and
Cloud Logging — with schema-driven validation and context-efficient tools.

[1.1.0]: https://github.com/dasasian/firebase-mcp-server/releases/tag/v1.1.0
[1.0.0]: https://github.com/dasasian/firebase-mcp-server/releases/tag/v1.0.0
