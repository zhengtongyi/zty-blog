---
title: Protocol 与 WebSocketTask：协议和传输边界
description: 复习 Pixel Soul 设备侧如何把 JSON 控制消息和 PCM 音频帧分离处理。
---

## 一句话定位

`Protocol` 负责 AI Session JSON 消息的构建、解析和校验；`WebSocketTask` 负责 WebSocket text/binary frame 的收发和搬运。

二者都不维护 AI 业务状态。业务状态由 `Session` 管。

## 基础原理

WebSocket 同时承载两类数据：

```text
text frame   -> JSON control message
binary frame -> PCM audio
```

这两类数据的处理方式不同：

- JSON 体积小，需要解析、校验字段和驱动状态机。
- PCM 体积大，不应该挤进 JSON queue，也不应该被协议模块解析。

所以项目把协议和传输拆开：

```text
Protocol: JSON format
WebSocketTask: frame IO pump
Session: business owner
```

## 主流程

```text
Session
  -> protocol_build_session_start()
  -> websocket_task_send_json()
  -> WebSocket text frame
  -> cloud
```

接收 JSON：

```text
cloud text frame
  -> WebSocketTask
  -> rx_queue
  -> Session
  -> protocol_parse_text()
  -> state transition
```

音频不经过 `Protocol`：

```text
SRService -> audio_tx_ringbuf -> WebSocketTask -> binary input PCM
cloud -> binary output PCM -> WebSocketTask -> audio_rx_ringbuf -> TTSPlayer
```

## 为什么这样设计

如果 WebSocketTask 解析 JSON，它就会理解 `session_start_ack / turn_new / turn_done` 等业务语义，传输层会变胖。

如果 Protocol 处理 WebSocket，它就会理解 queue、ringbuf、连接状态和 transport 错误，协议层会变胖。

当前拆法保持三个边界：

- `Protocol` 只管消息格式。
- `WebSocketTask` 只管连接和 frame 搬运。
- `Session` 只管业务语义和上下文。

这让测试也更清楚：Protocol 可以做纯函数构建/解析测试；WebSocketTask 可以做 IO pump 和 frame 分发测试；Session 可以做状态机测试。

## 当前项目实现

`Protocol` 支持构建设备上行消息：

```text
session_start
wake_start
session_close
turn_terminate
error
```

支持解析云端下行消息：

```text
session_start_ack
turn_new
output_text
turn_done
turn_terminate_ack
session_close
error
```

固定音频格式：

```text
format: pcm_s16le
sample_rate: 16000
channels: 1
bits_per_sample: 16
```

`WebSocketTask` 对外有两组通道：

```text
JSON/control:
  tx_queue -> WebSocketTask -> cloud
  cloud -> WebSocketTask -> rx_queue

binary audio:
  audio_tx_ringbuf -> WebSocketTask -> cloud
  cloud -> WebSocketTask -> audio_rx_ringbuf
```

主循环保持两态：

```text
WS_STATE_DISCONNECTED:
  wait notify
  connect

WS_STATE_CONNECTED:
  tx_queue_get
  audio_tx_ringbuf_get
  recv_once
```

## 关键边界/踩坑

- `WebSocketTask` 不提供业务 audio gate；是否产生上行 PCM 由 SR/Session 控制。
- `WebSocketTask` 不 reset ringbuf；清理时机由 owner 决定。
- binary audio 不进入 rx_queue/tx_queue，避免大块音频堵塞控制消息。
- recv timeout 不是错误，只表示当前没有 frame。
- `turn_terminate_ack` 表示云端接收了终止请求，不表示 provider 已完全退出。
- 设备不生成业务 `turn_id`，只保存云端分配的当前 active turn。

## 面试问答

**问：Protocol 为什么不直接发 WebSocket？**  
因为 Protocol 是格式层。发送、连接、queue、ringbuf 都是传输层细节，放进去会破坏模块边界。

**问：WebSocketTask 为什么不解析 JSON？**  
它只负责 frame IO pump。解析 JSON 会让它理解 AI session 状态，导致传输层承担业务职责。

**问：为什么 JSON 和 PCM 分通道？**  
JSON 是控制消息，适合 queue；PCM 是大块连续数据，适合 ringbuf。混在一起会造成阻塞和复杂背压。

**问：`turn_terminate` 属于哪个模块处理？**  
Protocol 构建 JSON，WebSocketTask 发送 text frame，Session 决定何时调用并处理本地状态。

**问：WebSocketTask 连接断开后会自动重连吗？**  
当前不会。它回到 DISCONNECTED，等待外部再次 notify connect。

## 复习检查表

- 能否解释 text frame 和 binary frame 的区别？
- 能否画出 JSON/control queue 和 audio ringbuf 两条路径？
- 能否说明为什么 WebSocketTask 不 reset ringbuf？
- 能否说明 `Protocol` 和 `Session` 的区别？
- 能否解释 recv timeout 为什么不是错误？
