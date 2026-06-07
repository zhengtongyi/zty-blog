---
title: Pi Agent Gateway 仓库复盘
description: Pixel Soul Pi Agent Gateway 的职责边界、接口适配、运行配置与面试表达复习。
---

## 一句话定位

`pixel-soul-pi-agent-gateway` 是 Pixel Soul 在本机运行的 Pi Agent HTTP/SSE 适配层，把 Cloud 或调试客户端的 HTTP 请求转换为长期驻留的 `pi --mode rpc` JSONL 调用，并把 Pi RPC 事件整理成上层能消费的流式结果。

## 仓库职责

这个仓库的主线很短：`server.py` 接 HTTP，`pi_rpc.py` 持有 `pi --mode rpc` 子进程，`events.py` 做事件映射，`profile.py` 把 profile 配置翻译成 Pi CLI 参数和运行环境。

它不负责设备音频链路，不做 ASR/TTS 编排，也不承载 Cloud WebSocket session 状态机。它的价值在于把 Pi 原生能力以稳定的网关形态暴露出来：HTTP 侧只看到 `/v1/agent/stream` 或 OpenAI-compatible `/v1/chat/completions`，Pi 侧仍然保留 skill、extension、tool 和 profile 机制。

核心调用链可以这样记：

```text
HTTP request
  -> GatewayHandler
  -> session / busy guard
  -> PiRpcClient.prompt()
  -> pi --mode rpc JSONL stdin/stdout
  -> map_rpc_event()
  -> SSE / OpenAI chat completion response
```

## OpenAI 兼容接口与 Provider 接入

仓库提供两个 POST 入口。

`POST /v1/agent/stream` 是项目内部事件流接口，请求体使用 `user_text`，返回项目自定义 SSE 事件，例如 `text_delta`、`memory_event`、`weather_event`、`done` 和 `error`。

`POST /v1/chat/completions` 模拟 OpenAI Chat Completions。它从 `messages` 中取最后一条 `role == "user"` 的内容，支持 `stream: true` 和非流式响应。流式模式会输出 `chat.completion.chunk`，最后发送 `data: [DONE]`；非流式模式会聚合 Pi 的 `text_delta`，返回 `chat.completion`。

Provider 边界要说清楚：这个仓库不是 DeepSeek/OpenAI provider client 的通用实现，而是通过 profile 生成 Pi CLI 参数，例如 `--provider deepseek`、`--model deepseek-v4-flash`、`--thinking off`。真正模型调用发生在 `pi` 进程内部或 Pi runtime/provider 侧；Gateway 只负责把 HTTP 协议、session header、SSE 格式和 Pi RPC JSONL 接起来。

## 与 Windows Gateway / Cloud 的关系

Cloud 新仓库里的 `cloud_new` 更像设备语音总编排：设备 WebSocket 连接、音频 endpoint、ASR、Pre-Agent Router、Agent client、TTS、PCM 下发都在那边。它可以通过 `OpenAIChatAgentClient` 访问一个 OpenAI-compatible agent endpoint。

Pi Agent Gateway 正好可以作为这个 endpoint：Cloud 的 Agent client 发 `/v1/chat/completions`，Gateway 转给本机 Pi Agent，再把 streaming delta 回给 Cloud。这样 Cloud 不需要理解 Pi 的 skill/extension 细节，Pi Gateway 也不需要理解设备音频、ASR、TTS 和 WebSocket 帧。

边界表达：

- Cloud / Windows gateway：管设备连接、语音链路、turn 状态、ASR/TTS provider、取消和下行音频。
- Pi Agent Gateway：管 HTTP/SSE 到 `pi --mode rpc` 的适配、profile/env 注入、Pi 事件映射、单实例并发保护。
- Pi runtime/provider：管模型调用、工具执行、skill/extension 运行和 Pi 原生上下文。

## 本地运行和配置

本地 profile 位于 `pi_agent_gateway/profiles/deepseek-dev/profile.json`，默认监听 `0.0.0.0:8787`，模型配置是 `provider=deepseek`、`model=deepseek-v4-flash`、`thinkingLevel=off`，并要求 `DEEPSEEK_API_KEY`。

启动方式：

```powershell
python -m pi_agent_gateway.server --profile pi_agent_gateway/profiles/deepseek-dev
```

可选用户私有提示词可以放在 profile 下的 `user.md`，也可以通过 `-UserFile` 指定。`profile.py` 会把 `assistant.md` 和用户文件合并成 `runtime/assistant.md`，再作为 `--system-prompt` 传给 `pi`。

profile 还会把运行环境收口到几个明确变量：`PIXEL_SOUL_PROFILE_DIR`、`PIXEL_SOUL_USER_ID`、`PIXEL_SOUL_MEMORY_DB`、`PIXEL_SOUL_AGENT_LOG_DIR`、`PIXEL_SOUL_WEATHER_CACHE_DIR`。`.env` 只补缺省值，不覆盖调用方已经注入的环境变量。

验证命令：

```powershell
python -m unittest discover -s pi_agent_gateway/tests
npm test
```

## 性能与延迟观察点

这个网关的性能观察不是看复杂算法，而是看流式链路有没有拖慢首 token 和整轮响应。

`PiRpcClient.prompt()` 会记录 `prompt_start`、中间 `event`、`prompt_done` 和 `prompt_error` 到 `agent_events.jsonl`，其中 `prompt_done` 包含 `text_length`、`delta_count` 和 `total_ms`。这些字段适合回答“为什么这里能定位延迟”：如果 Cloud 侧也记录 agent HTTP TTFB 和 total latency，就可以把延迟拆成 Cloud 到 Gateway 的 HTTP 段、Gateway 到 Pi RPC 的首 token 段、模型/工具执行段。

OpenAI-compatible 客户端侧还能观察 `agent_http_ttfb_ms`、`agent_http_total_ms`、请求/响应字节数和 endpoint host。两边结合，能判断瓶颈是在 Cloud 网络、Gateway 适配、Pi 子进程、模型 provider，还是工具执行。

## 错误收口

错误处理分三层：

- HTTP 请求非法：`/v1/agent/stream` 返回 SSE error，`/v1/chat/completions` 返回 OpenAI 风格 JSON error。
- Agent 忙：服务端用 `busy_lock` 限制同一 Pi RPC 实例同时只处理一个 prompt；OpenAI 非流式入口会返回 `429 agent_busy`。
- Pi RPC 异常：非流式 OpenAI 入口返回 `502 rpc_error`；流式响应头已发出后，只能在 SSE 中写 error 并补 `[DONE]`。

还有两个值得面试时主动说的细节：连接断开时会调用 `abort()`，并重启 Pi 进程，避免旧 stdout 事件污染下一轮 prompt；日志写入会对 `api_key`、`token`、`secret`、`authorization` 等字段做脱敏。

## 面试问答

**Q1：这个仓库解决的核心问题是什么？**  
A：它把 Pi Agent 的本地 RPC 能力包装成 HTTP/SSE 服务，让 Cloud 或调试客户端不用直接管理 `pi --mode rpc` 子进程，也不用理解 Pi 原生事件格式。

**Q2：为什么要长期持有一个 `pi --mode rpc` 子进程？**  
A：长期进程可以保留 Pi runtime 的加载结果和工具上下文，避免每个请求都重新启动 CLI。Gateway 只在进程不存在、退出或 abort 后重新拉起。

**Q3：为什么用 `busy_lock` 限制并发？**  
A：因为一个 Pi RPC stdout 是顺序事件流，多 prompt 并发容易造成事件交错和上下文污染。当前设计优先保证单实例 session 正确性，而不是追求高并发。

**Q4：OpenAI-compatible 接口到底兼容到什么程度？**  
A：它兼容 Chat Completions 的基本输入输出形态：`messages`、`model`、`stream`、流式 chunk、非流式 choice 和 `[DONE]`。但它不是完整 OpenAI API 实现，重点是给 Cloud Agent client 接入。

**Q5：session 是怎么传递的？**  
A：内部接口从 payload 的 `session_id` 取 session；OpenAI-compatible 接口优先取 `X-Pi-Agent-Session-Id`，兼容旧的 `X-Hermes-Session-Id`。session 变化时，Gateway 会调用 Pi RPC 的 `new_session` 清理 Pi 侧上下文。

**Q6：Gateway 和 Cloud runtime/provider 的边界是什么？**  
A：Gateway 只做 HTTP/SSE 与 Pi RPC 的协议适配。Cloud runtime/provider 侧负责设备 WebSocket、ASR、TTS、语音 turn 编排、provider client 和诊断字段。模型 provider 的实际调用不在 Gateway HTTP handler 里实现。

**Q7：工具事件怎么给上层？**  
A：`events.py` 只映射上层需要的事件。`message_update` 中的文本增量变成 `text_delta`；memory 工具结果变成 `memory_event`；weather 工具结果变成 `weather_event`；不认识或不需要的工具事件会被忽略。

**Q8：如何定位一次响应慢在哪里？**  
A：先看 Gateway `agent_events.jsonl` 的 `total_ms`、`delta_count` 和日志时间；再看 Cloud Agent client 的 HTTP TTFB、total、响应字节数和 endpoint host。若 TTFB 慢，多半在 Pi/model/tool 首响应；若 read/total 慢，可能是长回复或 TTS 后续链路。

**Q9：为什么流式 RPC 错误不能总是返回 HTTP 502？**  
A：流式响应一旦发送 SSE headers，HTTP status 已经是 200，后续只能在 SSE data 里写错误事件并结束流；非流式还没发 headers，所以可以返回 `502 rpc_error`。

**Q10：profile 设计的好处是什么？**  
A：profile 把 host/port、模型、API key env、tool 列表、skill/extension 路径、memory/log/weather 路径集中管理。这样换 provider、换模型、换工具集时，不需要改 server 主流程。

## 复习检查表

- 能一句话说清：HTTP/SSE Gateway -> Pi RPC adapter。
- 能画出主链路：`GatewayHandler -> PiRpcClient -> pi --mode rpc -> map_rpc_event -> SSE/OpenAI response`。
- 能区分 Gateway、Cloud voice pipeline、Pi runtime/provider 三者职责。
- 能解释 `/v1/agent/stream` 与 `/v1/chat/completions` 的差异。
- 能说出 session header：`X-Pi-Agent-Session-Id` 优先，`X-Hermes-Session-Id` 兼容。
- 能解释为什么当前单实例用 `busy_lock`，以及它牺牲了什么。
- 能说出日志里的 `total_ms`、`delta_count`、`text_length` 对排查延迟的意义。
- 能说明错误收口：invalid request、agent busy、rpc error、streaming headers 已发送后的处理差异。
- 能讲清 profile 如何生成 Pi CLI 参数和环境变量。
- 能说明断连 abort 后重启进程是为了避免旧事件污染下一轮。

## 事实来源摘要

主要事实来自只读查看 `D:\Tools\ESP-IDF\projects\worktrees\pixel-soul-pi-agent-gateway`：

- `pi_agent_gateway/server.py`：HTTP 路由、SSE 输出、OpenAI-compatible 响应、session header、busy lock 和错误返回。
- `pi_agent_gateway/pi_rpc.py`：长期 Pi RPC 子进程、JSONL 读写、abort/new_session、事件日志和密钥脱敏。
- `pi_agent_gateway/events.py`：Pi RPC 事件到 `text_delta`、`memory_event`、`weather_event` 的映射。
- `pi_agent_gateway/profile.py` 与 `profiles/deepseek-dev/profile.json`：profile 字段、Pi CLI 参数、环境变量、默认端口和 DeepSeek 配置。
- `pi_agent_gateway/tests/`：接口行为、session 切换、OpenAI 流式/非流式、错误码、日志字段和 profile 行为的验证。

辅助边界事实来自只读查看 `D:\Tools\ESP-IDF\projects\worktrees\pixel-soul-cloud-new-pi-agent-runtime`：

- `docs/architecture.md`：Cloud 侧负责设备 WebSocket、ASR -> Agent -> TTS 编排和 provider client。
- `cloud_new/clients/agent_client/client_openai_chat.py`：Cloud Agent client 以 OpenAI Chat Completions 方式请求 agent endpoint，并记录 HTTP 诊断指标。
