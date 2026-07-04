# AstraFlow Desktop 多 Agent Runtime 平台技术调研报告

## 目录

1. [Claude Agent SDK TypeScript](#1-claude-agent-sdk-typescript)
2. [Codex 接入方式](#2-codex-接入方式)
3. [ACP Agent Client Protocol](#3-acp-agent-client-protocol)
4. [综合对比与推荐架构](#4-综合对比与推荐架构)
5. [未验证事项清单](#5-未验证事项清单)

---

## 0. 版本核验摘要

以下版本号均已通过本机 `npm view <pkg> ...` 实际核验：

| 包 | 已核验版本 | License | 备注 |
|---|---:|---|---|
| `@anthropic-ai/claude-agent-sdk` | `0.3.201` | `SEE LICENSE IN README.md` | Claude Agent SDK TS，仓库为 `anthropics/claude-agent-sdk-typescript`。[npm](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) / [GitHub](https://github.com/anthropics/claude-agent-sdk-typescript) |
| `@openai/codex-sdk` | `0.142.5` | `Apache-2.0` | Codex TS SDK，位于 OpenAI Codex monorepo 的 `sdk/typescript`。[npm](https://www.npmjs.com/package/@openai/codex-sdk) / [GitHub](https://github.com/openai/codex/tree/main/sdk/typescript) |
| `@openai/codex` | `0.142.5` | `Apache-2.0` | Codex CLI。[npm](https://www.npmjs.com/package/@openai/codex) / [GitHub](https://github.com/openai/codex) |
| `@agentclientprotocol/sdk` | `1.1.0` | `Apache-2.0` | 当前 ACP TypeScript SDK 包名。[npm](https://www.npmjs.com/package/@agentclientprotocol/sdk) / [GitHub](https://github.com/agentclientprotocol/typescript-sdk) |
| `@zed-industries/agent-client-protocol` | `0.4.5` | `Apache-2.0` | 早期/并存的 Zed ACP 包。[npm](https://www.npmjs.com/package/@zed-industries/agent-client-protocol) / [GitHub](https://github.com/zed-industries/agent-client-protocol) |
| `@agentclientprotocol/codex-acp` | `1.1.0` | `Apache-2.0` | ACP Codex adapter；未 scoped 的 `codex-acp` npm 包未找到。[npm](https://www.npmjs.com/package/@agentclientprotocol/codex-acp) / [GitHub](https://github.com/agentclientprotocol/codex-acp) |
| `@zed-industries/codex-acp` | `0.16.0` | `Apache-2.0` | Zed 维护的 Codex ACP adapter。[npm](https://www.npmjs.com/package/@zed-industries/codex-acp) / [GitHub](https://github.com/zed-industries/codex-acp) |
| `claude-code-acp` | `0.1.1` | `MIT` | 第三方 Claude Code ACP adapter。[npm](https://www.npmjs.com/package/claude-code-acp) / [GitHub](https://github.com/carlrannaberg/cc-acp) |
| `@agentclientprotocol/claude-agent-acp` | `0.55.0` | `Apache-2.0` | 基于 Claude Agent SDK TS 的 ACP agent。[npm](https://www.npmjs.com/package/@agentclientprotocol/claude-agent-acp) / [GitHub](https://github.com/agentclientprotocol/claude-agent-acp) |
| `@google/gemini-cli` | `0.49.0` | `Apache-2.0` | Gemini CLI；ACP 官网列为 first-class ACP 支持。[npm](https://www.npmjs.com/package/@google/gemini-cli) / [GitHub](https://github.com/google-gemini/gemini-cli) |
| `deepagents` | `1.10.5` | `MIT` | LangChain Deep Agents JS。[npm](https://www.npmjs.com/package/deepagents) / [GitHub](https://github.com/langchain-ai/deepagentsjs) |

---

## 1. Claude Agent SDK TypeScript

### 1.1 定位与嵌入方式

`@anthropic-ai/claude-agent-sdk` 是 Claude Code 能力的 TypeScript SDK，官方文档明确说它建立在 Claude Code 之上，用于把 Claude Code 的 agentic coding 能力嵌入应用或自动化工作流。[Claude SDK Overview](https://docs.claude.com/en/docs/claude-code/sdk/sdk-overview)

TypeScript 版本包含 bundled Claude Code binary，因此在 Node/Electron 应用中不要求用户另外安装 Claude Code CLI；官方文档写明 “No separate installation of Claude Code required”。[Claude SDK Overview](https://docs.claude.com/en/docs/claude-code/sdk/sdk-overview)

官方描述的运行模型是本地 subprocess 架构，SDK 负责启动/管理 Claude Code 子进程并通过流式消息交互，因此在 Electron 中更适合放在 main process 或受控 Node service 中，不建议放在 renderer 直接执行本地工具权限。[Claude SDK Overview](https://docs.claude.com/en/docs/claude-code/sdk/sdk-overview)

### 1.2 `query()` API 用法

TypeScript SDK 的核心 API 是 `query()`，类型为异步函数，返回 `Query`；`Query` 继承 `AsyncGenerator<SDKMessage>`，因此可以用 `for await ... of` 消费消息流。[Claude SDK TypeScript](https://docs.claude.com/en/docs/claude-code/sdk/sdk-typescript)

`query()` 的 `prompt` 可以是字符串，也可以是 `AsyncIterable<SDKUserMessage>`，这意味着 SDK 支持 streaming input / 多轮输入流。[Claude SDK TypeScript](https://docs.claude.com/en/docs/claude-code/sdk/sdk-typescript)

示意代码：

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";

const stream = query({
  prompt: "请分析这个仓库的聊天运行时架构",
  options: {
    cwd: "/path/to/astraflow-desktop",
    permissionMode: "acceptEdits",
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: "你是 AstraFlow Desktop 的运行时架构助手。",
    },
  },
});

for await (const message of stream) {
  if (message.type === "assistant") {
    for (const block of message.message.content) {
      if (block.type === "text") {
        console.log(block.text);
      }
      if (block.type === "tool_use") {
        console.log("tool use", block.name, block.input);
      }
    }
  }

  if (message.type === "result") {
    console.log("done", message.subtype, message.session_id);
  }
}
```

`Query` 还提供 `interrupt()`、`setPermissionMode(mode)`、`setModel(model)` 等运行时控制方法，可用于 UI 中断、动态切换 permission mode 或模型。[Claude SDK TypeScript](https://docs.claude.com/en/docs/claude-code/sdk/sdk-typescript)

### 1.3 流式消息事件形状

SDK 的 `SDKMessage` union 包括：

- `SDKAssistantMessage`
- `SDKUserMessage`
- `SDKUserMessageReplay`
- `SDKResultMessage`
- `SDKSystemMessage`
- `SDKPartialAssistantMessage`

这些类型来自官方 TypeScript SDK 文档。[Claude SDK TypeScript](https://docs.claude.com/en/docs/claude-code/sdk/sdk-typescript)

关键事件形状：

```ts
type SDKAssistantMessage = {
  type: "assistant";
  message: Message;
  session_id: string;
};

type SDKResultMessage = {
  type: "result";
  subtype: "success" | "error_max_turns" | "error_during_execution";
  duration_ms: number;
  duration_api_ms: number;
  is_error: boolean;
  num_turns: number;
  result?: string;
  session_id: string;
  total_cost_usd?: number;
  usage?: unknown;
};

type SDKSystemMessage = {
  type: "system";
  subtype: "init";
  apiKeySource: string;
  cwd: string;
  mcp_servers: unknown[];
  model: string;
  permissionMode: string;
  session_id: string;
  slash_commands: unknown[];
  tools: string[];
};

type SDKPartialAssistantMessage = {
  type: "stream_event";
  event: RawMessageStreamEvent;
  session_id: string;
  parent_tool_use_id?: string;
  uuid?: string;
};
```

以上字段名称和 union 类型来自官方 TypeScript SDK 文档；实际 `Message.content` 内部遵循 Anthropic Messages API content block 结构，常见 block 包括 `text`、`tool_use`、`tool_result` 等。[Claude SDK TypeScript](https://docs.claude.com/en/docs/claude-code/sdk/sdk-typescript)

如果设置 `includePartialMessages`，SDK 会暴露 `type: "stream_event"` 的低层流式事件，适合映射到 AstraFlow 现有的 text/reasoning/tool parts 流式 snapshot。[Claude SDK TypeScript](https://docs.claude.com/en/docs/claude-code/sdk/sdk-typescript)

### 1.4 Streaming input

`query({ prompt })` 的 `prompt` 支持 `string | AsyncIterable<SDKUserMessage>`，这可以把 AstraFlow 的 UI 输入、外部事件或上游 agent 输出转成异步用户消息流。[Claude SDK TypeScript](https://docs.claude.com/en/docs/claude-code/sdk/sdk-typescript)

示意：

```ts
async function* userInputStream() {
  yield {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text: "先读取项目结构" }],
    },
  };

  yield {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text: "继续分析 chat runtime" }],
    },
  };
}

const stream = query({
  prompt: userInputStream(),
  options: { cwd: "/repo" },
});
```

### 1.5 会话恢复：`resume`、`continue`、`session_id`

官方 `Options` 中包含 `resume?: string` 和 `continue?: boolean`。[Claude SDK TypeScript](https://docs.claude.com/en/docs/claude-code/sdk/sdk-typescript)

SDK 消息中会携带 `session_id`，包括 `assistant`、`system/init`、`result` 和 partial stream event，因此 AstraFlow 可以将 provider session id 保存到 sqlite session metadata，用于后续 resume。[Claude SDK TypeScript](https://docs.claude.com/en/docs/claude-code/sdk/sdk-typescript)

建议持久化字段：

```ts
type ClaudeRuntimeSessionState = {
  provider: "claude-agent-sdk";
  sdkVersion: "0.3.201";
  claudeSessionId: string;
  cwd: string;
  model?: string;
  permissionMode?: string;
  lastResultSubtype?: string;
};
```

### 1.6 权限回调 `canUseTool`

TypeScript SDK 的 `Options` 包含 `canUseTool?: CanUseTool`，用于在工具调用前进行权限判定。[Claude SDK TypeScript](https://docs.claude.com/en/docs/claude-code/sdk/sdk-typescript)

这正好可以映射为统一 runtime 事件 `permission_request`：adapter 在 `canUseTool` 中暂停，向前端发出审批请求，用户选择后返回 SDK 需要的 permission result。

示意：

```ts
const stream = query({
  prompt: "修改这个文件",
  options: {
    cwd,
    canUseTool: async (toolName, input, context) => {
      const decision = await permissionBroker.request({
        runtime: "claude",
        toolName,
        input,
        context,
      });

      return decision.approved
        ? { behavior: "allow", updatedInput: input }
        : { behavior: "deny", message: decision.reason ?? "Rejected by user" };
    },
  },
});
```

具体返回值字段应以当前 SDK 类型定义为准；上面是架构示意，`CanUseTool` / `PermissionResult` 由官方 TypeScript 文档定义。[Claude SDK TypeScript](https://docs.claude.com/en/docs/claude-code/sdk/sdk-typescript)

### 1.7 Hooks

`Options.hooks` 支持多类 lifecycle hook，包括 `PreToolUse`、`PostToolUse`、`Notification`、`UserPromptSubmit`、`Stop`、`SubagentStop`、`PreCompact`、`SessionStart`、`SessionEnd` 等，hook callback 返回 `HookJSONOutput`。[Claude SDK TypeScript](https://docs.claude.com/en/docs/claude-code/sdk/sdk-typescript)

对 AstraFlow 的价值：

- `PreToolUse` / `PostToolUse` 可归一化为 activity timeline 和 tool call 状态。
- `Notification` 可映射为非阻塞 activity。
- `SessionStart` / `SessionEnd` 可驱动 sqlite snapshot 生命周期。
- `Stop` / `SubagentStop` 可映射为 run completed / cancelled / failed。

### 1.8 MCP server 配置

`Options.mcpServers` 类型为 `Record<string, McpServerConfig>`，官方文档提供了本地 stdio、HTTP/SSE、SDK in-process server 等 MCP 配置形态。[Claude SDK TypeScript](https://docs.claude.com/en/docs/claude-code/sdk/sdk-typescript)

示意：

```ts
query({
  prompt: "使用 MCP 工具查询上下文",
  options: {
    cwd,
    mcpServers: {
      localToolServer: {
        type: "stdio",
        command: "node",
        args: ["/path/to/server.js"],
      },
      remoteToolServer: {
        type: "http",
        url: "https://example.com/mcp",
      },
    },
    strictMcpConfig: true,
  },
});
```

对桌面应用的含义：MCP server 配置应由 AstraFlow runtime 层统一管理，避免每个 agent adapter 各自读取用户文件或环境变量。

### 1.9 自定义 system prompt

`Options.systemPrompt` 支持字符串，也支持 preset 形式，例如使用 `claude_code` preset 并追加内容。[Claude SDK TypeScript](https://docs.claude.com/en/docs/claude-code/sdk/sdk-typescript)

示意：

```ts
systemPrompt: {
  type: "preset",
  preset: "claude_code",
  append: "遵循 AstraFlow 的消息模型和权限策略。",
}
```

架构建议：AstraFlow 不应让 adapter 自行拼接完整 prompt，而应提供统一 `RuntimeInstruction`，再由各 adapter 转成 provider-specific system prompt。

### 1.10 Provider、第三方端点与认证限制

官方 SDK overview 写明 SDK 支持 Anthropic API、Amazon Bedrock、Google Vertex AI，并在认证章节提到第三方 providers，包括 Amazon Bedrock、Google Vertex AI、Azure AI Foundry。[Claude SDK Overview](https://docs.claude.com/en/docs/claude-code/sdk/sdk-overview)

未发现官方文档确认 Claude Agent SDK 可直接指向任意 OpenAI-compatible endpoint 或自建 OpenAI 兼容端点；因此架构上应视为“不支持任意 OpenAI-compatible endpoint”，除非 Anthropic 官方后续确认或用户提供的代理严格实现 Anthropic/Claude Code 所需协议。此点标记为“未验证”。[Claude SDK Overview](https://docs.claude.com/en/docs/claude-code/sdk/sdk-overview)

> **AstraFlow 补充订正（2026-07-04）**：Claude Code / Claude Agent SDK 支持 `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` 环境变量，可将请求重定向到 **Anthropic 协议兼容**端点。ModelVerse 提供 Anthropic 兼容端点（AstraFlow 现有 `ChatAnthropic` 即走 `MODELVERSE_ANTHROPIC_BASE_URL`），因此 Claude Agent SDK 可经此方式接 ModelVerse——注意这属于“Anthropic 协议兼容”，与上文的“OpenAI-compatible endpoint”不是一回事。SDK 全量能力（tool-use 流、thinking、prompt caching、subagent）在该端点上的表现需 spike 验证。

官方文档还明确不推荐一般性地用 Claude Pro/Max subscription 驱动 SDK；如果要把应用分发给其他开发者，并允许他们使用 subscription login，需要 Anthropic 特别批准；没有该批准时，用户必须使用 API key 认证。[Claude SDK Overview](https://docs.claude.com/en/docs/claude-code/sdk/sdk-overview)

### 1.11 许可与商业分发

`@anthropic-ai/claude-agent-sdk` 的 npm license 字段为 `SEE LICENSE IN README.md`，不是 MIT/Apache-2.0；仓库 license 文件授予使用、复制、分发、基于源码制作衍生作品等权利，但受 Anthropic Commercial Terms of Service 约束。[npm](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) / [LICENSE.md](https://raw.githubusercontent.com/anthropics/claude-agent-sdk-typescript/main/LICENSE.md)

结合认证条款，商业桌面应用内嵌 SDK 的主要限制不是单纯 npm 安装，而是：

- 是否允许分发 bundled Claude Code binary：需要按 Anthropic license / commercial terms 评估。[LICENSE.md](https://raw.githubusercontent.com/anthropics/claude-agent-sdk-typescript/main/LICENSE.md)
- 是否允许用户使用自己的 Claude subscription login：官方文档要求特殊批准；否则应使用 API key。[Claude SDK Overview](https://docs.claude.com/en/docs/claude-code/sdk/sdk-overview)
- 是否允许企业环境使用 Bedrock/Vertex/Azure：官方文档列为支持方向，但具体配置、计费、区域和合规应在接入阶段单独验证。[Claude SDK Overview](https://docs.claude.com/en/docs/claude-code/sdk/sdk-overview)

### 1.12 对 AstraFlow 的结论

Claude Agent SDK 是“直连 Claude Code 能力”的高价值 adapter，但不建议作为唯一外部 agent 标准。原因：

1. API 能力很强：流式输出、流式输入、resume、hooks、MCP、permission callback 都适合映射到 AstraFlow 的统一消息模型。[Claude SDK TypeScript](https://docs.claude.com/en/docs/claude-code/sdk/sdk-typescript)
2. 供应商绑定明显：官方支持的 provider 主要是 Anthropic API / Bedrock / Vertex / Azure，而非通用 OpenAI-compatible endpoint。[Claude SDK Overview](https://docs.claude.com/en/docs/claude-code/sdk/sdk-overview)
3. 分发和认证有商业限制：subscription login 分发需要 Anthropic 特批；无批准时用户应使用 API key。[Claude SDK Overview](https://docs.claude.com/en/docs/claude-code/sdk/sdk-overview)

---

## 2. Codex 接入方式

### 2.1 可选接入面

Codex 当前有三条主要接入路线：

1. `@openai/codex-sdk`：TypeScript SDK，用于 JS/TS 应用集成 Codex CLI。[Codex SDK README](https://github.com/openai/codex/tree/main/sdk/typescript)
2. `codex exec --json`：非交互式 CLI，输出 JSONL 事件流；适合批处理、一次性任务和 CI 自动化。[Codex README](https://github.com/openai/codex)
3. `codex app-server`：实验性 app/IDE 协议，提供 stateful JSON-RPC 2.0 接口，适合富客户端、审批、历史、流式事件和会话控制。[Codex App Server](https://developers.openai.com/codex/app-server)

Codex 官方 README 表述其为本地运行的开源 coding agent，可通过 npm 或 Homebrew 安装，并支持 ChatGPT 登录或 OpenAI API key 认证。[Codex README](https://github.com/openai/codex)

### 2.2 `@openai/codex-sdk`

`@openai/codex-sdk` 的 npm 版本已核验为 `0.142.5`，license 为 `Apache-2.0`。[npm](https://www.npmjs.com/package/@openai/codex-sdk) / [GitHub](https://github.com/openai/codex/tree/main/sdk/typescript)

SDK README 描述它用于把 Codex CLI 集成到 JS/TS 应用；SDK 会确保 CLI 可用，并通过 stdin/stdout 上的 newline-delimited JSON 协议与 CLI 通信。[Codex SDK README](https://github.com/openai/codex/tree/main/sdk/typescript)

基础示意：

```ts
import { Codex } from "@openai/codex-sdk";

const codex = new Codex();
const thread = codex.startThread();

const result = await thread.run("请分析当前仓库的 chat runtime");
console.log(result);
```

流式示意：

```ts
const turn = thread.runStreamed("请修改运行时抽象设计");

for await (const event of turn) {
  if (event.type === "item.completed") {
    console.log(event.item);
  }

  if (event.type === "turn.completed") {
    console.log("turn completed");
  }
}

const result = await turn.result;
```

`runStreamed()` 返回 `AsyncIterable` 的 `CodexEvent`，SDK README 示例中包含 `item.completed` 和 `turn.completed` 事件。[Codex SDK README](https://github.com/openai/codex/tree/main/sdk/typescript)

### 2.3 `codex exec --json`

本机 CLI 已核验为 `codex-cli 0.142.5`。`codex exec --help` 显示 `--json` 选项含义为“Print events to stdout as JSONL”，即 stdout 输出 JSON Lines 事件流；该命令定位为非交互式运行 Codex。[Codex README](https://github.com/openai/codex)

`codex exec` 还支持 `resume` 子命令、`--sandbox`、`--dangerously-bypass-approvals-and-sandbox`、`--model`、`--oss`、`--local-provider`、`--output-schema`、`--output-last-message` 等选项；这些已通过本机 `codex exec --help` 核验，但官方网页中对每个 flag 的事件细节没有完全展开。[Codex README](https://github.com/openai/codex)

适合场景：

- 一次性“执行任务并返回结果”。
- 不需要复杂 UI 审批闭环。
- 可以接受进程级 JSONL 解析和较弱的会话控制。

不适合场景：

- 复杂前端实时 tool timeline。
- 精细权限审批。
- 长生命周期桌面 session。
- 多 turn rich client 体验。

这些 rich-client 场景官方更推荐 app-server，而非 `exec`。[Codex App Server](https://developers.openai.com/codex/app-server)

### 2.4 `codex app-server`

`codex app-server` 是官方标注为 experimental 的接口，用于让 IDE、GUI 或其他应用通过 stateful JSON-RPC 2.0 与 Codex CLI 通信。[Codex App Server](https://developers.openai.com/codex/app-server)

官方文档说明 app-server 支持：

- stateful sessions / threads。
- user login。
- approvals。
- streaming events。
- 比 `codex exec` 更细粒度的控制。[Codex App Server](https://developers.openai.com/codex/app-server)

传输层支持 stdio、Unix socket、WebSocket；本机 `codex app-server --help` 也核验了 `stdio://`、`unix://`、`ws://IP:PORT` 等 listen URL，以及 `daemon`、`proxy`、`generate-ts`、`generate-json-schema` 子命令。[Codex App Server](https://developers.openai.com/codex/app-server)

协议形态是 JSON-RPC 2.0 风格，但因为版本固定为 2.0，消息中省略 `jsonrpc` 字段。[Codex App Server](https://developers.openai.com/codex/app-server)

官方示例事件流包含：

```json
{ "id": 1, "method": "thread/start", "params": {} }
{ "method": "thread/started", "params": { "thread_id": "thread_123" } }
{ "method": "turn/started", "params": { "turn_id": "turn_123" } }
{ "method": "item/started", "params": { "item": { "id": "item_1" } } }
{ "method": "item/completed", "params": { "item": { "id": "item_1" } } }
{ "method": "turn/completed", "params": { "turn_id": "turn_123" } }
```

上述 method 名称来自 app-server 文档；具体 `item` subtype union 应以 `codex app-server generate-ts` 或 `generate-json-schema` 输出为准。[Codex App Server](https://developers.openai.com/codex/app-server)

### 2.5 Thread items 与事件归一化

用户提到的 `agent_message`、`command_execution`、`file_change` 等 thread item 类型，与 Codex rich-client 事件模型方向一致，但本轮已核验到的官方公开文档主要确认了 `item/started`、`item/completed`、`turn/started`、`turn/completed` 等 envelope 事件；具体 item subtype 字段未能通过官方网页完整确认，需标记为“未验证”。[Codex App Server](https://developers.openai.com/codex/app-server) / [Codex SDK README](https://github.com/openai/codex/tree/main/sdk/typescript)

架构上仍可先预留如下映射：

```ts
type CodexItemKind =
  | "agent_message"       // 未验证：具体字段以 app-server generated TS 为准
  | "command_execution"   // 未验证
  | "file_change"         // 未验证
  | "reasoning"           // 未验证
  | "approval_request";   // 未验证
```

建议实现时不要手写 Codex app-server schema，而是在安装/打包阶段固定 CLI 版本并生成 TS/schema，再由 adapter 做类型映射。[Codex App Server](https://developers.openai.com/codex/app-server)

### 2.6 会话 resume

`codex exec --help` 已核验存在 `resume` 子命令；Codex app-server 也以 thread/session 作为核心模型，适合桌面应用维护长生命周期会话。[Codex README](https://github.com/openai/codex) / [Codex App Server](https://developers.openai.com/codex/app-server)

AstraFlow 应持久化：

```ts
type CodexRuntimeSessionState = {
  provider: "codex";
  integration: "sdk" | "exec-json" | "app-server";
  codexVersion: "0.142.5";
  threadId?: string;
  lastTurnId?: string;
  cwd: string;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
};
```

### 2.7 审批模式、sandbox 与 approval policy

Codex CLI 支持 sandbox 模式；本机 `codex exec --help` 已核验 `--sandbox` 可取 `read-only`、`workspace-write`、`danger-full-access`。Codex 官方也提供 permissions 文档，描述 Codex 的 sandboxing / approval 机制。[Codex Permissions](https://developers.openai.com/codex/permissions)

对 Electron 桌面应用的建议：

- 默认使用 `read-only` 或最小可写工作区。
- 用户触发“允许修改文件”后切换到 workspace-write。
- 不应把 `danger-full-access` 暴露为默认选项。
- 所有 approval request 都走 AstraFlow 的统一 permission broker，再转给 Codex app-server / CLI 策略。

### 2.8 自定义 model provider / OpenAI-compatible endpoint

Codex 支持通过 `config.toml` 配置 model provider；官方配置文档描述了 `model_provider` / `model_providers` 机制。[Codex Config](https://developers.openai.com/codex/config)

典型配置形态：

```toml
model_provider = "openai"

[model_providers.openai]
name = "OpenAI"
base_url = "https://api.openai.com/v1"
env_key = "OPENAI_API_KEY"
wire_api = "responses"
```

OpenAI-compatible provider 的工程方向通常是新增 provider：

```toml
model_provider = "my_compat"

[model_providers.my_compat]
name = "My OpenAI Compatible Provider"
base_url = "https://example.com/v1"
env_key = "MY_COMPAT_API_KEY"
wire_api = "chat"
```

但这里有一个重要限制：Codex 对不同 provider 的支持不仅取决于 `base_url`，也取决于 `wire_api`、工具调用、流式响应、reasoning、patch/file-change 语义是否兼容；因此“能配 OpenAI-compatible endpoint”不等于“任意 OpenAI-compatible 模型都能完整支持 Codex agent 能力”。该点应在接入阶段用目标 provider 做端到端 POC。[Codex Config](https://developers.openai.com/codex/config)

### 2.9 许可与分发

`@openai/codex` 和 `@openai/codex-sdk` npm license 均已核验为 `Apache-2.0`；OpenAI Codex GitHub 仓库也标注 Apache-2.0 license。[Codex GitHub](https://github.com/openai/codex) / [Codex SDK npm](https://www.npmjs.com/package/@openai/codex-sdk)

分发方式有两种：

- 要求用户自行安装 Codex CLI：产品集成简单，但体验不完整。
- 将 `@openai/codex` / `@openai/codex-sdk` 作为 optional dependency 或内置 runtime 组件：体验更好，但需要处理平台兼容、包体积、更新、认证和本地权限隔离。[Codex README](https://github.com/openai/codex) / [Codex SDK README](https://github.com/openai/codex/tree/main/sdk/typescript)

Codex README 说明可用 ChatGPT plan 登录或 OpenAI API key 认证，因此桌面应用要区分“用户已有 ChatGPT 登录”和“用户提供 API key”的凭据路径。[Codex README](https://github.com/openai/codex)

### 2.10 对 AstraFlow 的结论

Codex 适合做外部 agent runtime，但建议优先接 `app-server` 或 ACP adapter，而不是直接依赖 `exec --json`：

- `@openai/codex-sdk` 适合 JS/TS 内嵌，但事件抽象仍偏 Codex 自身 thread/turn/item。[Codex SDK README](https://github.com/openai/codex/tree/main/sdk/typescript)
- `codex exec --json` 适合一次性任务，不适合作为 rich chat runtime 的核心协议。[Codex README](https://github.com/openai/codex)
- `codex app-server` 明确面向 rich clients，提供 session、approval、streaming events，更接近 AstraFlow 需要的 desktop runtime 接口，但当前标注 experimental，存在协议变化风险。[Codex App Server](https://developers.openai.com/codex/app-server)

---

## 3. ACP Agent Client Protocol

### 3.1 协议定位与现状

ACP，即 Agent Client Protocol，是面向 code editor / coding agent 的通信协议，目标是让编辑器和 agent 解耦；协议使用 JSON-RPC over stdio，并支持 rich interactive interfaces。[ACP 官网](https://agentclientprotocol.com/)

ACP 的核心价值不是定义 LLM tool calling，而是定义“客户端如何驱动外部 coding agent、如何接收 agent 消息、tool call、plan、状态更新”等 UI 集成层协议。[ACP 官网](https://agentclientprotocol.com/)

这和 AstraFlow 的目标高度重合：AstraFlow 已有统一消息模型和 sqlite snapshot，需要的是把多个外部 agent 的事件归一化，而 ACP 正是 agent-client 边界协议。[ACP 官网](https://agentclientprotocol.com/)

### 3.2 会话与消息模型

ACP schema 定义了 `session/new`、`session/prompt`、`session/cancel` 等 session 方法，并通过 `session/update` notification 把 agent 的运行时事件推给 client。[ACP schema](https://raw.githubusercontent.com/agentclientprotocol/agent-client-protocol/main/schema/v1/schema.json)

`session/update` 的 params 包含 `sessionId` 和 `update`；`update` 是一个 union，使用 `sessionUpdate` discriminator。常见 update 类型包括：

- `agent_message_chunk`
- `tool_call`
- `tool_call_update`
- `plan`
- 其他能力/状态更新类型

这些类型来自 ACP schema；实现时应以 schema 生成的类型为准。[ACP schema](https://raw.githubusercontent.com/agentclientprotocol/agent-client-protocol/main/schema/v1/schema.json)

示意事件：

```json
{
  "method": "session/update",
  "params": {
    "sessionId": "sess_123",
    "update": {
      "sessionUpdate": "agent_message_chunk",
      "content": {
        "type": "text",
        "text": "我会先检查项目结构。"
      }
    }
  }
}
```

Tool call 示意：

```json
{
  "method": "session/update",
  "params": {
    "sessionId": "sess_123",
    "update": {
      "sessionUpdate": "tool_call",
      "toolCallId": "tool_1",
      "title": "Read file",
      "kind": "read",
      "status": "pending"
    }
  }
}
```

Tool call update 示意：

```json
{
  "method": "session/update",
  "params": {
    "sessionId": "sess_123",
    "update": {
      "sessionUpdate": "tool_call_update",
      "toolCallId": "tool_1",
      "status": "completed"
    }
  }
}
```

Plan 示意：

```json
{
  "method": "session/update",
  "params": {
    "sessionId": "sess_123",
    "update": {
      "sessionUpdate": "plan",
      "entries": [
        { "content": "梳理 runtime 接口", "status": "completed" },
        { "content": "实现 Claude adapter", "status": "pending" }
      ]
    }
  }
}
```

字段细节必须以 ACP schema 当前版本为准；上面 JSON 是面向 AstraFlow adapter 的映射示例。[ACP schema](https://raw.githubusercontent.com/agentclientprotocol/agent-client-protocol/main/schema/v1/schema.json)

### 3.3 TypeScript SDK 包名订正

经 npm view 核验，当前存在两个相关 TS 包：

- `@agentclientprotocol/sdk`，版本 `1.1.0`，license `Apache-2.0`，仓库 `agentclientprotocol/typescript-sdk`。[npm](https://www.npmjs.com/package/@agentclientprotocol/sdk) / [GitHub](https://github.com/agentclientprotocol/typescript-sdk)
- `@zed-industries/agent-client-protocol`，版本 `0.4.5`，license `Apache-2.0`，仓库 `zed-industries/agent-client-protocol`。[npm](https://www.npmjs.com/package/@zed-industries/agent-client-protocol) / [GitHub](https://github.com/zed-industries/agent-client-protocol)

因此，若新建 AstraFlow ACP client adapter，推荐优先评估 `@agentclientprotocol/sdk`，而不是默认使用 `@zed-industries/agent-client-protocol`。后者仍可能在 Zed 生态中被使用，但包名和版本不应混淆。

### 3.4 现有 agent 适配情况

ACP 官网 agents 页面列出 Gemini CLI、Claude Code adapter、Codex adapter 等接入方向。[ACP Agents](https://agentclientprotocol.com/get-started/agents)

当前核验结果：

- Gemini CLI：`@google/gemini-cli` npm 版本 `0.49.0`，license `Apache-2.0`；ACP 官网称 Gemini CLI 有 first-class support。[ACP Agents](https://agentclientprotocol.com/get-started/agents) / [Gemini CLI GitHub](https://github.com/google-gemini/gemini-cli)
- Claude Code：存在第三方 `claude-code-acp`，版本 `0.1.1`，license `MIT`。[npm](https://www.npmjs.com/package/claude-code-acp) / [GitHub](https://github.com/carlrannaberg/cc-acp)
- Claude Agent SDK：存在 `@agentclientprotocol/claude-agent-acp`，版本 `0.55.0`，license `Apache-2.0`，描述为基于 Claude Agent SDK TS 的 ACP-compatible coding agent。[npm](https://www.npmjs.com/package/@agentclientprotocol/claude-agent-acp) / [GitHub](https://github.com/agentclientprotocol/claude-agent-acp)
- Codex：未 scoped 的 `codex-acp` npm 包未找到；当前可核验的是 `@agentclientprotocol/codex-acp` 版本 `1.1.0` 和 `@zed-industries/codex-acp` 版本 `0.16.0`，二者 license 均为 `Apache-2.0`。[npm](https://www.npmjs.com/package/@agentclientprotocol/codex-acp) / [GitHub](https://github.com/agentclientprotocol/codex-acp) / [Zed npm](https://www.npmjs.com/package/@zed-industries/codex-acp)

### 3.5 成熟度与社区活跃度评估

ACP 的优点：

- 协议目标和 AstraFlow 需求一致：client 和 coding agent 解耦。[ACP 官网](https://agentclientprotocol.com/)
- 已有 schema、TypeScript SDK 和多个 agent adapter。[ACP schema](https://raw.githubusercontent.com/agentclientprotocol/agent-client-protocol/main/schema/v1/schema.json) / [TypeScript SDK](https://github.com/agentclientprotocol/typescript-sdk)
- 事件类型天然接近 AstraFlow 的 text/tool/plan/activity 模型。[ACP schema](https://raw.githubusercontent.com/agentclientprotocol/agent-client-protocol/main/schema/v1/schema.json)

ACP 的风险：

- 协议仍处于快速演进阶段，schema 和 adapter 包名已经存在 `@zed-industries/*` 与 `@agentclientprotocol/*` 并存的情况。[npm](https://www.npmjs.com/package/@agentclientprotocol/sdk) / [npm](https://www.npmjs.com/package/@zed-industries/agent-client-protocol)
- 各 agent adapter 成熟度不一致，Codex / Claude / Gemini 的 feature parity 不能假设一致。[ACP Agents](https://agentclientprotocol.com/get-started/agents)
- 权限审批、文件修改 diff、长期 session resume 等能力需要逐 adapter 验证，不能只看协议字段。

### 3.6 ACP 是否适合作为统一外部 agent 协议

结论：ACP 是当前最适合作为 AstraFlow “外部 coding agent 接入协议”的候选，但不应成为唯一 runtime 抽象。

推荐定位：

- AstraFlow 内部定义自己的 `AgentRuntime` 接口。
- 对外部 coding agent，优先提供 `AcpRuntimeAdapter`。
- 对能力更强或商业关键的 provider，再提供 direct adapter，例如 `ClaudeAgentSdkAdapter`、`CodexAppServerAdapter`。
- ACP adapter 作为“最大公约数协议”，direct adapter 用于补齐 richer permission、resume、partial reasoning、provider-specific metadata。

### 3.7 替代方案比较

| 方案 | 定位 | 优点 | 局限 | 对 AstraFlow 建议 |
|---|---|---|---|---|
| ACP | Editor/client ↔ coding agent 协议 | JSON-RPC over stdio，session/update，tool_call，plan，已有 Claude/Codex/Gemini adapter。[ACP 官网](https://agentclientprotocol.com/) | 协议仍年轻，adapter 成熟度不一。 | 作为外部 agent 默认接入协议。 |
| AG-UI | Agent ↔ UI event protocol | 更偏前端 UI 事件、human-in-the-loop 和 agent UI 标准化。[AG-UI Docs](https://docs.ag-ui.com/) | 不专门解决 coding agent 本地文件权限、CLI 生命周期和 editor agent session。 | 可借鉴 UI event vocabulary，不建议作为 coding agent runtime 主协议。 |
| Vercel AI SDK Agents | 应用内 LLM agent 构建抽象 | `streamText`、tools、multi-step agent primitives，适合 Web app 内建 agent。[AI SDK Agents](https://ai-sdk.dev/docs/agents/overview) | 不是外部 CLI/coding agent 互操作协议。 | 可用于前端 chat 流式 UI，但不是 Claude Code/Codex/Gemini CLI 的统一协议。 |
| OpenAI Agents SDK JS | OpenAI agent orchestration SDK | 适合构建 OpenAI provider 生态内的 agent。[OpenAI Agents JS](https://openai.github.io/openai-agents-js/) | 不解决 Claude Code/Codex CLI/ACP 这种外部 coding agent 接入。 | 可作为未来 OpenAI 内建 runtime 的参考，不作为统一外部协议。 |

---

## 4. 综合对比与推荐架构

### 4.1 总体判断

AstraFlow 不应把某一个 vendor SDK 直接等同于平台 runtime。更稳妥的设计是：

```txt
AstraFlow UI / Chat Store / SQLite Snapshot
                 |
          Agent Runtime Core
                 |
    +------------+-------------+----------------+
    |                          |                |
DeepAgentsRuntime       AcpRuntimeAdapter   Direct Adapters
内置 runtime            外部 agent 默认层     Claude / Codex / future
```

理由：

- DeepAgents 是内置可控 runtime，适合与现有 LangChain/LangGraph 体系直接集成；`deepagents` npm 已核验版本 `1.10.5`，license `MIT`。[Deep Agents JS](https://github.com/langchain-ai/deepagentsjs) / [LangChain DeepAgents Docs](https://docs.langchain.com/oss/javascript/deepagents/overview)
- ACP 是外部 coding agent 的最大公约数协议，能接 Claude/Codex/Gemini adapter。[ACP 官网](https://agentclientprotocol.com/) / [ACP Agents](https://agentclientprotocol.com/get-started/agents)
- Claude Agent SDK 和 Codex app-server 都有 provider-specific 强能力，direct adapter 能拿到更完整的 permission、resume、hook、metadata。[Claude SDK TypeScript](https://docs.claude.com/en/docs/claude-code/sdk/sdk-typescript) / [Codex App Server](https://developers.openai.com/codex/app-server)

### 4.2 推荐 Runtime 接口

```ts
export type RuntimeKind =
  | "deepagents"
  | "acp"
  | "claude-agent-sdk"
  | "codex-sdk"
  | "codex-app-server";

export interface AgentRuntime {
  readonly kind: RuntimeKind;

  startSession(input: StartSessionInput): Promise<RuntimeSession>;

  resumeSession(input: ResumeSessionInput): Promise<RuntimeSession>;

  sendPrompt(
    session: RuntimeSession,
    prompt: RuntimePrompt,
    options?: RuntimeTurnOptions
  ): AsyncIterable<RuntimeEvent>;

  cancel(session: RuntimeSession, reason?: string): Promise<void>;

  dispose(session: RuntimeSession): Promise<void>;
}

export interface RuntimeSession {
  id: string;                  // AstraFlow session id
  providerSessionId?: string;  // Claude session_id / Codex thread_id / ACP sessionId
  kind: RuntimeKind;
  cwd?: string;
  capabilities: RuntimeCapabilities;
  metadata: Record<string, unknown>;
}
```

### 4.3 统一事件模型定义示例

AstraFlow 现有 text/reasoning/tool parts + activities + sqlite streaming snapshot，可以抽象为 provider-neutral `RuntimeEvent`：

```ts
export type RuntimeEvent =
  | {
      type: "message.delta";
      sessionId: string;
      messageId: string;
      partId: string;
      role: "assistant";
      part: "text" | "reasoning";
      delta: string;
      providerEvent?: unknown;
    }
  | {
      type: "message.completed";
      sessionId: string;
      messageId: string;
      providerEvent?: unknown;
    }
  | {
      type: "tool_call.started";
      sessionId: string;
      toolCallId: string;
      name: string;
      input?: unknown;
      title?: string;
      providerEvent?: unknown;
    }
  | {
      type: "tool_call.updated";
      sessionId: string;
      toolCallId: string;
      status: "pending" | "running" | "completed" | "failed" | "cancelled";
      delta?: string;
      providerEvent?: unknown;
    }
  | {
      type: "tool_result";
      sessionId: string;
      toolCallId: string;
      output?: unknown;
      error?: string;
      providerEvent?: unknown;
    }
  | {
      type: "plan.updated";
      sessionId: string;
      items: Array<{
        id?: string;
        text: string;
        status: "pending" | "in_progress" | "completed" | "failed";
      }>;
      providerEvent?: unknown;
    }
  | {
      type: "permission.requested";
      sessionId: string;
      requestId: string;
      action: string;
      description?: string;
      payload?: unknown;
      choices: Array<"allow" | "deny" | "allow_once" | "always_allow">;
      providerEvent?: unknown;
    }
  | {
      type: "permission.resolved";
      sessionId: string;
      requestId: string;
      decision: "allow" | "deny" | "allow_once" | "always_allow";
    }
  | {
      type: "activity.updated";
      sessionId: string;
      activityId: string;
      title: string;
      status: "pending" | "running" | "completed" | "failed";
      detail?: string;
      providerEvent?: unknown;
    }
  | {
      type: "session.snapshot";
      sessionId: string;
      snapshot: unknown;
      providerSessionId?: string;
    }
  | {
      type: "run.completed";
      sessionId: string;
      result?: string;
      usage?: unknown;
      costUsd?: number;
      providerEvent?: unknown;
    }
  | {
      type: "run.failed";
      sessionId: string;
      error: string;
      providerEvent?: unknown;
    }
  | {
      type: "run.cancelled";
      sessionId: string;
      reason?: string;
      providerEvent?: unknown;
    };
```

### 4.4 Provider 事件映射

| 统一事件 | Claude Agent SDK | Codex | ACP |
|---|---|---|---|
| `message.delta` | `stream_event` partial content delta 或 `assistant.message.content[].text`。[Claude SDK TypeScript](https://docs.claude.com/en/docs/claude-code/sdk/sdk-typescript) | SDK/app-server 的 item stream；具体 item subtype 需 generated schema 核验。[Codex SDK README](https://github.com/openai/codex/tree/main/sdk/typescript) / [Codex App Server](https://developers.openai.com/codex/app-server) | `session/update` + `agent_message_chunk`。[ACP schema](https://raw.githubusercontent.com/agentclientprotocol/agent-client-protocol/main/schema/v1/schema.json) |
| `tool_call.started` | `assistant.message.content[].tool_use` 或 `PreToolUse` hook。[Claude SDK TypeScript](https://docs.claude.com/en/docs/claude-code/sdk/sdk-typescript) | `item/started` / command item；具体 subtype 未验证。[Codex App Server](https://developers.openai.com/codex/app-server) | `session/update` + `tool_call`。[ACP schema](https://raw.githubusercontent.com/agentclientprotocol/agent-client-protocol/main/schema/v1/schema.json) |
| `tool_call.updated` | `stream_event`、hooks、tool lifecycle。[Claude SDK TypeScript](https://docs.claude.com/en/docs/claude-code/sdk/sdk-typescript) | `item/started` / `item/completed` / app-server approval updates。[Codex App Server](https://developers.openai.com/codex/app-server) | `tool_call_update`。[ACP schema](https://raw.githubusercontent.com/agentclientprotocol/agent-client-protocol/main/schema/v1/schema.json) |
| `tool_result` | `tool_result` content block 或 `PostToolUse` hook。[Claude SDK TypeScript](https://docs.claude.com/en/docs/claude-code/sdk/sdk-typescript) | command execution completion；具体 item fields 未验证。[Codex App Server](https://developers.openai.com/codex/app-server) | `tool_call_update` completed / output fields。[ACP schema](https://raw.githubusercontent.com/agentclientprotocol/agent-client-protocol/main/schema/v1/schema.json) |
| `plan.updated` | 可从 Claude todo/plan 相关 tool 或 hooks 派生；没有统一 plan event，需 adapter 推断。 | Codex plan item 未验证；可从 thread item 派生。 | `plan` update 是协议内建事件。[ACP schema](https://raw.githubusercontent.com/agentclientprotocol/agent-client-protocol/main/schema/v1/schema.json) |
| `permission.requested` | `canUseTool` callback。[Claude SDK TypeScript](https://docs.claude.com/en/docs/claude-code/sdk/sdk-typescript) | app-server approvals / CLI approval policy。[Codex App Server](https://developers.openai.com/codex/app-server) / [Codex Permissions](https://developers.openai.com/codex/permissions) | ACP 是否统一表达审批需按 schema/adapter 验证；基础 tool call 状态可承载部分信息。[ACP schema](https://raw.githubusercontent.com/agentclientprotocol/agent-client-protocol/main/schema/v1/schema.json) |
| `run.completed` | `SDKResultMessage`。[Claude SDK TypeScript](https://docs.claude.com/en/docs/claude-code/sdk/sdk-typescript) | `turn/completed`。[Codex App Server](https://developers.openai.com/codex/app-server) | session prompt 完成响应或 terminal update；具体按 schema。 |

### 4.5 权限审批统一流程

建议引入 `PermissionBroker`：

```ts
interface PermissionBroker {
  request(input: PermissionRequest): Promise<PermissionDecision>;
}

interface PermissionRequest {
  sessionId: string;
  runtime: RuntimeKind;
  action: string;
  title?: string;
  description?: string;
  payload?: unknown;
  riskLevel: "low" | "medium" | "high";
}

interface PermissionDecision {
  decision: "allow" | "deny" | "allow_once" | "always_allow";
  reason?: string;
}
```

映射策略：

- Claude：`canUseTool` 暂停并调用 `PermissionBroker`，用户选择后返回 SDK permission result。[Claude SDK TypeScript](https://docs.claude.com/en/docs/claude-code/sdk/sdk-typescript)
- Codex：优先使用 app-server approval 机制；CLI `exec` 模式只适合预设 approval/sandbox policy，不适合细粒度 UI 审批。[Codex App Server](https://developers.openai.com/codex/app-server) / [Codex Permissions](https://developers.openai.com/codex/permissions)
- ACP：adapter 接收到 tool call / permission-like update 后转为 `permission.requested`；具体是否能回写 allow/deny 取决于当前 ACP schema 和对应 agent adapter 支持情况，需要 POC 验证。[ACP schema](https://raw.githubusercontent.com/agentclientprotocol/agent-client-protocol/main/schema/v1/schema.json)

### 4.6 会话持久化与 sqlite snapshot 对齐

AstraFlow 已有流式 snapshot 持久化到 sqlite，应保持“标准化快照 + 原始 provider event”双轨：

```ts
type RuntimeSnapshotRecord = {
  astraSessionId: string;
  runtimeKind: RuntimeKind;
  providerSessionId?: string;
  providerVersion?: string;
  normalizedMessages: unknown;
  normalizedActivities: unknown;
  rawEventLogOffset: number;
  lastProviderEventId?: string;
  resumeToken?: string;
  updatedAt: string;
};
```

持久化原则：

1. 每个 adapter 输出 `RuntimeEvent` 后立即进入 snapshot reducer。
2. reducer 更新 text/reasoning/tool parts 和 activities。
3. 原始 provider event 以 append-only log 存储，方便未来 replay 和 bug 诊断。
4. provider session id 必须独立存储：Claude `session_id`、Codex `thread_id`、ACP `sessionId`。[Claude SDK TypeScript](https://docs.claude.com/en/docs/claude-code/sdk/sdk-typescript) / [Codex App Server](https://developers.openai.com/codex/app-server) / [ACP schema](https://raw.githubusercontent.com/agentclientprotocol/agent-client-protocol/main/schema/v1/schema.json)
5. resume 时先恢复 AstraFlow snapshot，再调用 provider resume API，并把新事件继续 append 到同一 session。

### 4.7 推荐 adapter 分层

```txt
packages/agent-runtime
  core/
    AgentRuntime.ts
    RuntimeEvent.ts
    PermissionBroker.ts
    SnapshotReducer.ts

  adapters/
    deepagents/
      DeepAgentsRuntime.ts

    acp/
      AcpRuntimeAdapter.ts
      AcpEventMapper.ts

    claude/
      ClaudeAgentSdkAdapter.ts
      ClaudeEventMapper.ts

    codex/
      CodexSdkAdapter.ts
      CodexAppServerAdapter.ts
      CodexEventMapper.ts
```

职责划分：

- `core` 不依赖 Anthropic/OpenAI/ACP SDK。
- 每个 adapter 只负责 provider-specific IO 和事件映射。
- sqlite snapshot reducer 只消费 `RuntimeEvent`，不直接认识 Claude/Codex/ACP。
- UI 只订阅统一 messages / activities / permission state。

### 4.8 分阶段实施建议

#### Phase 0：定义 runtime contract

目标：

- 定义 `AgentRuntime`、`RuntimeEvent`、`RuntimeSession`、`PermissionBroker`。
- 为现有消息模型写一个 provider-neutral reducer。
- 保留 raw provider event 字段，避免第一版丢失信息。

风险：低。主要是接口设计质量。

#### Phase 1：内置 deepagents runtime

目标：

- 将当前 LangChain `createAgent` 替换为 `deepagents` adapter。
- 保持现有 UI 消息 parts 和 sqlite snapshot 不变。
- 先只支持 text/tool/reasoning/activity 的核心路径。

依据：`deepagents` 是 LangChain Deep Agents JS 库，构建在 LangGraph 思路上，适合内置可控 runtime。[LangChain DeepAgents Docs](https://docs.langchain.com/oss/javascript/deepagents/overview) / [GitHub](https://github.com/langchain-ai/deepagentsjs)

风险：中。DeepAgents 的 event stream 与现有 createAgent stream 可能不完全一致，需要 reducer 适配。

#### Phase 2：ACP 外部 runtime

目标：

- 实现 `AcpRuntimeAdapter`。
- 先接 `@agentclientprotocol/codex-acp` 或 `@agentclientprotocol/claude-agent-acp` 做端到端 POC。
- 把 `agent_message_chunk`、`tool_call`、`tool_call_update`、`plan` 映射到统一事件。

依据：ACP 官网定义了 editor/client 与 coding agent 解耦的协议目标，schema 定义了 session/update 事件模型。[ACP 官网](https://agentclientprotocol.com/) / [ACP schema](https://raw.githubusercontent.com/agentclientprotocol/agent-client-protocol/main/schema/v1/schema.json)

风险：中高。ACP adapter 生态仍在演进，包名和 adapter 成熟度需要版本 pinning。

#### Phase 3：Claude direct adapter

目标：

- 使用 `@anthropic-ai/claude-agent-sdk` 直接接 Claude Code 能力。
- 支持 `query()` streaming、`resume`、`canUseTool`、hooks、MCP、system prompt。
- 与 ACP Claude adapter 对比能力差距。

依据：Claude SDK 官方支持 query、streaming input、session resume、permission callback、hooks、MCP。[Claude SDK TypeScript](https://docs.claude.com/en/docs/claude-code/sdk/sdk-typescript)

风险：高。主要来自商业分发、subscription login 审批、自定义 provider 限制。[Claude SDK Overview](https://docs.claude.com/en/docs/claude-code/sdk/sdk-overview)

#### Phase 4：Codex app-server direct adapter

目标：

- 用 `codex app-server` 做 rich desktop 集成。
- 通过 `generate-ts` / `generate-json-schema` 固定协议版本。
- 支持 approvals、thread resume、sandbox policy。

依据：app-server 官方定位就是 rich clients，支持 sessions、approvals、streaming events。[Codex App Server](https://developers.openai.com/codex/app-server)

风险：高。app-server 当前为 experimental，协议变化风险大。[Codex App Server](https://developers.openai.com/codex/app-server)

### 4.9 工程量与风险评估

| 方案 | 工程量 | 风险 | 主要风险点 | 建议 |
|---|---:|---:|---|---|
| DeepAgents 内置 runtime | 中 | 中 | 与现有 createAgent stream 差异、LangGraph 状态建模。 | 第一优先级，作为默认内置 runtime。 |
| ACP adapter | 中 | 中高 | 协议和 adapter 演进快，权限和 resume 能力需逐 adapter 验证。 | 第二优先级，作为外部 agent 默认入口。 |
| Claude Agent SDK direct | 中高 | 高 | Anthropic 分发/认证条款、subscription login 特批、自定义 endpoint 不确定。 | 作为高价值 premium adapter，但先做 legal/product gate。 |
| Codex SDK direct | 中 | 中 | SDK 依赖 CLI、事件抽象需要 mapping。 | 可作为 Codex app-server 前的轻量集成。 |
| Codex app-server direct | 高 | 高 | experimental 协议、审批和 schema 变动。 | 适合 POC 后进入 beta。 |
| `codex exec --json` | 低 | 中 | 只适合非交互任务，rich UI 能力不足。 | 可用于 fallback，不建议作为主 runtime。 |

### 4.10 最终推荐

推荐架构决策：

1. **AstraFlow 定义自己的统一 `AgentRuntime` 抽象，不把 Claude/Codex/ACP 任一协议暴露给 UI。**
2. **内置 runtime 使用 DeepAgents 直连**，因为这是产品可控的默认 agent，且 license 为 MIT。[DeepAgents GitHub](https://github.com/langchain-ai/deepagentsjs)
3. **外部 agent 默认走 ACP**，因为它是目前最贴近“桌面 client ↔ coding agent”的开放协议，且已有 Claude/Codex/Gemini 适配生态。[ACP 官网](https://agentclientprotocol.com/) / [ACP Agents](https://agentclientprotocol.com/get-started/agents)
4. **Claude Agent SDK 与 Codex app-server 作为 direct adapter 保留**，用于获得更强的 provider-specific 能力，例如 Claude `canUseTool` / hooks / MCP，Codex app-server approvals / thread lifecycle。[Claude SDK TypeScript](https://docs.claude.com/en/docs/claude-code/sdk/sdk-typescript) / [Codex App Server](https://developers.openai.com/codex/app-server)
5. **所有 adapter 必须输出统一 `RuntimeEvent`**，由同一个 reducer 写入现有 sqlite streaming snapshot，避免 UI 和持久化层被 provider schema 绑死。
6. **权限审批统一进入 `PermissionBroker`**，不要让 Claude/Codex/ACP adapter 直接弹窗或直接修改 workspace。
7. **provider session id 与 raw event log 必须持久化**，保证 resume、debug、迁移和 replay 能力。

---

## 5. 未验证事项清单

1. **Codex `exec --json` 的完整 JSONL event subtype union 未验证。** 已核验 `--json` 输出 JSONL 事件流，但 `agent_message`、`command_execution`、`file_change` 等具体字段未能从官方公开网页完整确认；实现前应使用固定版本 CLI 的 generated schema 或源码类型核验。[Codex README](https://github.com/openai/codex)

2. **Codex app-server item subtype 细节未完全验证。** 官方文档确认 `thread/*`、`turn/*`、`item/started`、`item/completed` 等 envelope；具体 item payload 应以 `codex app-server generate-ts` / `generate-json-schema` 输出为准。[Codex App Server](https://developers.openai.com/codex/app-server)

3. **Codex `model_providers` 对任意 OpenAI-compatible endpoint 的完整兼容性未验证。** 官方配置支持 provider 配置，但不同模型是否支持 Codex 所需工具调用、reasoning、patch/file-change 语义，需要逐 provider POC。[Codex Config](https://developers.openai.com/codex/config)

4. **Claude Agent SDK 指向任意 OpenAI-compatible 或自建端点未验证。** 官方文档明确列出 Anthropic API、Bedrock、Vertex、Azure AI Foundry等路径，但未确认任意 OpenAI-compatible endpoint 支持。[Claude SDK Overview](https://docs.claude.com/en/docs/claude-code/sdk/sdk-overview)

5. **Claude Agent SDK 商业桌面打包的最终合规结论未验证。** License 授权和 Anthropic Commercial Terms 需要 legal/vendor 确认；尤其是 bundled Claude Code binary 和 subscription login 分发。[LICENSE.md](https://raw.githubusercontent.com/anthropics/claude-agent-sdk-typescript/main/LICENSE.md) / [Claude SDK Overview](https://docs.claude.com/en/docs/claude-code/sdk/sdk-overview)

6. **ACP 权限审批回写语义需 adapter 级验证。** ACP schema 有 session/update、tool_call、tool_call_update 等事件，但不同 agent 是否支持统一 allow/deny 回写流程，需要针对 `@agentclientprotocol/codex-acp`、`@agentclientprotocol/claude-agent-acp`、Gemini CLI 分别 POC。[ACP schema](https://raw.githubusercontent.com/agentclientprotocol/agent-client-protocol/main/schema/v1/schema.json)

7. **ACP adapter 生态成熟度需持续跟踪。** 当前已存在 `@agentclientprotocol/*` 与 `@zed-industries/*` 包并存，说明生态仍在快速演进；生产接入应 pin 版本并加兼容层。[npm](https://www.npmjs.com/package/@agentclientprotocol/sdk) / [npm](https://www.npmjs.com/package/@zed-industries/agent-client-protocol)

8. **AG-UI、Vercel AI SDK Agents、OpenAI Agents SDK JS 的替代方案比较是架构层面评估，未做端到端 POC。** 它们更适合作为 UI/应用内 agent 构建参考，不是当前 AstraFlow 外部 coding agent runtime 的首选协议。[AG-UI Docs](https://docs.ag-ui.com/) / [AI SDK Agents](https://ai-sdk.dev/docs/agents/overview) / [OpenAI Agents JS](https://openai.github.io/openai-agents-js/)