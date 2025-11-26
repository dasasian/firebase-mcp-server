/**
 * Configuration loader with file watching and hot reload
 * Automatically reloads schemas when the config file changes
 */

import { readFile, watch } from 'fs/promises';
import type { SchemaConfig } from './types.js';

let cachedConfig: SchemaConfig | null = null;
let configPath: string | null = null;
let watchController: AbortController | null = null;

/**
 * Initialize the config loader with file watching
 */
export async function initializeConfigLoader(path: string): Promise<void> {
  configPath = path;

  // Load initial config
  await reloadConfig();

  // Setup file watcher
  if (watchController) {
    watchController.abort();
  }

  watchController = new AbortController();

  // Watch for changes
  (async () => {
    try {
      const watcher = watch(path, { signal: watchController!.signal });

      for await (const event of watcher) {
        if (event.eventType === 'change') {
          // Debounce: wait 100ms before reloading
          await new Promise(resolve => setTimeout(resolve, 100));
          await reloadConfig();
          console.error('[Config] Schema file changed, reloaded');
        }
      }
    } catch (err: unknown) {
      if ((err as { name?: string }).name !== 'AbortError') {
        console.error('[Config] File watch error:', err);
      }
    }
  })();
}

/**
 * Reload configuration from disk
 */
async function reloadConfig(): Promise<void> {
  if (!configPath) {
    throw new Error('Config loader not initialized');
  }

  try {
    const content = await readFile(configPath, 'utf-8');
    cachedConfig = JSON.parse(content) as SchemaConfig;
  } catch (err) {
    console.error('[Config] Failed to load schema file:', err);
    throw new Error(`Failed to load schema config from ${configPath}: ${err}`);
  }
}

/**
 * Get current configuration (cached, automatically reloaded on file changes)
 */
export function getConfig(): SchemaConfig {
  if (!cachedConfig) {
    throw new Error('Config not loaded. Call initializeConfigLoader() first.');
  }
  return cachedConfig;
}

/**
 * Stop file watching (for cleanup)
 */
export function stopWatching(): void {
  if (watchController) {
    watchController.abort();
    watchController = null;
  }
}

/**
 * Check if config loader is initialized
 */
export function isInitialized(): boolean {
  return cachedConfig !== null;
}
