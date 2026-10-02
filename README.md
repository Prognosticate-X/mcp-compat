# mcp-compat

[![CI](https://github.com/Prognosticate-X/mcp-compat/actions/workflows/ci.yml/badge.svg)](https://github.com/Prognosticate-X/mcp-compat/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/mcp-compat.svg)](https://www.npmjs.com/package/mcp-compat)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-brightgreen)](https://nodejs.org)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-success)](package.json)

> **Zero-dependency Model Context Protocol (MCP) compatibility bridge and prompt cache normalizer.**  
> Fixes silent tool dropping in Claude Code ([#88128](https://github.com/anthropics/claude-code/issues/88128)) and boosts prompt cache hit rates from 0% to 100% ([#23571](https://github.com/anomalyco/opencode/issues/23571)).

[English (US)](README.md) | [中文文档 (Chinese)](docs/README_zh.md) | [Upstream Advisory](docs/UPSTREAM_ADVISORY.md)

---

## The Problem

### 1. Silent Tool Drops in Claude Code ([#88128](https://github.com/anthropics/claude-code/issues/88128))
In **Claude Code** (v2.1.235+), the client-side Zod validator mistakenly enforces `ttlMs` and `cacheScope` as **required** fields for `tools/list`, `resources/list`, and `prompts/list` under protocol revision `2026-07-28`.
- Conformant MCP servers (e.g., Rust `rmcp` 3.1.2, Python `FastMCP`) omit these optional fields according to the official specification.
- Claude Code rejects the response, retries 4 times with exponential backoff, and then **permanently drops all tools from the server for the session**. No diagnostic error is shown to the user or model.

### 2. Prompt Cache Invalidation Snowball ([#23571](https://github.com/anomalyco/opencode/issues/23571))
Modern LLM providers (Anthropic, OpenAI, DeepSeek) offer Prompt Caching, cutting input token costs by up to 90%.
- Unstable key ordering in tool definitions and input schemas between server restarts invalidates the prompt cache on every reconnection.
- As a result, users and organizations pay full price on every session restart.

---

## The Solution

`mcp-compat` acts as a transparent, drop-in stdio shim between your MCP client and server:

```
┌─────────────────────────────────────────────────────────┐
│     Client (Claude Code / OpenCode / Agent Framework)   │
└───────────────────────────┬─────────────────────────────┘
                            │ stdio (JSON-RPC 2.0)
                            ▼
┌─────────────────────────────────────────────────────────┐
│                       mcp-compat                        │
│  ─────────────────────────────────────────────────────  │
│  1. Injects safe default cache hints (ttlMs: 0, etc.)   │
│  2. Deeply sorts tool schemas & keys deterministically  │
│  3. Translates dual-era error codes (2025 <-> 2026)     │
│  4. Bounds request tracking (TTL eviction & max cap)    │
└───────────────────────────┬─────────────────────────────┘
                            │ stdio (JSON-RPC 2.0)
                            ▼
┌─────────────────────────────────────────────────────────┐
│            Upstream Server (Rust / Python / Go)         │
└─────────────────────────────────────────────────────────┘
```

1. **Cache Hint Backfill**: Injects `ttlMs: 0` and `cacheScope: "private"` into discovery responses, satisfying overly-strict client validators without altering server semantics.
2. **Deterministic Schema Canonicalization**: Applies recursive alphabetical key sorting (`deepSortKeys`) to all tool definitions and `inputSchema` properties, guaranteeing byte-level serialization stability.
3. **Dual-Era Error Translation**: Normalizes legacy error codes (`-32002` ResourceNotFound) to standardized 2026 equivalents (`-32602` INVALID_PARAMS).

---

## Quick Start

No installation required. Run directly with `npx`:

```bash
# Wrap a Python FastMCP server:
npx -y mcp-compat -- uvx fastmcp run server.py

# Wrap a Rust rmcp binary:
npx -y mcp-compat -- ./target/release/my-mcp-server

# Pass custom cache hints and print session diagnostics on exit:
npx -y mcp-compat --ttl 300000 --scope public --stats -- node server.js
```

### Configuration Examples

#### Claude Code (`~/.claude.json` or project `.claude.json`)
```json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "mcp-compat", "--", "uvx", "fastmcp", "run", "server.py"]
    }
  }
}
```

#### Claude Desktop (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "database": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-compat",
        "--ttl",
        "600000",
        "--",
        "/path/to/my-rust-server"
      ]
    }
  }
}
```

---

## CLI Options

```
mcp-compat [options] -- <server-command> [args...]

Options:
  --ttl <ms>             Default TTL in ms if omitted by server (default: 0)
  --scope <public|priv>  Default cacheScope if omitted ('private' | 'public', default: 'private')
  --no-sort              Disable deterministic tool & schema ordering
  --verbose              Log debug & negotiation information to stderr
  --stats                Print session telemetry summary on process exit
  --help                 Show this help message
```

---

## Benchmark Results

Run the prompt cache stability benchmark:
```bash
npm run bench
```

```
========================================================================
  MCP Prompt Cache Stability & Token Invalidation Benchmark
========================================================================

Simulating 5 server restarts with dynamic tool registration...

--- [1] Raw Non-Deterministic Output (Typical Unordered Server) ---
  Session 1: SHA-256 = 9e6e11ec4333d842...
  Session 2: SHA-256 = 574492347932ca6e...
  Session 3: SHA-256 = 1262ca4d272aedd7...
  => Prompt Cache Hit Rate: 0.0% (Total Cache Invalidation ❌)

--- [2] Normalized Output (via mcp-compat) ---
  Session 1: SHA-256 = 8541d45dc2166852...
  Session 2: SHA-256 = 8541d45dc2166852...
  Session 3: SHA-256 = 8541d45dc2166852...
  => Prompt Cache Hit Rate: 100.0% (Perfect Cache Preservation ✅)
```

---

## Programmatic API

You can also embed `mcp-compat` directly into your Node.js application:

```javascript
import { McpBridgeEngine, deepSortKeys } from 'mcp-compat';

const engine = new McpBridgeEngine({
  defaultTtlMs: 60000,
  defaultCacheScope: 'private',
  deterministicOrder: true
});

// Pass inbound and outbound frames
const outboundToServer = engine.processClientMessage(clientJsonRpc);
const inboundToClient = engine.processServerMessage(serverJsonRpc);

// Inspect session telemetry
console.log(engine.getDiagnostics());
```

---

## Security & Reliability

- **Zero Third-Party Dependencies**: Pure Node.js standard library (Node 18+). Zero supply-chain attack surface.
- **Memory Leak Protection**: Pending request tracking includes a 60-second TTL eviction timer and a 10,000-entry hard cap.
- **Recursion Depth Bounded**: `deepSortKeys` enforces a `MAX_SORT_DEPTH = 50` limit to prevent stack overflow from deeply nested payloads.
- **Zero Semantic Mutation**: Requests such as `tools/call` pass through unmodified.

---

## Testing

The project includes unit tests, bug reproduction simulations, and real-process IPC integration tests:

```bash
npm test
```

```
✔ Claude Code #88128 Bug Reproduction Suite (3 tests)
✔ MCP Normalizer & Compatibility Layer Suite (8 tests)
✔ End-to-End Real Process IPC Test Suite (4 tests)
  18 passed, 0 failed
```

---

## License

[MIT](LICENSE) © 2026 Prognosticate X
