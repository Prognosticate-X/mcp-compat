# Upstream Contributions & Community Advisory

This document tracks upstream interactions, pull requests, and technical advisories initiated from the `mcp-compat` project.

---

## 1. Anthropic Claude Code

- **Target Issue**: [anthropics/claude-code#88128](https://github.com/anthropics/claude-code/issues/88128)
- **Title**: `[BUG] MCP tools/list and resources/list rejected as invalid when optional ttlMs/cacheScope cache hints are omitted (protocol 2026-07-28)`
- **Severity**: High (Silent tool loss for conformant MCP 2026-07-28 servers)
- **Status**: **Comment Submitted (Active)**
- **Live Comment**: [Comment #5944611446](https://github.com/anthropics/claude-code/issues/88128#issuecomment-5944611446)

### Contribution Summary
1. Provided root-cause breakdown linking official 2026-07-28 specification and Rust `rmcp` 3.1.2 reference implementation (`#[serde(skip_serializing_if = "Option::is_none")]`).
2. Confirmed the 4-retry silent tool drop cycle via minimal reproduction simulation.
3. Provided `mcp-compat` as an immediate user-side workaround while upstream patch is prepared.

---

## 2. Microsoft Agent Framework

- **Target Repository**: [microsoft/agent-framework](https://github.com/microsoft/agent-framework)
- **Target Initiative**: [#8245 (Python: Support stateless MCP 2026-07-28 revision alongside 2025-era peers)](https://github.com/microsoft/agent-framework/issues/8245)
- **Pull Request**: **[microsoft/agent-framework#8960](https://github.com/microsoft/agent-framework/pull/8960)**
- **PR Title**: `Python: sort MCP inputSchema properties deterministically for prompt caching`
- **Branch**: `Prognosticate-X:fix/mcp-deterministic-schema-ordering`
- **Status**: **Open (In Review)**

### Contribution Summary
1. **Core change**: In `python/packages/core/agent_framework/_mcp.py` during `MCPTool.load_tools()`, sort `input_schema["properties"]` by key alphabetically if it is a dictionary.
2. **Impact**: Guarantees byte-level JSON Schema stability across restarts and dynamic tool reload notifications (`notifications/tools/list_changed`), maximizing LLM prompt cache hit rate (100%).
3. **Tests**: Added dedicated unit test `test_load_tools_sorts_input_schema_properties_deterministically()` in `python/packages/core/tests/core/test_mcp.py` (395/395 tests passing).
