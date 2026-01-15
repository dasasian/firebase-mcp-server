/**
 * Test script for Firebase Storage tools
 */

import { firebaseStorageLs } from './src/tools/storage/ls.js';
import { firebaseStorageUpload } from './src/tools/storage/upload.js';
import { firebaseStorageRead } from './src/tools/storage/read.js';
import { firebaseStorageStat } from './src/tools/storage/stat.js';
import { firebaseStorageGetUrl } from './src/tools/storage/get-url.js';
import { firebaseStorageRm } from './src/tools/storage/rm.js';
import { writeFile } from 'fs/promises';
import { join } from 'path';

async function testStorage() {
  console.log('=== Testing Firebase Storage Tools ===\n');

  try {
    // Test 1: List files in root
    console.log('1. Testing firebase_storage_ls (root)...');
    const lsResult = await firebaseStorageLs({ path: '/' });
    console.log(`Found ${lsResult.totalFiles} files`);
    if (lsResult.error) console.error('Error:', lsResult.error);
    console.log();

    // Test 2: Upload a test file
    console.log('2. Testing firebase_storage_upload...');
    const testFilePath = join('/tmp', 'test-upload.txt');
    await writeFile(testFilePath, 'Hello from Firebase MCP test!');

    const uploadResult = await firebaseStorageUpload({
      localPath: testFilePath,
      remotePath: '/test/test-upload.txt',
    });
    console.log(`Uploaded: ${uploadResult.uploaded}`);
    if (uploadResult.url) console.log(`URL: ${uploadResult.url}`);
    if (uploadResult.error) console.error('Error:', uploadResult.error);
    console.log();

    // Test 3: Get file stats
    console.log('3. Testing firebase_storage_stat...');
    const statResult = await firebaseStorageStat({ path: '/test/test-upload.txt' });
    console.log(`Size: ${statResult.metadata?.size} bytes`);
    console.log(`Content-Type: ${statResult.metadata?.contentType}`);
    if (statResult.error) console.error('Error:', statResult.error);
    console.log();

    // Test 4: Get download URL
    console.log('4. Testing firebase_storage_get_url...');
    const urlResult = await firebaseStorageGetUrl({ path: '/test/test-upload.txt' });
    console.log(`URL Type: ${urlResult.urlType}`);
    console.log(`URL: ${urlResult.url.substring(0, 80)}...`);
    if (urlResult.error) console.error('Error:', urlResult.error);
    console.log();

    // Test 5: Read file (download to temp)
    console.log('5. Testing firebase_storage_read...');
    const readResult = await firebaseStorageRead({ path: '/test/test-upload.txt' });
    console.log(`Downloaded: ${readResult.downloaded}`);
    console.log(`Temp path: ${readResult.tempPath}`);
    if (readResult.error) console.error('Error:', readResult.error);
    console.log();

    // Test 6: List files in /test
    console.log('6. Testing firebase_storage_ls (/test)...');
    const lsTestResult = await firebaseStorageLs({ path: '/test' });
    console.log(`Found ${lsTestResult.totalFiles} files in /test`);
    lsTestResult.files.forEach(f => console.log(`  - ${f.name} (${f.size} bytes)`));
    console.log();

    // Test 7: Clean up - delete test file
    console.log('7. Testing firebase_storage_rm...');
    const rmResult = await firebaseStorageRm({ path: '/test/test-upload.txt' });
    console.log(`Deleted: ${rmResult.deleted}`);
    if (rmResult.error) console.error('Error:', rmResult.error);
    console.log();

    console.log('=== All tests completed ===');

  } catch (error) {
    console.error('Test failed:', error);
  }
}

testStorage();
