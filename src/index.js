/**
 * @file index.js
 * @package mcp-compat
 * 
 * Production protocol compatibility bridge and prompt cache normalizer for
 * Model Context Protocol (MCP) clients and servers.
 */

export { McpBridgeEngine } from './engine.js';
export {
  deepSortKeys,
  normalizeToolsListResult,
  normalizeResourcesListResult,
  normalizePromptsListResult,
  normalizeJsonRpcResponse
} from './normalizer.js';
export {
  validateClaudeCodeStrictToolsList,
  validateConformantMcpToolsList,
  simulateClaudeCodeFetchTools
} from './reproduction.js';
