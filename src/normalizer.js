/**
 * normalizer.js
 * 
 * MCP 2026 Protocol Normalizer & Compatibility Layer
 * 
 * Features:
 * 1. Cache Hint Backfill: Injects safe, spec-compatible default hints (ttlMs, cacheScope)
 *    when talking to overly-strict clients (fixes Claude Code #88128).
 * 2. Deterministic Schema Ordering: Sorts tools and inputSchema properties deterministically,
 *    preventing prompt cache invalidations (fixes OpenCode #23571).
 * 3. Dual-Era Error & Protocol Normalization: Normalizes error codes and metadata across
 *    2025-11-25 and 2026-07-28 protocol revisions (aligns with Agent Framework #8245).
 */

const MAX_SORT_DEPTH = 50;

/**
 * Recursively sorts an object's keys to produce a deterministic JSON serialization.
 * Enforces a maximum recursion depth to prevent stack overflow from malicious input.
 * 
 * @param {*} obj - Value to sort.
 * @param {number} [depth=0] - Current recursion depth (internal).
 * @returns {*} Deep-sorted copy, or the original value if depth limit is reached.
 */
export function deepSortKeys(obj, depth = 0) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (depth >= MAX_SORT_DEPTH) {
    return obj; // Safety: stop recursion, return as-is
  }
  if (Array.isArray(obj)) {
    return obj.map(item => deepSortKeys(item, depth + 1));
  }
  const sorted = {};
  Object.keys(obj)
    .sort()
    .forEach(key => {
      sorted[key] = deepSortKeys(obj[key], depth + 1);
    });
  return sorted;
}

/**
 * Backfills cache hint fields (ttlMs, cacheScope) onto a result object if absent.
 * Extracted as a shared helper since tools/list, resources/list, and prompts/list
 * all share the same cache hint schema in MCP 2026-07-28.
 */
function backfillCacheHints(result, defaultTtlMs, defaultCacheScope) {
  if (result.ttlMs === undefined) {
    result.ttlMs = defaultTtlMs;
  }
  if (result.cacheScope === undefined) {
    result.cacheScope = defaultCacheScope;
  }
}

/**
 * Normalizes an MCP `tools/list` response object.
 * 
 * @param {Object} result - The response `result` payload from the server.
 * @param {Object} [options]
 * @param {number} [options.defaultTtlMs=0] - Default TTL in ms if omitted (0 = no proactive cache).
 * @param {string} [options.defaultCacheScope='private'] - Default cache scope ('private' | 'public').
 * @param {boolean} [options.deterministicOrder=true] - Whether to sort tools alphabetically.
 * @returns {Object} Normalized result payload.
 */
export function normalizeToolsListResult(result, options = {}) {
  if (!result || typeof result !== 'object') {
    return result;
  }

  const {
    defaultTtlMs = 0,
    defaultCacheScope = 'private',
    deterministicOrder = true
  } = options;

  const normalized = { ...result };

  // 1. Ensure resultType is declared
  if (!normalized.resultType) {
    normalized.resultType = 'complete';
  }

  // 2. Cache Hints Backfill (Fix for Claude Code #88128)
  backfillCacheHints(normalized, defaultTtlMs, defaultCacheScope);

  // 3. Deterministic tool ordering and schema normalization (Fix for OpenCode #23571)
  if (Array.isArray(normalized.tools)) {
    let tools = [...normalized.tools];

    if (deterministicOrder) {
      tools.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }

    tools = tools.map(tool => {
      const copy = { ...tool };
      if (copy.inputSchema && typeof copy.inputSchema === 'object') {
        copy.inputSchema = deepSortKeys(copy.inputSchema);
      }
      return copy;
    });

    normalized.tools = tools;
  }

  return normalized;
}

/**
 * Normalizes an MCP `resources/list` response object.
 */
export function normalizeResourcesListResult(result, options = {}) {
  if (!result || typeof result !== 'object') {
    return result;
  }

  const {
    defaultTtlMs = 0,
    defaultCacheScope = 'private',
    deterministicOrder = true
  } = options;

  const normalized = { ...result };

  backfillCacheHints(normalized, defaultTtlMs, defaultCacheScope);

  if (deterministicOrder && Array.isArray(normalized.resources)) {
    normalized.resources = [...normalized.resources].sort((a, b) => 
      (a.uri || a.name || '').localeCompare(b.uri || b.name || '')
    );
  }

  return normalized;
}

/**
 * Normalizes an MCP `prompts/list` response object.
 * Added per review finding S4: prompts/list also carries ttlMs/cacheScope in 2026-07-28.
 */
export function normalizePromptsListResult(result, options = {}) {
  if (!result || typeof result !== 'object') {
    return result;
  }

  const {
    defaultTtlMs = 0,
    defaultCacheScope = 'private',
    deterministicOrder = true
  } = options;

  const normalized = { ...result };

  backfillCacheHints(normalized, defaultTtlMs, defaultCacheScope);

  if (deterministicOrder && Array.isArray(normalized.prompts)) {
    normalized.prompts = [...normalized.prompts].sort((a, b) =>
      (a.name || '').localeCompare(b.name || '')
    );
  }

  return normalized;
}

/**
 * Normalizes full JSON-RPC response frames passing from an MCP server to an MCP client.
 * 
 * IMPORTANT (Fix F3): Only normalizes when matchingMethod is explicitly provided.
 * Removed heuristic fallback based on result property names to prevent false-positive
 * normalization of non-discovery responses that happen to contain a "tools" key.
 * 
 * @param {Object} jsonRpcMessage - The incoming JSON-RPC frame.
 * @param {string|null} [matchingMethod] - The method name of the corresponding request.
 * @param {Object} [options]
 * @returns {Object}
 */
export function normalizeJsonRpcResponse(jsonRpcMessage, matchingMethod = null, options = {}) {
  if (!jsonRpcMessage || typeof jsonRpcMessage !== 'object') {
    return jsonRpcMessage;
  }

  // Handle successful response — only with explicit method match (Fix F3)
  if (jsonRpcMessage.result && typeof jsonRpcMessage.result === 'object' && matchingMethod) {
    if (matchingMethod === 'tools/list') {
      jsonRpcMessage.result = normalizeToolsListResult(jsonRpcMessage.result, options);
    } else if (matchingMethod === 'resources/list') {
      jsonRpcMessage.result = normalizeResourcesListResult(jsonRpcMessage.result, options);
    } else if (matchingMethod === 'prompts/list') {
      jsonRpcMessage.result = normalizePromptsListResult(jsonRpcMessage.result, options);
    }
  }

  // Handle error code dual-era normalization (Agent Framework #8245)
  if (jsonRpcMessage.error && typeof jsonRpcMessage.error === 'object') {
    if (options.targetProtocolEra === '2026-07-28' && jsonRpcMessage.error.code === -32002) {
      jsonRpcMessage.error.code = -32602; // INVALID_PARAMS
      jsonRpcMessage.error.data = {
        originalCode: -32002,
        reason: 'RESOURCE_NOT_FOUND',
        ...jsonRpcMessage.error.data
      };
    }
  }

  return jsonRpcMessage;
}
