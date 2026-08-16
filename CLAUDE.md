# CLAUDE.md — working conventions for this repo

## What this is

A general-purpose MCP server for Firebase — Firestore, Storage, Auth, and Cloud Logging —
with schema-driven validation and context-efficient tools. Published as
`@dasasian/firebase-mcp-server` (npm) and `io.github.dasasian/firebase-mcp-server` (the MCP
registry).

## Build / test

`npm run build` (tsc) · `npm run typecheck` (tsc --noEmit) · `npm test` (vitest).

Tests cover the **pure logic** — path matching (`src/shared/path-matcher.ts`) and schema
validation (`src/shared/validation.ts`) — the parts that don't need live Firebase. The
`test-*.ts` scripts at the repo root are manual integration checks that need real
credentials and deliberately do **not** run in CI. Keep the unit suite green, and add to it
when you touch `src/shared/`.

## Releasing

MCP server → npm **and** the MCP registry. Full process + every gotcha: `../PUBLISHING.md`.
The short version:

1. Update `CHANGELOG.md` (`[Unreleased]` → `[X.Y.Z] — <date>`). **No `CHANGELOG.md` yet?**
   Create one ([Keep a Changelog](https://keepachangelog.com) format) and backfill the
   already-published versions from `git log` + the GitHub releases.
2. Bump `version` in **both** `package.json` and `server.json` (including `server.json`'s
   `packages[].version`) — a drift between them fails the registry publish.
3. Commit `chore: release X.Y.Z` and push.
4. `npm publish` — needs your OTP. Traps: a `404 on PUT` = lapsed token (`npm login`);
   `npm view` can 404 for ~2 min after a *successful* publish (confirm with
   `npm access list packages`, don't re-publish).
5. `git tag vX.Y.Z && git push origin vX.Y.Z` — fires `publish-mcp-registry.yml`, which
   publishes `server.json` to the registry via OIDC (npm `X.Y.Z` must already be live).
   **Never run `mcp-publisher` from your laptop** — it 403s on the org namespace.
6. `gh release create vX.Y.Z` with the CHANGELOG notes; verify the registry shows `X.Y.Z`
   as `isLatest` (the search returns all versions — read the `isLatest` one).
7. Update the `dasasian.com/firebase-mcp-server` page in `dasasian-web`. Only `npm publish`
   and the release need your credentials; an agent drives the rest.
