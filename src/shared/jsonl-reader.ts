/**
 * JSONL file reader for local log sources
 * Reads and parses JSONL files line-by-line with error handling
 */

import { createReadStream, readdirSync, existsSync } from 'fs';
import { createInterface } from 'readline';
import { access, constants } from 'fs/promises';
import { join } from 'path';

export interface LogEntry {
  timestamp: string;
  severity: string;
  functionName?: string;
  executionId?: string;
  textPayload?: string;
  /** Log text from whichever of textPayload / jsonPayload.message the entry carries. */
  message?: string;
  jsonPayload?: Record<string, unknown>;
  region?: string;
  labels?: Record<string, string>;
  resource: Record<string, unknown>;
  insertId: string;
}

/**
 * Resolve log files from a directory — current file first, then rotated files newest-to-oldest.
 */
export function resolveLogFiles(logDir: string): string[] {
  const current = join(logDir, 'dev.jsonl');
  const rotated = readdirSync(logDir)
    .filter(f => f.startsWith('dev-') && f.endsWith('.jsonl'))
    .sort()
    .reverse()
    .map(f => join(logDir, f));
  const files: string[] = [];
  try { readdirSync(logDir); } catch { return files; }
  if (existsSync(current)) files.push(current);
  files.push(...rotated);
  return files;
}

/**
 * Read and parse JSONL file with error handling
 * Skips malformed JSON lines and logs errors
 */
export async function readJsonlFile(filePath: string): Promise<LogEntry[]> {
  // Check file exists
  try {
    await access(filePath, constants.R_OK);
  } catch {
    throw new Error(`File not found or not readable: ${filePath}`);
  }

  const entries: LogEntry[] = [];
  let lineNum = 0;

  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath, { encoding: 'utf-8' });
    const rl = createInterface({
      input: stream,
      crlfDelay: Infinity,
    });

    rl.on('line', (line) => {
      lineNum++;

      // Skip empty lines
      if (!line.trim()) {
        return;
      }

      try {
        const raw = JSON.parse(line);
        const normalized = normalizeEntry(raw);
        entries.push(normalized);
      } catch (err) {
        // Log error but continue processing other lines
        console.error(`[JSONL] Parse error at line ${lineNum}: ${err}`);
      }
    });

    rl.on('error', (err) => {
      reject(new Error(`Failed to read file: ${err}`));
    });

    rl.on('close', () => {
      resolve(entries);
    });
  });
}

/**
 * Normalize local log format to Cloud Logging structure
 * Maps local fields to Cloud Logging format
 */
function normalizeEntry(raw: any): LogEntry {
  // Generate insertId if missing
  const insertId = raw.insertId || `local-${Date.now()}-${Math.random().toString(36).substring(7)}`;

  const textPayload = raw.textPayload || raw.message;
  const jsonPayload = raw.jsonPayload || (typeof raw.payload === 'object' ? raw.payload : undefined);

  return {
    timestamp: raw.timestamp || new Date().toISOString(),
    severity: raw.severity || 'DEFAULT',
    functionName: raw.functionName || raw.labels?.functionName || 'unknown',
    executionId: raw.executionId || raw.labels?.executionId,
    textPayload,
    message: textPayload ?? (typeof jsonPayload?.message === 'string' ? jsonPayload.message : undefined),
    jsonPayload,
    region: raw.region || raw.labels?.region,
    labels: raw.labels || {},
    resource: raw.resource || {},
    insertId,
  };
}
