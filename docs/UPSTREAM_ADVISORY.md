# Upstream Pull Request & Patch Proposals

This document provides ready-to-merge patches and formal technical advisories for upstream projects.

---

## 1. Upstream Strategy for Anthropic Claude Code

### Target Issue
- **Issue**: [anthropics/claude-code#88128](https://github.com/anthropics/claude-code/issues/88128)
- **Title**: `[BUG] MCP tools/list and resources/list rejected as invalid when optional ttlMs/cacheScope cache hints are omitted (protocol 2026-07-28)`
- **Severity**: High (Silent tool loss for conformant MCP 2026-07-28 servers)
- **Labels**: `bug`, `has repro`, `area:mcp`

### Why a PR Is Not Viable

Claude Code is a **closed-source product**. While the repository exists on GitHub for issue tracking, the actual source code (including the Zod schema validator) is not publicly available. The file path `src/mcp/schema/discovery.ts` and the Zod schema structure shown below are **speculative reconstructions** based on error messages in MCP logs — they have NOT been verified against the real source.

### Speculative Root Cause (for reference only)

Based on the error messages reported in #88128, the likely fix in the Claude Code codebase would be:

```diff
--- a/[speculative path]/discovery-schema.ts
+++ b/[speculative path]/discovery-schema.ts
-  ttlMs: z.number(),
-  cacheScope: z.enum(["public", "private"]),
+  ttlMs: z.number().optional(),
+  cacheScope: z.enum(["public", "private"]).optional(),
```

### Recommended Action: High-Quality Issue Comment

Instead of a PR, we should post a technical comment on Issue #88128 containing:

1. **Link to our `mcp-compat` bridge** as an immediate user-side workaround.
2. **Our reproduction script** (`src/reproduction.js`) demonstrating the 4-retry → silent tool drop chain.
3. **MCP specification evidence** that `ttlMs`/`cacheScope` are optional in 2026-07-28.
4. **Ecosystem measurement data** from the community survey (0/3 modern servers emit both fields).

### Evidence Summary for Maintainers
1. **Conformance with Reference SDK**: The reference Rust SDK `rmcp` (v3.1.2) explicitly decorates these fields with `#[serde(skip_serializing_if = "Option::is_none")]` and passes unit test `cache_hints_are_omitted_when_absent`.
2. **Ecosystem Measurement**: In a live survey of public registry servers running protocol `2026-07-28`, 0 out of 3 modern servers emitted both fields.
3. **Safety**: Marking these fields as `.optional()` introduces zero breaking changes for servers that do emit them, while immediately restoring tool registration for all compliant servers.

---

## 2. Architecture Proposal for Microsoft Agent Framework

### Target Issue
- **Issue**: [microsoft/agent-framework#8245](https://github.com/microsoft/agent-framework/issues/8245)
- **Title**: `Python: [Feature]: Support the stateless MCP 2026-07-28 revision alongside 2025-era peers`

### Design Recommendations for `MCPTool` lifecycle:

1. **Defensive Ingestion Middleware**:
   When consuming `tools/list` results from downstream servers:
   ```python
   # Normalize incoming cache hints safely
   ttl_ms: int = result.get("ttlMs") or 0
   cache_scope: str = result.get("cacheScope") or "private"
   ```
2. **Error Code Era Mapping**:
   ```python
   # Legacy 2025-era servers emit -32002 for resource missing
   if error_code == -32002 and negotiated_protocol == "2026-07-28":
       return McpError(code=ErrorCode.INVALID_PARAMS, message=error_message)
   ```
3. **Deterministic Tool Registration**:
   Maintain stable alphabetical sorting when constructing agent system prompts to avoid prompt-cache misses during agent worker re-instantiations.
