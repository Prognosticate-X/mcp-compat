## What's Changed in v1.1.0

Initial production release of **`mcp-compat`**, a zero-dependency Model Context Protocol (MCP) compatibility bridge and prompt cache normalizer.

### 🚀 Key Features
- **Fix Claude Code #88128**: Transparently backfills safe, conformant default cache hints (`ttlMs: 0`, `cacheScope: "private"`) on `tools/list`, `resources/list`, and `prompts/list` discovery requests, preventing Claude Code from dropping tools after 4 retries.
- **100% Prompt Cache Hit Rate**: Deterministically normalizes tool definitions and parameter `inputSchema` properties alphabetically (`deepSortKeys`), eliminating prompt cache invalidations on server restart (OpenCode #23571).
- **Dual-Era Error Translation**: Automatically maps legacy 2025-era error codes (`-32002` ResourceNotFound) to 2026-era standardized codes (`-32602` INVALID_PARAMS), aligning with Microsoft Agent Framework #8245.
- **Production-Grade Reliability**:
  - Request tracking with 60-second TTL eviction timer and 10,000-entry hard cap against memory leaks.
  - Recursion depth limit (`MAX_SORT_DEPTH = 50`) to defend against deeply nested DoS payloads.
  - Non-intrusive: zero semantic mutation on execution requests like `tools/call`.

### 📦 Quick Start
Run directly via `npx` with zero setup:
```bash
npx -y github:Prognosticate-X/mcp-compat -- <server-command> [args...]
```

### 🤝 Upstream Traceability
- **Anthropic Claude Code**: Technical advisory and workaround shared in [Issue #88128 (Comment #5944611446)](https://github.com/anthropics/claude-code/issues/88128#issuecomment-5944611446).
- **Microsoft Agent Framework**: Upstream pull request submitted at [PR #8960](https://github.com/microsoft/agent-framework/pull/8960).
