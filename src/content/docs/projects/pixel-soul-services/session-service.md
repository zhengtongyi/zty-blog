---
title: Session：AI 会话状态机
description: 复习 Pixel Soul 设备侧 Session 如何维护 session、turn、上下行授权和播放状态。
---

## 一句话定位

`Session` 是设备侧 AI Session owner。它维护云端协议里的 `session_id / turn_id`，决定本地处于 `IDLE / LISTENING / THINKING / SPEAKING / ERROR` 哪个阶段，并控制上行发布、下行播放和本地打断的收口时机。

它不逐帧处理 PCM，不做 ASR，不做 TTS，不直接操作 UI。

## 基础原理

AI 语音会话不是简单的“连上 WebSocket 后一直收发音频”。设备侧必须回答几个问题：

- 当前有没有 active session？
- 当前音频输入是否允许上传？
- 云端回来的文本和音频属于哪个 turn？
- `turn_done` 到达时，本地音频是否已经播放完？
- 用户按 KEY 打断时，是终止当前 turn，还是关闭整个 session？

这些问题都属于会话上下文，不属于 SR、WebSocket 或 Player。SR 只负责听和发布 PCM；WebSocket 只负责传输；Player 只负责播放。Session 把它们编排在一起。

## 主流程

```text
BOOT long press
  -> App 显示 wake prompt
  -> SR WakeNet hit
  -> session_start()
  -> WebSocket connect
  -> send session_start
  -> recv session_start_ack
  -> send wake_start
  -> LISTENING
```

对话 turn：

```text
turn_new(text non-empty)
  -> active_turn_id = turn_id
  -> input_text = ASR text
  -> THINKING

output_text(current turn)
  -> output_text = assistant text
  -> close voice input
  -> SPEAKING

turn_done(current turn)
  -> mark output_pending_done
  -> wait local playback drained
  -> LISTENING
```

本地打断：

```text
KEY while SPEAKING
  -> session_terminate_turn("key_click")
  -> clear local downlink PCM
  -> close audio publish and clear queued uplink PCM
  -> active_turn_id = invalid
  -> state = LISTENING
  -> send turn_terminate
```

## 为什么这样设计

`Session` 必须集中管理上下文，因为上下行是异步的：

- 云端 `output_text` 可能比本地播放快。
- `turn_done` 只表示云端输出结束，不代表设备播放完成。
- KEY 打断后，旧 turn 的迟到 `output_text / binary PCM / turn_done` 可能继续到达。
- 上行音频发布必须避开 wake greeting、TTS 播放和错误收口阶段。

如果这些判断分散在 SR、WebSocketTask、TTSPlayer 和 App 中，状态会变成多处重复判断。当前设计把业务判断集中到 Session，底层模块只执行明确动作。

## 当前项目实现

Public API 入口在 `components/service/include/session.h`：

```c
esp_err_t session_start(const session_config_t *config);
esp_err_t session_stop(void);
esp_err_t session_stop_with_reason(const char *reason);
esp_err_t session_handle_voice_activity_start(void);
esp_err_t session_handle_voice_activity_end(void);
esp_err_t session_set_output_ducking(bool enabled);
esp_err_t session_terminate_turn(const char *reason);
esp_err_t session_poll_output_state(void);
esp_err_t session_handle_websocket_rx(const session_ws_rx_item_t *item);
session_snapshot_t session_get_snapshot(void);
```

`session_snapshot_t` 是 App/UI 观察 Session 的主要出口。关键字段包括：

```text
state
session_active
voice_input_open
audio_publish_enabled
output_context_active
output_playback_active
output_pending_done
output_backlog_ms
session_id
active_turn_id
input_text
output_text
```

模块组合关系：

```text
Session
  -> Protocol: build/parse JSON
  -> WebSocketTask: text/binary IO
  -> TTSPlayer: downlink PCM playback
  -> SR adapter: audio_publish gate and voice prefix
```

## 关键边界/踩坑

- `IDLE` 表示没有 active session；不是错误态。
- `wake_start` 到 wake greeting 完成前，`voice_input_open=false`，不上传用户输入。
- `turn_new` 是强边界，新 turn 替换旧 turn 时要清旧下行上下文。
- `turn_done` 不直接回 `LISTENING`，必须等本地播放 drained。
- `SPEAKING` 期间主打断路径是 KEY 触发 `turn_terminate`，不是依赖自动 VAD 打断。
- `turn_terminate_ack` 不驱动本地停播；本地 UX 已经先停了。

## 面试问答

**问：为什么 Session 是 owner？**  
因为只有 Session 同时知道协议上下文、本地播放状态、上行授权和 turn 边界。SR、WebSocket、Player 分别只知道局部事实。

**问：`LISTENING` 和 `IDLE` 有什么区别？**  
`IDLE` 没有 active session；`LISTENING` 表示 session 已建立，设备在等待用户输入或等待下一轮输入。

**问：为什么 `turn_done` 不直接让 UI 回 LISTENING？**  
云端发送比设备播放快，`turn_done` 到达时本地 `audio_rx_ringbuf` 和播放器可能还在播。UI 状态要跟本地播放体验同步。

**问：KEY 打断为什么要发 `turn_terminate`？**  
本地先停播保证用户体感，协议再通知云端取消当前 turn，避免云端继续产生旧输出。

**问：旧 turn 迟到消息怎么处理？**  
依赖 `active_turn_id` 不匹配直接忽略；只有新的 `turn_new` 才重新打开下行上下文。

**问：Session 为什么不逐帧处理 PCM？**  
逐帧 PCM 是 SR、WebSocketTask 和 TTSPlayer 的执行细节。Session 只决定开关、清理和状态转换，避免业务层被音频细节拖乱。

## 复习检查表

- 能否画出 `session_start -> wake_start -> LISTENING`？
- 能否解释 `voice_input_open` 和 `audio_publish_enabled` 的区别？
- 能否解释 `turn_new / output_text / turn_done` 分别改变什么？
- 能否说清 KEY 打断和 BOOT 长按退出的差别？
- 能否解释为什么旧 turn 下行不能复活输出？
