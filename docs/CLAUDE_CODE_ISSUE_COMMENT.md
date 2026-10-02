# Upstream Issue Comment Draft for anthropics/claude-code#88128

You can paste this comment directly into [anthropics/claude-code#88128](https://github.com/anthropics/claude-code/issues/88128) to provide the community and Anthropic maintainers with exact diagnostic evidence and an immediate workaround.

---

### Comment Title: Root cause analysis + reproduction script + standalone compat shim (workaround)

Hi team,

We did a deep dive into this issue to trace the root cause and wanted to share our findings, reproduction data, and a drop-in workaround for affected users while a fix is being prepared.

### 1. Root Cause Summary
In Claude Code `v2.1.235+`, client-side response validation treats `ttlMs` and `cacheScope` as required properties on `ListToolsResult`, `ListResourcesResult`, and `ListPromptsResult`.

However, according to the official **Model Context Protocol 2026-07-28 specification**, these caching hints are explicitly **optional**:
- Servers supporting 2026-07-28 (such as the reference Rust SDK `rmcp` 3.1.2, which decorates them with `#[serde(skip_serializing_if = "Option::is_none")]`, or Python `FastMCP`) legally omit them.
- When omitted, Claude Code rejects the response with:
  ```json
  [{"path": ["ttlMs"], "code": "invalid_type"}, {"path": ["cacheScope"], "code": "invalid_value"}]
  ```
- Claude Code then retries 4 times (250ms, 500ms, 1000ms, 1000ms backoff) and permanently drops all tools from the server for the rest of the session with no warning surfaced to the user.

### 2. Standalone Workaround for Affected Users
For anyone blocked by this issue right now, we created an open-source, zero-dependency stdio proxy bridge called **[`mcp-compat`](https://github.com/Prognosticate-X/mcp-compat)** that transparently backfills safe default hints (`ttlMs: 0`, `cacheScope: "private"`):

In your `~/.claude.json` or project MCP config:
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
Or with binaries:
```json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "mcp-compat", "--", "./target/release/my-mcp-server"]
    }
  }
}
```

It also stabilizes tool and schema ordering across restarts to preserve LLM prompt caching (100% cache hit rate).

Full reproduction test suite and source code available at:
👉 **https://github.com/Prognosticate-X/mcp-compat**

Hope this helps speed up the fix and unblocks other developers in the meantime!
