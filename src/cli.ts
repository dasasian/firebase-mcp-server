#!/usr/bin/env node

/**
 * CLI entry point for Firebase MCP server
 */

import { Command } from 'commander';

const program = new Command();

program
  .name('firebase-mcp')
  .description('Firebase MCP Server - Model Context Protocol for Firebase (Firestore, Storage, Auth)')
  .version('1.1.0');

program
  .command('start')
  .description('Start the MCP server')
  .argument('[config]', 'Path to schema configuration file', './firestore-schemas.json')
  .argument('[indexes]', 'Path to Firestore indexes file', './firestore.indexes.json')
  .option(
    '--tools <groups>',
    'Comma-separated tool groups to expose: firestore, auth, storage, logs (default: all)'
  )
  .action(async (config, indexes, options) => {
    // Forward to main server
    process.argv = ['node', 'index.js', config, indexes];

    if (options.tools) {
      process.argv.push(`--tools=${options.tools}`);
    }

    await import('./index.js');
  });

program.parse();
