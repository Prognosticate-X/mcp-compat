import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateClaudeCodeStrictToolsList } from '../src/reproduction.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const serverPath = path.join(rootDir, 'examples', 'mock-2026-server.js');
const bridgePath = path.join(rootDir, 'bin', 'mcp-compat.js');

/**
 * Helper to run a JSON-RPC session against a spawned process over stdio.
 * Fix O2: receive() now has a configurable timeout to prevent tests from hanging.
 */
function createProcessClient(cmd, args) {
  const proc = spawn(cmd, args, {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const rl = readline.createInterface({
    input: proc.stdout,
    terminal: false
  });

  let messageQueue = [];
  let waitingResolvers = [];

  rl.on('line', (line) => {
    try {
      const data = JSON.parse(line.trim());
      if (waitingResolvers.length > 0) {
        const resolve = waitingResolvers.shift();
        resolve(data);
      } else {
        messageQueue.push(data);
      }
    } catch (e) {
      // ignore non-json lines
    }
  });

  return {
    proc,
    send(req) {
      proc.stdin.write(JSON.stringify(req) + '\n');
    },
    async receive(timeoutMs = 5000) {
      if (messageQueue.length > 0) {
        return messageQueue.shift();
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`receive() timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        waitingResolvers.push((data) => {
          clearTimeout(timer);
          resolve(data);
        });
      });
    },
    close() {
      proc.stdin.end();
      proc.kill();
    }
  };
}

test('End-to-End Real Process IPC Test Suite', async (t) => {

  await t.test('Direct mock server response fails Claude Code strict validator', async () => {
    const client = createProcessClient('node', [serverPath]);

    try {
      // 1. Initialize
      client.send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2026-07-28', capabilities: {} }
      });
      const initResp = await client.receive();
      assert.equal(initResp.result.protocolVersion, '2026-07-28');

      // 2. Fetch Tools directly
      client.send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {}
      });
      const toolsResp = await client.receive();

      // Raw server response lacks optional fields
      const validation = validateClaudeCodeStrictToolsList(toolsResp.result);
      assert.equal(validation.valid, false, 'Direct connection must fail client validation');
      assert.ok(validation.errors.some(e => e.path.includes('ttlMs')));
      assert.ok(validation.errors.some(e => e.path.includes('cacheScope')));
    } finally {
      client.close();
    }
  });

  await t.test('Bridge normalizes tools/list and passes strict validation', async () => {
    const client = createProcessClient('node', [bridgePath, '--stats', '--', 'node', serverPath]);

    try {
      // 1. Initialize
      client.send({
        jsonrpc: '2.0',
        id: 10,
        method: 'initialize',
        params: { protocolVersion: '2026-07-28', capabilities: {} }
      });
      const initResp = await client.receive();
      assert.equal(initResp.result.protocolVersion, '2026-07-28');

      // 2. Fetch Tools through bridge
      client.send({
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/list',
        params: {}
      });
      const toolsResp = await client.receive();

      // Validate using Claude Code's flawed strict validator
      const validation = validateClaudeCodeStrictToolsList(toolsResp.result);
      assert.equal(validation.valid, true, 'Bridge response must pass strict client validation');

      // Assert backfilled fields
      assert.equal(typeof toolsResp.result.ttlMs, 'number');
      assert.equal(toolsResp.result.cacheScope, 'private');

      // Assert deterministic alphabetical tool ordering
      const toolNames = toolsResp.result.tools.map(t => t.name);
      assert.deepEqual(toolNames, [
        'artifact_fetcher',
        'benchmark_runner',
        'system_diagnostic'
      ], 'Tools must be sorted alphabetically to guarantee prompt cache stability');

      // 3. Verify tool execution forwarding through bridge
      client.send({
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/call',
        params: {
          name: 'artifact_fetcher',
          arguments: { uri: 'ipfs://Qm12345' }
        }
      });
      const callResp = await client.receive();
      assert.ok(callResp.result.content[0].text.includes('artifact_fetcher'));
      assert.ok(callResp.result.content[0].text.includes('ipfs://Qm12345'));

    } finally {
      client.close();
    }
  });

  // Fix S1: resources/list E2E coverage
  await t.test('Bridge normalizes resources/list with cache hint backfill', async () => {
    const client = createProcessClient('node', [bridgePath, '--', 'node', serverPath]);

    try {
      client.send({
        jsonrpc: '2.0',
        id: 20,
        method: 'initialize',
        params: { protocolVersion: '2026-07-28', capabilities: {} }
      });
      await client.receive();

      client.send({
        jsonrpc: '2.0',
        id: 21,
        method: 'resources/list',
        params: {}
      });
      const resourcesResp = await client.receive();

      // Assert cache hints were backfilled
      assert.equal(typeof resourcesResp.result.ttlMs, 'number', 'ttlMs must be backfilled');
      assert.equal(resourcesResp.result.cacheScope, 'private', 'cacheScope must be backfilled');

      // Assert resources are present and sorted alphabetically by URI
      assert.ok(Array.isArray(resourcesResp.result.resources));
      assert.equal(resourcesResp.result.resources.length, 2);
      // Sorted by URI: config.json < README.md
      assert.equal(resourcesResp.result.resources[0].uri, 'file:///workspace/config.json');
      assert.equal(resourcesResp.result.resources[1].uri, 'file:///workspace/README.md');
    } finally {
      client.close();
    }
  });

  // Fix S4: prompts/list E2E coverage
  await t.test('Bridge normalizes prompts/list with cache hint backfill', async () => {
    const client = createProcessClient('node', [bridgePath, '--', 'node', serverPath]);

    try {
      client.send({
        jsonrpc: '2.0',
        id: 30,
        method: 'initialize',
        params: { protocolVersion: '2026-07-28', capabilities: {} }
      });
      await client.receive();

      client.send({
        jsonrpc: '2.0',
        id: 31,
        method: 'prompts/list',
        params: {}
      });
      const promptsResp = await client.receive();

      // Assert cache hints were backfilled
      assert.equal(typeof promptsResp.result.ttlMs, 'number', 'ttlMs must be backfilled');
      assert.equal(promptsResp.result.cacheScope, 'private', 'cacheScope must be backfilled');

      // Assert prompts are present and sorted alphabetically
      assert.ok(Array.isArray(promptsResp.result.prompts));
      assert.equal(promptsResp.result.prompts.length, 2);
      assert.equal(promptsResp.result.prompts[0].name, 'analyze');
      assert.equal(promptsResp.result.prompts[1].name, 'summarize');
    } finally {
      client.close();
    }
  });
});
