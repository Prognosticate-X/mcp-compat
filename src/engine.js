/**
 * engine.js
 * 
 * Stateful Protocol Bridge & Session Tracking Engine for MCP.
 * 
 * Manages bidirectional translation between clients (like Claude Code, Agent Framework)
 * and upstream MCP servers, tracking version negotiation, cache hints, and telemetry.
 */

import {
  normalizeToolsListResult,
  normalizeResourcesListResult,
  normalizePromptsListResult,
  normalizeJsonRpcResponse
} from './normalizer.js';

/**
 * Maximum number of pending requests to track before evicting oldest entries.
 * Prevents unbounded memory growth if a server fails to respond. (Fix F1)
 */
const MAX_PENDING_REQUESTS = 10000;

/**
 * TTL in milliseconds for pending request entries.
 * Entries older than this are considered stale and will be evicted. (Fix F1)
 */
const PENDING_REQUEST_TTL_MS = 60_000;

export class McpBridgeEngine {
  constructor(options = {}) {
    this.options = {
      defaultTtlMs: 0,
      defaultCacheScope: 'private',
      deterministicOrder: true,
      verbose: false,
      ...options
    };

    this.sessionState = {
      clientProtocolVersion: null,
      serverProtocolVersion: null,
      negotiatedVersion: null,
      clientCapabilities: null,
      serverCapabilities: null,
      initialized: false
    };

    this.pendingRequests = new Map(); // id -> { method, params, timestamp }

    this.telemetry = {
      requestsProcessed: 0,
      responsesProcessed: 0,
      cacheHintsInjected: 0,
      toolsSorted: 0,
      staleRequestsEvicted: 0,
      startTime: Date.now()
    };

    // Periodic cleanup of stale pending requests (Fix F1)
    this._cleanupInterval = setInterval(() => this._evictStalePendingRequests(), 30_000);
    // Allow Node.js to exit even if interval is still active
    if (this._cleanupInterval.unref) {
      this._cleanupInterval.unref();
    }
  }

  /**
   * Evicts pending request entries that have exceeded the TTL.
   * Also enforces the hard cap on map size by evicting oldest entries first. (Fix F1)
   */
  _evictStalePendingRequests() {
    const now = Date.now();
    let evicted = 0;

    for (const [id, req] of this.pendingRequests) {
      if (now - req.timestamp > PENDING_REQUEST_TTL_MS) {
        this.pendingRequests.delete(id);
        evicted++;
      }
    }

    // Hard cap enforcement: evict oldest if still over limit
    if (this.pendingRequests.size > MAX_PENDING_REQUESTS) {
      const excess = this.pendingRequests.size - MAX_PENDING_REQUESTS;
      const iter = this.pendingRequests.keys();
      for (let i = 0; i < excess; i++) {
        const key = iter.next().value;
        this.pendingRequests.delete(key);
        evicted++;
      }
    }

    this.telemetry.staleRequestsEvicted += evicted;
  }

  /**
   * Process a JSON-RPC message sent from the Client towards the Server.
   * @param {Object} msg 
   * @returns {Object} Transformed/Normalized message to send to Server
   */
  processClientMessage(msg) {
    if (!msg || typeof msg !== 'object') return msg;

    this.telemetry.requestsProcessed++;

    // 1. Intercept `initialize` request to record client version capability
    if (msg.method === 'initialize' && msg.params) {
      this.sessionState.clientProtocolVersion = msg.params.protocolVersion || '2025-11-25';
      this.sessionState.clientCapabilities = msg.params.capabilities || {};
      if (this.options.verbose) {
        console.error(`[McpBridge] Client proposed protocolVersion: ${this.sessionState.clientProtocolVersion}`);
      }
    }

    // 2. Track pending request ID to method name for response matching
    if (msg.id !== undefined && msg.method) {
      this.pendingRequests.set(msg.id, {
        method: msg.method,
        params: msg.params,
        timestamp: Date.now()
      });
    }

    return msg;
  }

  /**
   * Process a JSON-RPC message sent from the Server back to the Client.
   * @param {Object} msg 
   * @returns {Object} Transformed/Normalized message to send to Client
   */
  processServerMessage(msg) {
    if (!msg || typeof msg !== 'object') return msg;

    this.telemetry.responsesProcessed++;

    // Match with pending request
    let matchingMethod = null;
    if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
      const req = this.pendingRequests.get(msg.id);
      matchingMethod = req.method;
      this.pendingRequests.delete(msg.id);
    }

    // 1. Intercept `initialize` response to inspect negotiated protocol version
    if (matchingMethod === 'initialize' && msg.result) {
      this.sessionState.serverProtocolVersion = msg.result.protocolVersion || '2025-11-25';
      this.sessionState.serverCapabilities = msg.result.capabilities || {};
      this.sessionState.negotiatedVersion = msg.result.protocolVersion;
      this.sessionState.initialized = true;

      if (this.options.verbose) {
        console.error(`[McpBridge] Server confirmed protocolVersion: ${this.sessionState.negotiatedVersion}`);
      }
    }

    const normOpts = {
      defaultTtlMs: this.options.defaultTtlMs,
      defaultCacheScope: this.options.defaultCacheScope,
      deterministicOrder: this.options.deterministicOrder
    };

    // 2. Normalize discovery responses — only on explicit method match (Fix F3)
    if (matchingMethod === 'tools/list' && msg.result) {
      const hadNoTtl = msg.result.ttlMs === undefined;
      const hadNoScope = msg.result.cacheScope === undefined;

      msg.result = normalizeToolsListResult(msg.result, normOpts);

      if (hadNoTtl || hadNoScope) {
        this.telemetry.cacheHintsInjected++;
      }
      if (this.options.deterministicOrder && Array.isArray(msg.result.tools)) {
        this.telemetry.toolsSorted += msg.result.tools.length;
      }
    } else if (matchingMethod === 'resources/list' && msg.result) {
      msg.result = normalizeResourcesListResult(msg.result, normOpts);
    } else if (matchingMethod === 'prompts/list' && msg.result) {
      msg.result = normalizePromptsListResult(msg.result, normOpts);
    }

    // 3. Handle Dual-Era error normalization if applicable
    if (msg.error) {
      msg = normalizeJsonRpcResponse(msg, matchingMethod, {
        targetProtocolEra: this.sessionState.clientProtocolVersion
      });
    }

    return msg;
  }

  /**
   * Returns current engine diagnostics and telemetry metrics.
   */
  getDiagnostics() {
    return {
      session: { ...this.sessionState },
      telemetry: {
        ...this.telemetry,
        uptimeMs: Date.now() - this.telemetry.startTime,
        pendingRequestsCount: this.pendingRequests.size
      }
    };
  }

  /**
   * Cleanup resources. Call when the engine is no longer needed.
   */
  destroy() {
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
      this._cleanupInterval = null;
    }
  }
}
