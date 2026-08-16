/**
 * Test harness for firebase_functions_logs tool
 * Run: npx tsx test-logs.ts [test-name]
 *
 * Tests: executionId | timestamp | labels | raw | recent | default
 */

process.env.FIREBASE_PROJECT_ID = 'acme-app-12345';
process.env.FIREBASE_SERVICE_ACCOUNT_PATH = './service-account.json';

import { firebaseFunctionsLogs } from './src/tools/functions/logs.js';
import { getLogging } from './src/shared/firebase.js';

const EXECUTION_ID = '3m0mq35kfrk9';
const TIME_START = '2026-02-26T15:19:50Z';
const TIME_END = '2026-02-26T15:20:10Z';

// --- Test definitions ---

async function testExecutionId() {
  console.log('\n=== TEST: executionId filter ===');
  const result = await firebaseFunctionsLogs({
    where: [{ field: 'executionId', operator: '==', value: EXECUTION_ID }],
    fields: ['timestamp', 'severity', 'jsonPayload', 'labels', 'textPayload'],
    orderBy: [{ field: 'timestamp', direction: 'asc' }],
  });
  console.log(JSON.stringify(result, null, 2));
}

async function testTimestamp() {
  console.log('\n=== TEST: timestamp range filter ===');
  const result = await firebaseFunctionsLogs({
    where: [
      { field: 'timestamp', operator: '>=', value: TIME_START },
      { field: 'timestamp', operator: '<=', value: TIME_END },
    ],
    fields: ['timestamp', 'severity', 'jsonPayload', 'labels', 'textPayload'],
    orderBy: [{ field: 'timestamp', direction: 'asc' }],
    limit: 20,
  });
  console.log(JSON.stringify(result, null, 2));
}

async function testLabels() {
  console.log('\n=== TEST: labels.appId filter ===');
  const result = await firebaseFunctionsLogs({
    where: [{ field: 'labels.appId', operator: '==', value: 'acme' }],
    fields: ['timestamp', 'severity', 'jsonPayload', 'labels', 'textPayload'],
    orderBy: [{ field: 'timestamp', direction: 'desc' }],
    limit: 10,
    scanLimit: 10000,
  });
  console.log(JSON.stringify(result, null, 2));
}

async function testRecent() {
  console.log('\n=== TEST: recent logs (no filters) ===');
  const result = await firebaseFunctionsLogs({ limit: 5 });
  console.log(JSON.stringify(result, null, 2));
}

async function testRaw() {
  console.log('\n=== TEST: raw SDK entry structure ===');
  const logging = await getLogging();

  const filter = `(resource.type="cloud_function" OR resource.type="cloud_run_revision") AND labels.execution_id="${EXECUTION_ID}"`;
  console.log('Filter:', filter);

  const [entries] = await logging.getEntries({
    filter,
    pageSize: 10,
    orderBy: 'timestamp desc',
  });

  console.log(`\nRaw entry count: ${entries.length}`);
  for (const entry of entries) {
    console.log('\n--- Raw Entry ---');
    console.log('entry.data type:', typeof entry.data);
    console.log('entry.data:', JSON.stringify(entry.data, null, 2));
    console.log('entry.metadata keys:', Object.keys(entry.metadata || {}));
    console.log('entry.metadata.severity:', (entry.metadata as any)?.severity);
    console.log('entry.metadata.timestamp:', (entry.metadata as any)?.timestamp);
    console.log('entry.metadata.labels:', JSON.stringify((entry.metadata as any)?.labels, null, 2));
    console.log('entry.metadata.resource:', JSON.stringify((entry.metadata as any)?.resource, null, 2));
  }
}

async function testRawTimestamp() {
  console.log('\n=== TEST: raw SDK timestamp range ===');
  const logging = await getLogging();

  const filter = `(resource.type="cloud_function" OR resource.type="cloud_run_revision") AND timestamp>="${TIME_START}" AND timestamp<="${TIME_END}"`;
  console.log('Filter:', filter);

  const [entries] = await logging.getEntries({
    filter,
    pageSize: 50,
    orderBy: 'timestamp desc',
  });

  console.log(`Raw entry count: ${entries.length}`);
  if (entries.length > 0) {
    console.log('First entry timestamp:', (entries[0].metadata as any)?.timestamp);
  }
}

// --- Assertions ---

let passed = 0;
let failed = 0;

function assert(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.error(`  ✗ ${name}${detail ? `: ${detail}` : ''}`);
    failed++;
  }
}

async function testVerify() {
  console.log('\n=== VERIFY: bug fixes working as designed ===\n');

  // 1. jsonPayload is populated for structured logs
  console.log('Bug 1: jsonPayload populated');
  const r1 = await firebaseFunctionsLogs({
    where: [{ field: 'executionId', operator: '==', value: EXECUTION_ID }],
    orderBy: [{ field: 'timestamp', direction: 'asc' }],
  });
  const errorEntry = r1.entries?.find(e => e.severity === 'ERROR');
  assert('ERROR entry exists', !!errorEntry);
  assert('jsonPayload is populated', !!errorEntry?.jsonPayload, 'got: ' + JSON.stringify(errorEntry?.jsonPayload));
  assert('jsonPayload.error exists', !!(errorEntry?.jsonPayload as any)?.error);
  assert('jsonPayload.labels exists', !!(errorEntry?.jsonPayload as any)?.labels);
  assert('textPayload is not set for jsonPayload log', errorEntry?.textPayload === undefined);

  // 2. Timestamp range returns entries
  console.log('\nBug 2: timestamp range filter');
  const r2 = await firebaseFunctionsLogs({
    where: [
      { field: 'timestamp', operator: '>=', value: TIME_START },
      { field: 'timestamp', operator: '<=', value: TIME_END },
    ],
  });
  assert('timestamp range returns entries', (r2.entries?.length ?? 0) > 0, `got ${r2.totalEntries}`);
  assert('all entries within range', r2.entries?.every(e => e.timestamp >= TIME_START && e.timestamp <= TIME_END) ?? false);

  // 3. labels.appId filter returns entries
  console.log('\nBug 3: labels.appId (jsonPayload.labels) filter');
  const r3 = await firebaseFunctionsLogs({
    where: [{ field: 'labels.appId', operator: '==', value: 'acme' }],
    orderBy: [{ field: 'timestamp', direction: 'desc' }],
    limit: 5,
    scanLimit: 10000,
  });
  assert('labels.appId filter returns entries', (r3.entries?.length ?? 0) > 0, `got ${r3.totalEntries}`);
  assert('all entries have appId=acme', r3.entries?.every(e =>
    (e.jsonPayload as any)?.labels?.appId === 'acme'
  ) ?? false);

  // 4. no duplicate: context.error should not exist when error is top-level
  console.log('\nFSL fix: no duplicate error in context');
  const r4 = await firebaseFunctionsLogs({
    where: [{ field: 'executionId', operator: '==', value: EXECUTION_ID }],
  });
  const errEntry = r4.entries?.find(e => e.severity === 'ERROR');
  const ctx = (errEntry?.jsonPayload as any)?.context;
  // Note: existing logs (pre-fix) will still have context.error — this
  // verifies the structure of new logs once FSL client is deployed.
  // For now we just report what we see.
  if (ctx?.error !== undefined) {
    console.log('  ~ context.error present (pre-fix log — expected for existing entries)');
  } else {
    console.log('  ✓ context.error absent (post-fix log)');
  }

  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

// --- Runner ---

const testMap: Record<string, () => Promise<void>> = {
  executionId: testExecutionId,
  timestamp: testTimestamp,
  labels: testLabels,
  recent: testRecent,
  raw: testRaw,
  rawTimestamp: testRawTimestamp,
  verify: testVerify,
};

const arg = process.argv[2] || 'default';

async function run() {
  if (arg === 'default') {
    await testRaw();
    await testExecutionId();
    await testTimestamp();
    await testLabels();
  } else if (testMap[arg]) {
    await testMap[arg]();
  } else {
    console.log(`Unknown test: ${arg}`);
    console.log('Available:', Object.keys(testMap).join(', '), 'default');
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
