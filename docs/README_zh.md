# mcp-compat (中文文档)

> **零外部依赖的 MCP 协议兼容桥接器与 Prompt 缓存稳定化代理**  
> 解决 Claude Code `#88128` 工具静默丢失问题，消除重启后 Prompt 缓存雪崩（命中率从 0% 提升至 100%）。

[English Version (US)](../README.md) | [上游技术分析 (Upstream Advisory)](./UPSTREAM_ADVISORY.md)

---

## 痛点与背景

### 1. Claude Code #88128：工具被静默丢弃
在 **Claude Code** (v2.1.235+) 中，客户端 Schema 校验器错误地将 MCP 2026-07-28 规范中的可选缓存提示字段（`ttlMs`、`cacheScope`）标记为**必填（Required）**。
- 当上游合规服务端（如 Rust `rmcp` 3.1.2、Python `FastMCP`）省略这些字段时，客户端在 `tools/list` 阶段校验报错并静默重试 4 次。
- 重试用尽后，客户端**永久丢弃该服务端的全部工具**，且不在界面向用户输出任何警告。

### 2. Prompt Cache 缓存失效雪崩 (OpenCode #23571)
Anthropic / OpenAI 等现代大模型支持 Prompt Caching（缓存击穿将导致调用费用翻 10 倍）。
- 许多 MCP 服务端每次启动时注册工具和 JSON Schema 属性的顺序不同（字典乱序、哈希碰撞）。
- 导致注入 System Prompt 的字符发生变动，哈希签名改变，**每次服务端重启都会 100% 击穿 Prompt 缓存**。

---

## 解决方案

`mcp-compat` 是一个极轻量、零依赖的 stdio 桥接层：

```
[Claude Code / OpenCode / Agent Framework]
                   │
                   ▼ (stdio JSON-RPC)
       ┌────────────────────────┐
       │       mcp-compat       │
       │ ────────────────────── │
       │ 1. 自动回填 ttlMs/scope│
       │ 2. 确定性深度键排序    │
       │ 3. 双时代错误码转换    │
       └────────────────────────┘
                   │
                   ▼ (stdio JSON-RPC)
        [Upstream MCP Server]
     (Python / Rust / Go / Node)
```

1. **自动补齐规范缓存字段**：无缝注入 `ttlMs: 0` 和 `cacheScope: "private"`，平稳通过 Claude Code 过严的校验器。
2. **确定性键排序 (`deepSortKeys`)**：对工具列表、参数 Schema 进行递归字典序稳定化，保障重启后字节级哈希完全一致。
3. **双时代错误码转换**：自动将 2025 时代错误码（如 `-32002`）规范化为 2026 时代的标准化错误码。

---

## 快速上手

无需安装，直接通过 `npx` 启动任意现有的 MCP 服务端：

```bash
# 包装 Python FastMCP 服务
npx mcp-compat -- uvx fastmcp run server.py

# 包装 Rust rmcp 构建的二进制程序
npx mcp-compat -- ./target/release/my-mcp-server

# 指定自定义缓存时长 (5 分钟) 并输出诊断统计
npx mcp-compat --ttl 300000 --scope public --stats -- node my-server.js
```

### 客户端配置示例

#### 1. Claude Code (`~/.claude.json` 或项目配置)
```json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "mcp-compat", "--", "uvx", "my-server-cli"]
    }
  }
}
```

#### 2. Claude Desktop (`claude_desktop_config.json`)
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

## CLI 参数说明

```
mcp-compat [options] -- <server-command> [args...]

选项：
  --ttl <ms>            服务端省略时注入的默认 TTL 毫秒数 (默认: 0)
  --scope <public|priv> 服务端省略时注入的缓存范围 (默认: private)
  --no-sort             禁用工具和 Schema 的确定性排序
  --verbose             将调试与协议协商日志输出至 stderr
  --stats               进程退出时在 stderr 输出遥测与统计摘要
  --help                显示帮助信息
```

---

## 性能与基准测试

运行缓存稳定性基准测试：
```bash
npm run bench
```

**测试结果实测：**
- **原生无序服务端**：5 次重启会话生成 5 个不同 SHA-256 签名，缓存命中率 **0.0%** ❌
- **经 `mcp-compat` 处理**：5 次重启会话生成恒定 SHA-256 签名，缓存命中率 **100.0%** ✅

---

## 架构与安全特性

- **零外部依赖**：仅基于 Node.js 原生 API 实现（兼容 Node.js 18+）。
- **内存泄漏防护**：内置 60 秒 TTL 淘汰机制与 10,000 条上限硬约束，保障超长运行 Agent 会话内存平稳。
- **DoS 防护**：`deepSortKeys` 限制最大 50 层递归深度，拒绝深层嵌套恶意攻击。
- **零功能篡改**：严格透传 `tools/call` 等执行流量，绝不影响工具真实执行逻辑。

---

## 运行测试

```bash
# 运行全部 18 项单元与进程级集成测试
npm test
```

---

## 开源许可

本项目遵循 [MIT 许可证](../LICENSE)。
