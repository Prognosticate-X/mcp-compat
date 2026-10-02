import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateClaudeCodeStrictToolsList,
  validateConformantMcpToolsList,
  simulateClaudeCodeFetchTools
} from '../src/reproduction.js';

test('Claude Code #88128 Bug Reproduction Suite', async (t) => {
  const sampleServerResponse = {
    resultType: 'complete',
    tools: [
      {
        name: 'sample_tool',
        description: 'A test tool',
        inputSchema: { type: 'object' }
      }
    ]
    // ttlMs and cacheScope omitted
  };

  await t.test('Standard conformant validator accepts response without cache hints', () => {
    const result = validateConformantMcpToolsList(sampleServerResponse);
    assert.equal(result.valid, true, 'Conformant validator must allow optional cache hints');
    assert.equal(result.errors.length, 0);
  });

  await t.test('Flawed Claude Code strict validator rejects response without ttlMs/cacheScope', () => {
    const result = validateClaudeCodeStrictToolsList(sampleServerResponse);
    assert.equal(result.valid, false, 'Flawed validator must fail');
    
    const ttlError = result.errors.find(e => e.path.includes('ttlMs'));
    const scopeError = result.errors.find(e => e.path.includes('cacheScope'));

    assert.ok(ttlError, 'Must detect missing ttlMs');
    assert.equal(ttlError.code, 'invalid_type');

    assert.ok(scopeError, 'Must detect missing cacheScope');
    assert.equal(scopeError.code, 'invalid_value');
  });

  await t.test('Simulation confirms total tool loss after 4 retries', () => {
    const session = simulateClaudeCodeFetchTools(sampleServerResponse, 4);
    assert.equal(session.success, false);
    assert.equal(session.attempts, 5); // 1 initial + 4 retries
    assert.equal(session.tools.length, 0, 'Tools must be dropped when validator fails');
  });
});
