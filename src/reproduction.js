/**
 * reproduction.js
 * 
 * Minimal reproducible demonstration of Claude Code Issue #88128:
 * "MCP tools/list and resources/list rejected as invalid when optional ttlMs/cacheScope
 *  cache hints are omitted (protocol 2026-07-28)"
 */

/**
 * Simulates Claude Code's flawed client-side schema validator (versions 2.1.235 - 2.1.237).
 * Notice ttlMs and cacheScope were mistakenly marked as REQUIRED instead of OPTIONAL.
 */
export function validateClaudeCodeStrictToolsList(result) {
  const errors = [];

  if (!result || typeof result !== 'object') {
    errors.push({ path: [], code: 'invalid_type', message: 'Expected object, received ' + typeof result });
    return { valid: false, errors };
  }

  // Tools array validation
  if (!Array.isArray(result.tools)) {
    errors.push({ path: ['tools'], code: 'invalid_type', message: 'Invalid input: expected array, received ' + typeof result.tools });
  }

  // FLAW: ttlMs is expected to be a number, missing the .optional() modifier in client validator
  if (typeof result.ttlMs !== 'number') {
    errors.push({
      path: ['ttlMs'],
      code: 'invalid_type',
      message: 'Invalid input: expected number, received ' + (result.ttlMs === undefined ? 'undefined' : typeof result.ttlMs)
    });
  }

  // FLAW: cacheScope is expected to be 'public' | 'private', missing the .optional() modifier
  if (result.cacheScope !== 'public' && result.cacheScope !== 'private') {
    errors.push({
      path: ['cacheScope'],
      code: 'invalid_value',
      values: ['public', 'private'],
      message: 'Invalid option: expected one of "public"|"private"'
    });
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * The reference/official MCP 2026-07-28 compliant validator (as implemented in Rust rmcp 3.1.2).
 * Both ttlMs and cacheScope are optional cache hints.
 */
export function validateConformantMcpToolsList(result) {
  const errors = [];

  if (!result || typeof result !== 'object') {
    return { valid: false, errors: [{ path: [], message: 'Expected object' }] };
  }

  if (!Array.isArray(result.tools)) {
    errors.push({ path: ['tools'], message: 'Expected array' });
  }

  if (result.ttlMs !== undefined && typeof result.ttlMs !== 'number') {
    errors.push({ path: ['ttlMs'], message: 'ttlMs must be a number when provided' });
  }

  if (result.cacheScope !== undefined && !['public', 'private'].includes(result.cacheScope)) {
    errors.push({ path: ['cacheScope'], message: 'cacheScope must be "public" | "private" when provided' });
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Simulates a client session attempting to fetch tools from a server.
 * Returns { success: boolean, attempts: number, activeTools: Array }
 */
export function simulateClaudeCodeFetchTools(serverResponse, maxRetries = 4) {
  const delays = [250, 500, 1000, 1000];
  const logs = [];
  let attempts = 0;

  logs.push({ level: 'debug', msg: 'Connection established with protocol: 2026-07-28' });

  for (let i = 0; i <= maxRetries; i++) {
    attempts++;
    const validation = validateClaudeCodeStrictToolsList(serverResponse);

    if (validation.valid) {
      logs.push({ level: 'info', msg: `Successfully registered ${serverResponse.tools.length} tools.` });
      return { success: true, attempts, tools: serverResponse.tools, logs };
    }

    if (i < maxRetries) {
      const delay = delays[i] || 1000;
      logs.push({
        level: 'warn',
        msg: `tools/list failed (Invalid result for tools/list: ${JSON.stringify(validation.errors)}); retrying in ${delay}ms`
      });
    } else {
      logs.push({
        level: 'error',
        msg: `Failed to fetch tools: Invalid result for tools/list: ${JSON.stringify(validation.errors)}`
      });
    }
  }

  // After 4 retries, the server's tools are completely dropped.
  return { success: false, attempts, tools: [], logs };
}

// Standalone execution demo
if (process.argv[1] && process.argv[1].endsWith('reproduction.js')) {
  console.log('=== Reproducing Claude Code Issue #88128 ===\n');

  // A standard, fully compliant MCP 2026-07-28 response from Rust rmcp / FastMCP
  const compliantServerResponse = {
    resultType: 'complete',
    tools: [
      {
        name: 'query_database',
        description: 'Execute a read-only SQL query against the system database',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query']
        }
      },
      {
        name: 'search_documentation',
        description: 'Semantic vector search across developer documentation',
        inputSchema: {
          type: 'object',
          properties: { term: { type: 'string' } },
          required: ['term']
        }
      }
    ]
    // ttlMs and cacheScope omitted (legal optional fields)
  };

  console.log('[1] Reference Validator Check:');
  const conformantCheck = validateConformantMcpToolsList(compliantServerResponse);
  console.log(`    Conformant MCP Spec Validator: ${conformantCheck.valid ? 'PASSED ✅' : 'FAILED ❌'}`);

  console.log('\n[2] Claude Code Strict Validator Check:');
  const claudeCodeCheck = validateClaudeCodeStrictToolsList(compliantServerResponse);
  console.log(`    Claude Code Client Validator: ${claudeCodeCheck.valid ? 'PASSED ✅' : 'FAILED ❌'}`);
  console.log('    Errors detected:');
  console.log(JSON.stringify(claudeCodeCheck.errors, null, 2));

  console.log('\n[3] Full Client Session Simulation:');
  const sessionResult = simulateClaudeCodeFetchTools(compliantServerResponse);
  console.log(`    Session Success: ${sessionResult.success}`);
  console.log(`    Attempts made: ${sessionResult.attempts}`);
  console.log(`    Registered tools count: ${sessionResult.tools.length}`);
  console.log('\n    Session Logs:');
  sessionResult.logs.forEach(l => console.log(`      [${l.level.toUpperCase()}] ${l.msg}`));
}
