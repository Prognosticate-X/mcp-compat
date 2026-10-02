import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeToolsListResult,
  normalizeResourcesListResult,
  normalizePromptsListResult,
  normalizeJsonRpcResponse,
  deepSortKeys
} from '../src/normalizer.js';
import {
  validateClaudeCodeStrictToolsList,
  simulateClaudeCodeFetchTools
} from '../src/reproduction.js';

test('MCP Normalizer & Compatibility Layer Suite', async (t) => {
  const rawResponse = {
    resultType: 'complete',
    tools: [
      {
        name: 'zeta_tool',
        description: 'Last in alphabet',
        inputSchema: {
          type: 'object',
          properties: { z: { type: 'string' }, a: { type: 'number' } }
        }
      },
      {
        name: 'alpha_tool',
        description: 'First in alphabet',
        inputSchema: { type: 'object' }
      }
    ]
  };

  await t.test('Normalizer fixes Claude Code validation rejection', () => {
    // Before normalization: fails
    const beforeValidation = validateClaudeCodeStrictToolsList(rawResponse);
    assert.equal(beforeValidation.valid, false);

    // After normalization: succeeds!
    const normalized = normalizeToolsListResult(rawResponse);
    const afterValidation = validateClaudeCodeStrictToolsList(normalized);
    assert.equal(afterValidation.valid, true, 'Normalized output must pass strict validator');
    assert.equal(typeof normalized.ttlMs, 'number');
    assert.equal(normalized.cacheScope, 'private');
  });

  await t.test('Normalized response allows client session to successfully register all tools', () => {
    const normalized = normalizeToolsListResult(rawResponse);
    const session = simulateClaudeCodeFetchTools(normalized, 4);

    assert.equal(session.success, true);
    assert.equal(session.attempts, 1);
    assert.equal(session.tools.length, 2);
  });

  await t.test('Deterministic ordering stably sorts tools and schema properties (#23571)', () => {
    const normalized = normalizeToolsListResult(rawResponse, { deterministicOrder: true });

    assert.equal(normalized.tools[0].name, 'alpha_tool');
    assert.equal(normalized.tools[1].name, 'zeta_tool');

    // Verify deep key sorting of inputSchema properties
    const schemaProps = Object.keys(normalized.tools[1].inputSchema.properties);
    assert.deepEqual(schemaProps, ['a', 'z'], 'Properties must be alphabetically ordered for prompt caching');
  });

  await t.test('Dual-Era error code translation (#8245)', () => {
    const legacyErrorResponse = {
      jsonrpc: '2.0',
      id: 42,
      error: {
        code: -32002,
        message: 'Resource /data/not-found not found'
      }
    };

    const translated = normalizeJsonRpcResponse(legacyErrorResponse, null, {
      targetProtocolEra: '2026-07-28'
    });

    assert.equal(translated.error.code, -32602, 'Must map legacy -32002 to INVALID_PARAMS (-32602)');
    assert.equal(translated.error.data.originalCode, -32002);
  });

  // Fix F2: deepSortKeys depth limit
  await t.test('deepSortKeys enforces recursion depth limit (Fix F2)', () => {
    // Build a 60-level deep object (exceeds the 50-level limit)
    let deepObj = { leaf: 'value' };
    for (let i = 0; i < 60; i++) {
      deepObj = { nested: deepObj };
    }

    // Should not throw, and should return a result
    const sorted = deepSortKeys(deepObj);
    assert.ok(sorted, 'Must return a value without stack overflow');

    // Verify inner levels beyond depth 50 are returned as-is (unsorted but safe)
    let cursor = sorted;
    for (let i = 0; i < 50; i++) {
      assert.ok(cursor.nested, `Level ${i} must have nested key`);
      cursor = cursor.nested;
    }
  });

  // Fix F3: heuristic fallback removed
  await t.test('normalizeJsonRpcResponse does NOT modify responses without explicit method match (Fix F3)', () => {
    // A response to some custom method that happens to contain a "tools" property
    const customResponse = {
      jsonrpc: '2.0',
      id: 99,
      result: {
        tools: [{ name: 'custom_unrelated', data: 'should_not_be_sorted' }],
        custom_field: 42
      }
    };

    // Without matchingMethod, normalization must NOT be applied
    const processed = normalizeJsonRpcResponse(customResponse, null);
    assert.equal(processed.result.tools[0].name, 'custom_unrelated');
    assert.equal(processed.result.ttlMs, undefined, 'ttlMs must NOT be injected without method match');
    assert.equal(processed.result.cacheScope, undefined, 'cacheScope must NOT be injected without method match');
  });

  // Fix S4: prompts/list normalization
  await t.test('normalizePromptsListResult backfills cache hints and sorts prompts', () => {
    const rawPrompts = {
      prompts: [
        { name: 'zebra_prompt', description: 'Z' },
        { name: 'alpha_prompt', description: 'A' }
      ]
    };

    const normalized = normalizePromptsListResult(rawPrompts);

    assert.equal(normalized.ttlMs, 0, 'ttlMs must be backfilled');
    assert.equal(normalized.cacheScope, 'private', 'cacheScope must be backfilled');
    assert.equal(normalized.prompts[0].name, 'alpha_prompt', 'Prompts must be sorted');
    assert.equal(normalized.prompts[1].name, 'zebra_prompt');
  });

  // Fix S1: resources/list normalization
  await t.test('normalizeResourcesListResult backfills cache hints and sorts resources', () => {
    const rawResources = {
      resources: [
        { uri: 'file:///z.txt', name: 'Z' },
        { uri: 'file:///a.txt', name: 'A' }
      ]
    };

    const normalized = normalizeResourcesListResult(rawResources);

    assert.equal(normalized.ttlMs, 0);
    assert.equal(normalized.cacheScope, 'private');
    assert.equal(normalized.resources[0].uri, 'file:///a.txt', 'Resources must be sorted by URI');
  });
});
