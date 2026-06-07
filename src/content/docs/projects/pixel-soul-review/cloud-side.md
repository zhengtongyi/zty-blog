---
title: Pixel Soul 云端侧复盘
description: 从设备 WebSocket session、ASR/Agent/TTS 链路和面试表达角度复盘 Pixel Soul Cloud。
---

## 一句话定位

Pixel Soul Cloud 是 ESP32-S3 设备和外部 AI provider 之间的语音 gateway，负责把设备持续上传的 PCM 收成一个可对话的 AI session，再把 Agent 文本和可播放 PCM 稳定下发给设备。

## 云端整体职责

云端不是单纯的“模型调用脚本”，而是设备会话的后半段 owner。它的核心职责可以拆成四层：

```text
WebSocket transport
  -> Gateway session_start 校验
  -> DeviceSession 会话与 turn 编排
  -> ASR / Agent / TTS provider client
  -> output_text + binary PCM 下发
```

这套分层的关键点是：设备只看 `ai-session-ws/1` 协议，provider 的真实接口、模型路径、token、内部 `agent_session_key` 都留在 Cloud 内部。这样设备侧可以稳定围绕 `session_start_ack`、`turn_new`、`output_text`、binary PCM、`turn_done`、`session_close` 做状态机，不需要跟着 ASR、Agent、TTS provider 的接口变化一起改。

面试时可以这样讲：我把云端设计成协议边界和 provider 边界之间的适配层。对设备暴露的是少量稳定事件；对内部 provider 保留替换空间；中间由 `DeviceSession` 负责把连续音频、turn 生命周期、打断、超时和错误收口统一起来。

## 设备 WebSocket Session

当前唯一对外协议是 `ai-session-ws/1`。连接建立后，第一帧必须是 `session_start`，里面声明 `protocol_version`、`client_id`、输入媒体能力和输出媒体能力。`Gateway` 只处理这个首帧：校验成功才创建 `DeviceSession`，校验失败就发 `error` 和 `session_close(reason="protocol_error")` 后关闭连接。

`Gateway` 的边界很窄：它不理解 ASR，不处理 turn，不直接跑 Agent/TTS。它只负责“这个连接能不能成为一个合法 session”，以及同一个 `client_id` 新连接到来时替换旧连接。这样做的好处是首帧错误、连接替换、session 创建失败都在入口处收口，不会污染后面的业务状态机。

`DeviceSession` 才是单连接 owner。它维护 active session、连续上行音频窗口、当前 output turn、idle timer、hard-mute、回声过滤和下行帧。session active 之后，binary WebSocket frame 就是输入音频；JSON frame 只接受当前协议允许的控制消息，例如 `wake_start`、`turn_terminate`、`session_close`。

典型主链路：

```text
session_start
  -> session_start_ack
  -> binary input audio...
  -> 300ms input audio gap
  -> ASR final
  -> turn_new
  -> output_text
  -> binary output PCM
  -> turn_done
```

## ASR / Agent / TTS 链路

上行音频进入 `DeviceSession` 后，Cloud 按 session 协商的媒体配置解释 PCM。当前主路径仍是设备侧 VAD 决定一句话何时停止上传，Cloud 在约 300ms 没有新 PCM 后调用 ASR finish，拿到 final transcript。也就是说，设备对 Cloud 是“流式上传”，但 ASR provider 可以是 one-shot，也可以是 streaming，这是 Cloud 内部选择。

ASR final 之后不会立刻无条件进入 Agent。系统会先做控制意图和噪声类过滤：无 final、空 transcript、噪声 transcript、可忽略 ASR error 都不会产生 `turn_new/turn_done`，只重置输入状态并保持 session active。有效文本成功排队进入 voice job 后，Cloud 才分配 `turn_id` 并下发 `turn_new`。这个设计让 `turn_new` 成为强边界：设备看到 `turn_new`，才认为这一轮输出真的开始。

`VoicePipeline` 负责 ASR final 后面的文本与语音生成。Agent client 支持 streaming delta；pipeline 把 delta 按自然停顿和长度切成短句，当前默认大约 `10~25` 字一个 TTS 单元。每个短句用非流式 `TtsClient.synthesize()` 生成完整音频，再归一化成设备协商的 PCM，下发为独立 binary frame。

这里最容易被问到的是：为什么 Agent 流式、TTS 却不走 provider 级流式？答案是权衡首段延迟、稳定性和设备协议复杂度。Agent 流式能让文本尽早切句并提前提交 TTS；TTS 保持短句 one-shot，可以避免 provider 内部分片、metadata 配对、云端 200ms 聚合这些细节泄漏给设备。设备只需要连续播放 binary PCM，播放 jitter buffer 由设备侧处理。

## `turn_terminate`

`turn_terminate` 是 KEY 硬打断的云端协议入口。设备单击按键时应先本地停播，再向 Cloud 发送：

```json
{
  "type": "turn_terminate",
  "session_id": "sess_xxx",
  "turn_id": "turn_xxx",
  "reason": "key_click"
}
```

Cloud 命中当前 active turn 后返回 `turn_terminate_ack(accepted=true)`，取消 voice job，丢弃迟到输出，清理 output context 和 hard-mute，并保持 session active。它不创建新 turn，不触发 Agent/TTS，不发送 `turn_done`，也不关闭 session。

这个设计的面试表达重点是：打断是控制面事件，不是语音识别文本。用 KEY 打断可以绕开播放期回声和语音 `stop_output` 误识别问题；ACK 主要用于诊断和测试闭环，设备体验上不应该等 ACK 才停本地播放。

## 延迟与流式取舍

这套链路的延迟优化不是简单地“所有东西都 streaming”，而是把 streaming 用在收益最大的地方：

- 设备到 Cloud：持续上传 binary PCM，避免一整句录完再上传。
- ASR：外部协议不绑定 provider 模式；默认可用 one-shot ASR，资源足够时可切 streaming ASR 实验。
- Agent：使用 streaming delta，尽早得到可切句文本。
- TTS：短句 one-shot，减少 provider 级流式音频的不确定性。
- 下行：`output_text` 先于该句 PCM 下发，音频用独立 binary frame，不再发 `audio_chunk` metadata。

同时，Cloud 做了两个和体验直接相关的保护：输出首次下发后的约 1.5 秒 hard-mute 会丢弃上行 PCM，避免设备播放回声触发自打断；1.5 秒后再通过短文本、语气词和 LCS overlap guard 过滤疑似回声。这样系统既能避免自己听见自己，又保留后续用户真正插话的可能性。

## 错误收口

错误设计的主线是：协议错误按连接收口，资源忙按 session 可重试收口，provider 内部细节不外泄。

pre-session 阶段由 `Gateway` 收口。第一帧不是合法 `session_start`、协议版本不支持、`client_id` 非法、媒体配置不支持，都会返回公开错误码，然后 `session_close(reason="protocol_error")` 并关闭 WebSocket。

post-session 阶段由 `DeviceSession` 收口。active 后旧协议消息会触发 `unsupported_message_type` 和 `session_close(reason="protocol_error")`。`session_close` 必须携带当前 active `session_id` 才生效；缺失、空字符串或不匹配时只返回 `session_id_mismatch`，保持 session active。

provider busy 会映射为 `server_busy`，并且是 `retryable=true`、`scope=session`，默认不关闭 session。session 创建失败只下发固定公开消息 `session create failed`，真实异常、真实 endpoint、token、cookie、堆栈只允许进入内部日志。

## 测试与观测

云端测试按边界拆得比较清楚：

- `cloud_new/tests/app/test_ai_session_protocol.py` 覆盖 `ai-session-ws/1` 的主路径、非法首帧、旧协议拒绝、`wake_start`、binary audio、`turn_terminate`、session close、idle timeout、hard-mute、echo guard、`server_busy` 等。
- `cloud_new/tests/pipeline/test_voice_pipeline.py` 覆盖 Agent streaming delta、短句切分、TTS 合成、取消和错误映射。
- `cloud_new/tests/asr_client`、`tts_client`、`agent_client` 覆盖 provider client 的配置、核心行为和 smoke。
- `cloud_new/tests/audio` 覆盖 input enhancer、endpoint detector、normalizer、streaming resampler 等音频工具。
- real smoke 默认跳过，需要显式环境变量启用，主链路是 `session_start -> session_start_ack -> binary audio -> turn_new -> output_text -> binary PCM -> turn_done -> session_close`。

观测上，代码会记录 session、turn、chunk_index、耗时、PCM 长度、provider latency 等信息。面试时可以强调：协议测试保障设备可见行为，provider smoke 验证真实模型链路，日志指标则帮助定位“慢在 ASR、Agent、TTS、归一化还是 WebSocket 下发”。

## 面试问答

**Q1：Pixel Soul Cloud 一句话是什么？**

A：它是设备和 AI provider 之间的 WebSocket 语音 gateway。设备只上传 PCM、接收文本和 PCM；Cloud 负责 session、ASR、Agent、TTS、打断、超时和错误收口。

**Q2：为什么 `Gateway` 只处理 `session_start`？**

A：因为首帧校验是连接能否进入业务态的边界。把它放在 `Gateway`，可以让协议版本、`client_id`、媒体能力、连接替换和创建失败集中收口；后面的 `DeviceSession` 就只处理已经 active 的 session。

**Q3：`DeviceSession` 的 owner 职责是什么？**

A：它是单 WebSocket 连接内的 session owner，管理 active session、上行音频窗口、当前 output turn、idle timeout、hard-mute、回声过滤、`turn_terminate` 和下行 frame。

**Q4：为什么 `turn_new` 是强边界？**

A：因为只有 ASR final 有效、通过过滤、并且 voice job 成功建立后才发 `turn_new`。设备看到 `turn_new` 才认为一轮输出开始；空识别、噪声、可忽略 ASR error 都不产生 turn。

**Q5：设备持续上传 PCM，但 ASR 为什么还能默认非流式？**

A：外部协议和 provider 模式解耦。设备侧流式上传降低传输等待，Cloud 可以在 300ms gap 后一次性调用 one-shot ASR；资源允许时也能切 streaming ASR，而不改变设备协议。

**Q6：为什么 Agent streaming，TTS 却用短句 one-shot？**

A：Agent streaming 的收益是尽早拿到文本并切句；TTS 短句 one-shot 的收益是稳定、音质和协议简单。这样设备只接收 `output_text` 和 binary PCM，不需要理解 provider 的音频切片。

**Q7：`turn_terminate` 和语音“停止”有什么区别？**

A：`turn_terminate` 是 KEY 控制面事件，命中 active turn 后取消输出并保持 session active；语音“停止”需要先经过 ASR，播放期容易被回声和误识别影响，所以当前硬打断由 KEY 负责。

**Q8：`server_busy` 为什么不关闭 session？**

A：busy 多数是资源队列或 provider 暂时不可用，不代表协议错误。它被设计成 `retryable=true`、`scope=session`，设备可以继续保持 session，等待下一次输入或重试策略。

**Q9：active 后 `session_close` 缺少 `session_id` 为什么不直接关？**

A：active session 之后 `session_id` 是防误关边界。缺失或不匹配只返回 `session_id_mismatch` 并保持 session active，避免旧消息或错误控制帧误杀当前连接。

**Q10：这套系统如何避免设备播放音频又被自己识别？**

A：输出首次下发后有 hard-mute 窗口，短时间内丢弃上行 PCM；窗口后通过短文本、语气词和 LCS overlap guard 过滤疑似回声。真正的硬打断走 KEY `turn_terminate`。

**Q11：测试重点覆盖哪些业务风险？**

A：重点覆盖协议兼容边界、主链路、空识别、噪声、busy、timeout、打断、迟到输出、回声过滤和 provider client 配置。这样能证明设备可见行为稳定，而不是只测某个 helper。

**Q12：如果面试官问“慢在哪里怎么查”？**

A：按链路拆：上行 PCM 到 ASR final、Agent first delta、TTS synthesize、audio normalize、binary 下发。日志里有 session、turn、chunk_index、elapsed 和 provider latency，可以定位是模型慢、队列满、归一化慢还是协议下发慢。

## 复习检查表

- 能否一句话说清 Cloud 是“设备协议和 AI provider 之间的 gateway”？
- 能否画出 `session_start -> ASR -> Agent -> TTS -> PCM` 主链路？
- 能否说明 `Gateway`、`DeviceSession`、`VoicePipeline` 的边界？
- 能否解释为什么外部协议只保留 `ai-session-ws/1`？
- 能否解释为什么 `turn_new` 是设备侧强边界？
- 能否说明 `turn_terminate` 为什么不发送 `turn_done`、不关闭 session？
- 能否讲清 Agent streaming 和 TTS one-shot 的取舍？
- 能否说明 300ms input gap、45s idle timeout、1.5s hard-mute 各自解决什么问题？
- 能否说清 `server_busy`、`protocol_error`、`session_id_mismatch` 的不同收口方式？
- 能否用测试文件说明哪些场景已经被自动化覆盖？

## 事实来源摘要

本文根据云端仓库资料整理，重点阅读了：

- `README.md`：项目定位、设备 WebSocket gateway、`ASR -> Agent -> TTS -> PCM` 主链路。
- `docs/architecture.md`：`Gateway`、`DeviceSession`、`VoicePipeline` 的边界和运行主线。
- `docs/protocol.md`：`ai-session-ws/1`、`turn_terminate`、错误码、idle timeout、hard-mute 和 echo guard。
- `docs/providers.md`：ASR、Agent、TTS provider 的配置、流式/非流式取舍和 busy 映射。
- `cloud_new/app/gateway.py`、`device_session.py`、`pipeline/voice_pipeline.py`：session 创建、turn 编排、打断、输出和错误收口。
- `cloud_new/clients/*`：ASR、Agent、TTS client 的 provider 边界。
- `cloud_new/tests/`：协议、pipeline、provider client、音频工具和 smoke 场景覆盖。
