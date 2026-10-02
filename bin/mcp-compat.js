#!/usr/bin/env node

/**
 * bin/mcp-compat.js
 * 
 * Production CLI bridge for running any MCP server under seamless
 * 2026-07-28 protocol compatibility and prompt cache optimization.
 * 
 * Usage:
 *   npx mcp-compat [options] -- <server-command> [args...]
 * 
 * Options:
 *   --ttl <ms>            Default TTL in ms to inject if server omits it (default: 0)
 *   --scope <pub|priv>    Default cacheScope to inject ('private' or 'public', default: 'private')
 *   --no-sort             Disable deterministic tool sorting
 *   --verbose             Log debug information to stderr
 *   --stats               Print telemetry summary on exit
 */

import { spawn } from 'child_process';
import readline from 'readline';
import { McpBridgeEngine } from '../src/engine.js';

// Parse arguments
const args = process.argv.slice(2);
const separatorIndex = args.indexOf('--');

if (separatorIndex === -1 || separatorIndex === args.length - 1) {
  console.error(`
========================================================================
  mcp-compat: MCP 2026 Protocol Compatibility & Cache Normalizer
========================================================================

Usage:
  mcp-compat [options] -- <server-command> [server-arguments...]

Options:
  --ttl <ms>             Default TTL in ms for missing cache hints (default: 0)
  --scope <public|priv>  Default cacheScope for missing hints (default: private)
  --no-sort              Disable deterministic tool & schema ordering
  --verbose              Print debug messages to stderr
  --stats                Print telemetry metrics summary on exit
  --help                 Show this help text

Examples:
  # Wrap a python FastMCP server for Claude Code:
  mcp-compat -- uvx fastmcp run server.py

  # Wrap a Rust rmcp binary with custom TTL:
  mcp-compat --ttl 300000 --scope public -- ./target/release/my-mcp-server
`);
  process.exit(1);
}

const flagArgs = args.slice(0, separatorIndex);
const targetCmd = args[separatorIndex + 1];
const targetArgs = args.slice(separatorIndex + 2);

// Extract options
let defaultTtlMs = 0;
let defaultCacheScope = 'private';
let deterministicOrder = true;
let verbose = false;
let showStats = false;

for (let i = 0; i < flagArgs.length; i++) {
  const arg = flagArgs[i];
  if (arg === '--ttl' && flagArgs[i + 1]) {
    defaultTtlMs = parseInt(flagArgs[++i], 10) || 0;
  } else if (arg === '--scope' && flagArgs[i + 1]) {
    const scope = flagArgs[++i];
    defaultCacheScope = (scope === 'public' || scope === 'private') ? scope : 'private';
  } else if (arg === '--no-sort') {
    deterministicOrder = false;
  } else if (arg === '--verbose') {
    verbose = true;
  } else if (arg === '--stats') {
    showStats = true;
  }
}

const engine = new McpBridgeEngine({
  defaultTtlMs,
  defaultCacheScope,
  deterministicOrder,
  verbose
});

if (verbose) {
  console.error(`[mcp-compat] Starting target command: ${targetCmd} ${targetArgs.join(' ')}`);
}

// Spawn underlying MCP server
const child = spawn(targetCmd, targetArgs, {
  stdio: ['pipe', 'pipe', 'inherit']
});

child.on('error', (err) => {
  console.error(`[mcp-compat] Failed to spawn target server '${targetCmd}': ${err.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (showStats || verbose) {
    const diag = engine.getDiagnostics();
    console.error(`\n[mcp-compat] Session Telemetry Summary:`);
    console.error(`  - Target exited with: code ${code}, signal ${signal}`);
    console.error(`  - Requests intercepted: ${diag.telemetry.requestsProcessed}`);
    console.error(`  - Responses normalized: ${diag.telemetry.responsesProcessed}`);
    console.error(`  - Cache hints backfilled: ${diag.telemetry.cacheHintsInjected}`);
    console.error(`  - Tools ordered: ${diag.telemetry.toolsSorted}`);
  }
  process.exit(code || 0);
});

// Stdin Reader (Client -> Bridge -> Server)
const clientReader = readline.createInterface({
  input: process.stdin,
  terminal: false
});

clientReader.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const msg = JSON.parse(trimmed);
    const processed = engine.processClientMessage(msg);
    child.stdin.write(JSON.stringify(processed) + '\n');
  } catch (err) {
    // If not valid JSON, pass raw line through
    child.stdin.write(line + '\n');
  }
});

// Stdout Reader (Server -> Bridge -> Client)
const serverReader = readline.createInterface({
  input: child.stdout,
  terminal: false
});

serverReader.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const msg = JSON.parse(trimmed);
    const processed = engine.processServerMessage(msg);
    process.stdout.write(JSON.stringify(processed) + '\n');
  } catch (err) {
    process.stdout.write(line + '\n');
  }
});
