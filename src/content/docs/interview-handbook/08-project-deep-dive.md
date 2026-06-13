---
title: 简历项目综合追问：模块边界、TDD/SDD/DDD、问题定位
description: 围绕简历项目如何讲清独立开发、模块边界、设计文档、测试驱动和问题定位整理面试回答。
---

## 这篇对应简历里的哪句话

```text
完成从语音采集、音频编码、网络传输、云端交互、下行播放到 UI 状态显示的完整嵌入式功能闭环。
独立完成多个设备侧核心模块开发，包括音频模块、网络通信模块、UI 显示模块、SD 卡资源管理和运行时内存优化。
```

## 面试官为什么会问

项目综合追问不是问单点知识，而是判断你是否真的能独立负责模块：需求拆解、接口设计、状态机、任务模型、异常处理、测试验证和问题定位。

## 高频问题

### Q1：哪些模块是你独立开发的？

**短答：**

我会按模块回答：音频采集与播放、WebSocket 通信、协议状态、UI 状态展示、SD 卡资源管理和 PSRAM 内存优化。

**展开回答：**

不要说“我参与了整个项目”，而是说清边界：

```text
音频模块: PCM 采集、I2S 播放、缓冲、Opus 编解码
网络模块: Wi-Fi 状态、WebSocket 收发、断线重连
协议模块: JSON 控制消息、binary 音频数据
UI/资源: LVGL、SD 卡图片、PSRAM 缓冲
```

**结合我的项目：**

我的项目虽然有语音交互业务，但我重点负责的是设备侧嵌入式能力模块，而不是单纯上层 AI 逻辑。

**继续追问：**

如果被问“怎么证明独立”，就讲需求、接口、任务拆分、日志指标、测试和实机问题定位。

### Q2：怎么证明你不是只做 demo？

**短答：**

看是否处理了生命周期、错误恢复、资源限制、实机测试和问题定位。

**展开回答：**

demo 通常只证明功能能跑；工程模块要考虑：

```text
启动/停止/重连/打断
队列满/网络断/资源缺失
日志和指标
内存和栈
构建和分区
实机 smoke
```

**结合我的项目：**

我处理过 WebSocket 断线、Opus 编解码栈占用、下行播放断续、SD 卡资源外置和 app 分区超限等问题。

**继续追问：**

如果一个项目没有异常处理和验证证据，面试官容易认为只是拼 demo。

### Q3：如果设计一个 WebSocket 音频传输模块，你怎么写 SDD？

**短答：**

先写目标、非目标、接口、数据流、任务模型、状态机、错误处理和测试方案。

**展开回答：**

SDD 可以包含：

```text
目标: 双向 JSON + binary 音频传输
非目标: 不理解业务语义、不做编解码
接口: send_json/send_audio/read_event
数据流: queue + ringbuf
状态: disconnected/connecting/connected/closing
错误: timeout/close/protocol error
测试: 断线、重连、队列满、弱网、长时间运行
```

**结合我的项目：**

我的 WebSocket 模块边界是：收发 frame 和搬运数据，不维护 ASR/TTS 状态。Session 才是业务状态 owner。

**继续追问：**

如果 WebSocketTask 里开始判断“是否正在播放”“是否应该结束 ASR”，说明模块边界被污染。

### Q4：TDD 在嵌入式里怎么用？

**短答：**

不是所有硬件代码都适合完整 TDD，但协议解析、状态机、队列边界、参数校验和纯逻辑模块适合先写测试。

**展开回答：**

适合 TDD 的部分：

```text
协议 JSON parser/builder
状态机流转
ringbuf 边界
DBC 解析
配置校验
音频 packet 重组
```

不适合完全 TDD 的部分：

```text
真实 I2S 时序
Wi-Fi RF 问题
硬件电平
扬声器听感
```

**结合我的项目：**

比如 `session_start`、`output_text`、`input_audio_end` 这类协议消息，可以用 host test 覆盖合法和非法字段；实机链路再用 smoke 验证。

**继续追问：**

TDD 的重点不是形式，而是把可验证行为提前写清楚。

### Q5：DDD 对嵌入式模块边界有什么帮助？

**短答：**

DDD 的价值是统一领域语言和模块边界，避免底层模块混入上层业务语义。

**展开回答：**

嵌入式里也有领域概念：

```text
connection
session
audio packet
PCM frame
playback buffer
underrun
turn
device state
```

这些词要在代码和文档里保持一致。

**结合我的项目：**

WebSocketTask 只理解 text/binary frame，Protocol 理解 JSON 格式，Session 理解会话状态，Player 理解 PCM 播放。每层语言不同，不能混用。

**继续追问：**

DDD 不等于复杂架构；对小项目也可以体现为命名清晰、职责清楚。

### Q6：音频播放断续如何分层定位？

**短答：**

从数据源、网络、解码、PCM buffer、播放器、I2S 逐层定位。

**展开回答：**

```text
server 是否连续发送
WebSocket 是否连续接收
Opus packet 是否丢
decode 是否失败或耗时过长
PCM ringbuf 是否欠载
Player 是否 rebuffer/underrun
I2S write 是否 short_write
```

**结合我的项目：**

我通过串口日志和 gateway 日志对齐，判断是 Cloudflare 链路、下行队列、解码、播放水位还是 I2S 写入问题。

**继续追问：**

如果只凭听感判断，不记录队列深度和错误计数，很难定位。

### Q7：网络不稳定如何定位？

**短答：**

按 Wi-Fi、IP、DNS、TCP、TLS、WebSocket、业务协议、音频数据流分层定位。

**展开回答：**

关键日志：

```text
Wi-Fi disconnect reason
got IP
TCP connect
TLS handshake
WebSocket close/error
read/write timeout
session error
server received bytes
```

**结合我的项目：**

我会同时看设备串口和 gateway 日志，看断开前是否出现发送阻塞、读超时、服务端 close、协议错误或音频队列满。

**继续追问：**

不要只说“网络不好”，要说明是哪一层不好。

### Q8：任务栈溢出如何定位？

**短答：**

看 panic 回溯、任务名、stack high-water mark、局部大数组和第三方库调用路径。

**展开回答：**

处理步骤：

```text
确认崩溃 task
打开 stack overflow check
打印 high-water mark
检查大局部变量
把大 buffer 移到 heap/PSRAM
必要时拆独立 worker task
```

**结合我的项目：**

Opus 编码库内部可能消耗较多栈，所以更稳的方式是从 SR 同步路径拆到独立 worker task。

**继续追问：**

不能只无限加大栈，要看是否设计上把重活放错了任务。

### Q9：面试时如何把项目讲成嵌入式通信/音频模块，而不是泛泛 AI 项目？

**短答：**

把 AI 放成上层业务背景，重点讲设备侧模块：RTOS、外设、音频、网络、缓冲、资源优化。

**展开回答：**

推荐表达：

```text
这个项目上层接了语音服务，但我重点负责设备侧嵌入式能力：
音频采集、I2S 播放、WebSocket 双向传输、Opus 编解码、FreeRTOS 任务拆分、SD 卡资源外置和 PSRAM 内存优化。
```

**结合我的项目：**

这样能匹配嵌入式、IoT、音频、通信岗位，而不是把自己讲成云端 AI 开发。

**继续追问：**

如果面试官对 AI 感兴趣，再补充 ASR/TTS 协议；如果岗位偏嵌入式，就不要主动展开 Agent。

### Q10：如果重做这个项目，你会怎么优化？

**短答：**

会先把模块 SDD、测试 seam、日志指标和实机 smoke 流程前置，再做功能扩展。

**展开回答：**

优化方向：

```text
WebSocket 模块先明确 text/binary 边界
音频链路先定义 PCM/Opus packet 边界
每个模块暴露统计指标
协议解析先做 host test
实机 smoke 自动保存日志
资源占用持续监控
```

**结合我的项目：**

项目后期很多问题来自链路复杂后才补指标。下一次我会更早定义可观测性和验收标准。

**继续追问：**

这类回答能体现复盘能力，不要说“没有什么可优化”。

## 易错回答

- 把整个项目讲成 AI，忽略嵌入式核心模块。
- 说“我都做了”，但讲不清模块边界。
- 只讲功能，不讲异常处理和验证。
- TDD/SDD/DDD 只背定义，不结合嵌入式例子。
- 问问题定位时直接给结论，不讲分层证据。

## 最后 30 秒总结

```text
我会把项目定位成嵌入式实时音频通信终端，而不是单纯 AI 应用。我的核心能力是把音频、网络、UI、资源和 RTOS 任务拆成清晰模块，通过 queue/ringbuf 和协议边界连接起来，并用日志、指标和实机测试定位问题。这样能证明我不是只做 demo，而是具备独立模块开发和工程收口能力。
```

