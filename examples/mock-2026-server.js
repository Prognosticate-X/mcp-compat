#!/usr/bin/env node

/**
 * examples/mock-2026-server.js
 * 
 * A realistic standard-compliant MCP server negotiating protocol 2026-07-28.
 * 
 * Simulates real-world servers (like rmcp Rust or FastMCP Python) where:
 * 1. Protocol negotiated is 2026-07-28
 * 2. tools/list does NOT emit optional ttlMs/cacheScope fields
 * 3. Tools are registered dynamically in non-alphabetical order
 * 4. Implements tools/call for verification
 */

import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

const tools = [
  {
    name: 'system_diagnostic',
    description: 'Inspect host system status and performance telemetry',
    inputSchema: {
      type: 'object',
      properties: {
        verbose: { type: 'boolean' },
        subsystems: { type: 'array', items: { type: 'string' } }
      }
    }
  },
  {
    name: 'benchmark_runner',
    description: 'Run automated benchmarking suite against target endpoints',
    inputSchema: {
      type: 'object',
      properties: {
        iterations: { type: 'number' },
        concurrency: { type: 'number' }
      },
      required: ['iterations']
    }
  },
  {
    name: 'artifact_fetcher',
    description: 'Retrieve artifacts from remote decentralized storage',
    inputSchema: {
      type: 'object',
      properties: {
        uri: { type: 'string' }
      },
      required: ['uri']
    }
  }
];

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const req = JSON.parse(trimmed);

    // 1. Initialize
    if (req.method === 'initialize') {
      const resp = {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          protocolVersion: '2026-07-28',
          capabilities: {
            tools: { listChanged: true },
            resources: {}
          },
          serverInfo: {
            name: 'mock-2026-server',
            version: '2.0.0'
          }
        }
      };
      process.stdout.write(JSON.stringify(resp) + '\n');
      return;
    }

    // 2. Initialized Notification
    if (req.method === 'notifications/initialized') {
      // No response needed for notifications
      return;
    }

    // 3. Tools List
    // NOTICE: Omit optional ttlMs and cacheScope as allowed by 2026-07-28 spec
    if (req.method === 'tools/list') {
      const resp = {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          resultType: 'complete',
          tools: tools // Unsorted order
        }
      };
      process.stdout.write(JSON.stringify(resp) + '\n');
      return;
    }

    // 3b. Resources List — also omits optional cache hints
    if (req.method === 'resources/list') {
      const resp = {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          resources: [
            { uri: 'file:///workspace/README.md', name: 'README', mimeType: 'text/markdown' },
            { uri: 'file:///workspace/config.json', name: 'Config', mimeType: 'application/json' }
          ]
        }
      };
      process.stdout.write(JSON.stringify(resp) + '\n');
      return;
    }

    // 3c. Prompts List — also omits optional cache hints
    if (req.method === 'prompts/list') {
      const resp = {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          prompts: [
            { name: 'summarize', description: 'Summarize the given text' },
            { name: 'analyze', description: 'Analyze code for issues' }
          ]
        }
      };
      process.stdout.write(JSON.stringify(resp) + '\n');
      return;
    }

    // 4. Tools Call
    if (req.method === 'tools/call') {
      const { name, arguments: args } = req.params || {};
      const resp = {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          content: [
            {
              type: 'text',
              text: `Tool '${name}' successfully executed with args: ${JSON.stringify(args)}`
            }
          ]
        }
      };
      process.stdout.write(JSON.stringify(resp) + '\n');
      return;
    }

    // 5. Ping
    if (req.method === 'ping') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: {} }) + '\n');
      return;
    }

    // Fallback Method Not Found
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: req.id,
      error: { code: -32601, message: 'Method not found' }
    }) + '\n');

  } catch (err) {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' }
    }) + '\n');
  }
});
