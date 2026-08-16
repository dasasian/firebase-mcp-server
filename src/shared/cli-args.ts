/**
 * Argument parsing for the server entry point.
 *
 * `dist/index.js` is launched two ways: through the `firebase-mcp` CLI, which
 * uses commander and forwards `--tools=<groups>`, and directly by an MCP client
 * config, which typically writes flags the other way round as
 * `"args": ["dist/index.js", "schemas.json", "--tools", "firestore"]`.
 *
 * Both forms have to work. Splitting on "=" alone dropped the value of the
 * space-separated form, and worse, left the value sitting in the positional
 * list where it was read as the schema config path.
 */

export interface ServerArgs {
  /** Positional arguments: [schemaConfigPath, indexConfigPath]. */
  positional: string[];
  /** Raw value of --tools, or undefined when the flag was not given. */
  toolsSpec?: string;
}

/**
 * Parse the server's command line.
 *
 * @param argv - arguments after the node binary and script, i.e.
 *   `process.argv.slice(2)`.
 */
export function parseServerArgs(argv: string[]): ServerArgs {
  const positional: string[] = [];
  let toolsSpec: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--tools') {
      // Space-separated form. Take the next argument as the value, unless it
      // is another flag or the list has run out.
      const next = argv[i + 1];

      if (next !== undefined && !next.startsWith('--')) {
        toolsSpec = next;
        i++;
      } else {
        toolsSpec = '';
      }

      continue;
    }

    if (arg.startsWith('--tools=')) {
      toolsSpec = arg.slice('--tools='.length);
      continue;
    }

    // Unrecognised flags are ignored rather than treated as positionals, so a
    // future flag cannot silently become the schema path.
    if (arg.startsWith('--')) {
      continue;
    }

    positional.push(arg);
  }

  return { positional, toolsSpec };
}
