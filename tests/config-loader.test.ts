import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  initializeConfigLoader,
  getConfig,
  stopWatching,
  isInitialized,
} from '../src/shared/config-loader.js';

// The loader keeps module-level state with no reset hook, so these tests run in
// order: the "before init" checks come first, then the file-backed ones.

let dir: string;
let configPath: string;

const config = (extra: Record<string, unknown> = {}) => ({
  schemas: {
    '/users/{userId}': { schema: { type: 'object' } },
    ...extra,
  },
});

/** Poll until `check` passes or the deadline runs out. */
async function waitFor(check: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise(r => setTimeout(r, 50));
  }
  return check();
}

beforeAll(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  dir = await mkdtemp(join(tmpdir(), 'fb-mcp-cfg-'));
  configPath = join(dir, 'firestore-schemas.json');
  await writeFile(configPath, JSON.stringify(config()), 'utf-8');
});

afterAll(async () => {
  stopWatching();
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe('before initialization', () => {
  it('reports itself as not initialized', () => {
    expect(isInitialized()).toBe(false);
  });

  it('throws a helpful error from getConfig', () => {
    expect(() => getConfig()).toThrow(/Call initializeConfigLoader/);
  });

  it('stopWatching is safe to call with no watcher running', () => {
    expect(() => stopWatching()).not.toThrow();
  });
});

describe('initializeConfigLoader — failure paths', () => {
  it('rejects when the file does not exist', async () => {
    await expect(initializeConfigLoader(join(dir, 'missing.json')))
      .rejects.toThrow(/Failed to load schema config/);
  });

  it('rejects when the file is not valid JSON', async () => {
    const bad = join(dir, 'bad.json');
    await writeFile(bad, '{ not json', 'utf-8');
    await expect(initializeConfigLoader(bad))
      .rejects.toThrow(/Failed to load schema config/);
  });

  it('leaves the loader uninitialized after a failed load', () => {
    expect(isInitialized()).toBe(false);
  });
});

describe('initializeConfigLoader — success', () => {
  it('loads the config from disk', async () => {
    await initializeConfigLoader(configPath);
    expect(isInitialized()).toBe(true);
    expect(Object.keys(getConfig().schemas)).toEqual(['/users/{userId}']);
  });

  it('returns the same cached object on repeated reads', () => {
    expect(getConfig()).toBe(getConfig());
  });

  it('hot reloads when the file changes on disk', async () => {
    await writeFile(configPath, JSON.stringify(config({ '/orders/{orderId}': { schema: {} } })), 'utf-8');

    const reloaded = await waitFor(() => '/orders/{orderId}' in getConfig().schemas);
    expect(reloaded).toBe(true);
    expect(Object.keys(getConfig().schemas).sort()).toEqual([
      '/orders/{orderId}',
      '/users/{userId}',
    ]);
  });

  it('keeps the last good config when the file becomes invalid', async () => {
    const before = getConfig();
    await writeFile(configPath, '{ broken', 'utf-8');

    // Give the watcher time to fire and fail its reload.
    await new Promise(r => setTimeout(r, 600));
    expect(getConfig()).toBe(before);
    expect(isInitialized()).toBe(true);
  });

  it('keeps watching after a failed reload and recovers on the next good save', async () => {
    await writeFile(configPath, JSON.stringify(config({ '/recovered/{id}': { schema: {} } })), 'utf-8');

    const recovered = await waitFor(() => '/recovered/{id}' in getConfig().schemas);
    expect(recovered).toBe(true);
  });

  it('stops reloading after stopWatching', async () => {
    stopWatching();
    const before = getConfig();

    await writeFile(configPath, JSON.stringify(config({ '/ignored/{id}': { schema: {} } })), 'utf-8');
    await new Promise(r => setTimeout(r, 600));

    expect(getConfig()).toBe(before);
    expect('/ignored/{id}' in getConfig().schemas).toBe(false);
  });
});
