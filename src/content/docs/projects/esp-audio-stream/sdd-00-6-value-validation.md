---
title: SDD-00.6：价值验证实验设计
description: 定义 Direct WebSocket baseline、候选策略层和进入 SDD-01 前必须验证的弱网场景。
---

# SDD-00.6：价值验证实验设计

阶段状态：进入 SDD-01 前的验证门槛  
目标：证明 `esp-audio-stream` 不是低价值封装

---

## 1. 验证原则

本项目不能靠“架构看起来合理”证明价值。

必须通过可复现实验回答：

> 在相同 ESP32 硬件、相同音频源、相同网络故障、相同服务端条件下，策略层方案是否比直接发包 / 直接收包方案更可控、更可观测、更容易恢复？

如果不能证明，则项目应缩小为薄封装，甚至停止继续扩大。

---

## 2. 对比对象

### Baseline A：Direct WebSocket Uplink

```text
Audio Frame → Direct WebSocket Send
```

### Baseline B：Direct WebSocket Downlink

```text
WebSocket Receive → Audio Frame → Decoder / Player
```

### Candidate：esp-audio-stream

```text
Audio Capture / Encoder ↔ esp-audio-stream ↔ WebSocket Backend ↔ Server
Audio Decoder / Player  ↔ esp-audio-stream ↔ WebSocket Backend ↔ Server
```

Candidate 特点：

- 有界发送队列。
- 有界接收 / 播放队列。
- 音频帧生命周期。
- 过期帧丢弃。
- 播放缓冲下溢 / 溢出统计。
- 连接状态机。
- 重连策略。
- 传输统计。
- 错误分类。
- 可观测指标。

---

## 3. 测试环境约束

两组实现必须使用相同条件：

- 相同 ESP32 设备，优先 ESP32-S3。
- 相同 ESP-IDF 版本。
- 相同 Wi-Fi 环境。
- 相同音频源。
- 相同下行音频源。
- 相同采样率。
- 相同帧大小。
- 相同编码格式。
- 相同 WebSocket 服务端。
- 相同故障注入逻辑。
- 相同运行时长。
- 相同指标采集方式。

---

## 4. 核心测试场景

### 场景 1：服务端慢消费，上行压力

服务端只以正常音频码率的 50% 消费上行数据。

观察：

- Baseline 是否出现上行延迟持续增长。
- Baseline 是否出现发送阻塞。
- Candidate 是否限制发送队列最大时长。
- Candidate 是否丢弃过期上行帧。
- Candidate 是否统计 dropped_tx_expired / dropped_tx_queue_full。

期望证明：

```text
Candidate 可以牺牲部分旧上行帧，换取实时性和内存上界。
```

---

### 场景 2：客户端慢播放，下行压力

设备播放端消费速度低于下行音频到达速度，或模拟播放器短时阻塞。

观察：

- Baseline 是否出现下行队列持续增长。
- Candidate 是否限制播放队列最大时长。
- Candidate 是否按策略丢弃 / 截断 / 重新同步下行音频。
- Candidate 是否统计 dropped_rx_expired / play_queue_overflow。

期望证明：

```text
Candidate 可以控制下行播放延迟，避免旧音频无限堆积。
```

---

### 场景 3：Wi-Fi 断开 5 秒后恢复

观察：

- Baseline 是否自动恢复。
- Candidate 状态机是否进入 reconnecting。
- Candidate 是否在网络恢复后继续处理新音频流。
- Candidate 是否避免发送或播放过期音频。
- 重连耗时。
- 重连次数统计。

期望证明：

```text
Candidate 的断线恢复行为更清晰、更可诊断。
```

---

### 场景 4：发送阻塞 / 接收阻塞 / 播放阻塞

模拟 socket send 阻塞、server 不读、client 播放阻塞、backend 超时。

观察：

- 音频采集任务是否被阻塞。
- 网络接收任务是否被播放任务阻塞。
- 队列是否持续增长。
- 任务栈和 heap 是否安全。
- Candidate 是否能输出 send_failed / recv_failed / play_underflow / backend_error。

期望证明：

```text
Candidate 能隔离采集、发送、接收和播放任务，避免单点阻塞拖垮整条音频流。
```

---

### 场景 5：新下行响应打断旧音频

用于语音交互场景：设备正在播放旧 TTS，下发新的高优先级响应或 interrupt 控制消息。

观察：

- Baseline 是否继续播放旧音频。
- Candidate 是否支持清空旧播放队列。
- Candidate 是否记录 interrupted / flushed frames。
- Candidate 是否能快速播放新响应。

期望证明：

```text
Candidate 支持交互式音频流中的打断和重新同步。
```

---

### 场景 6：长稳测试

连续运行至少 24 小时。

建议注入：

- 每 10 分钟服务端断开一次。
- 每 30 分钟 Wi-Fi 断开 5 秒。
- 随机慢消费。
- 随机播放阻塞。
- 随机发送 / 接收超时。

观察：

- heap 是否持续下降。
- task stack watermark 是否安全。
- 状态机是否能恢复。
- 收发队列是否异常增长。
- 播放队列是否异常增长。
- 是否出现不可恢复状态。

---

## 5. 必须采集的指标

至少采集：

```text
connection_state
stream_direction_state
reconnect_count
sent_frames
received_frames
failed_send_count
failed_recv_count
dropped_tx_frames
dropped_rx_frames
dropped_tx_expired
dropped_rx_expired
dropped_tx_queue_full
dropped_rx_queue_full
tx_queue_frames
tx_queue_bytes
tx_queue_duration_ms
rx_queue_frames
rx_queue_bytes
rx_queue_duration_ms
play_queue_duration_ms
play_underflow_count
play_overflow_count
average_tx_frame_age_ms
max_tx_frame_age_ms
average_rx_frame_age_ms
max_rx_frame_age_ms
backend_error_code
heap_free
heap_minimum_free
task_stack_high_watermark
```

---

## 6. 第一阶段成功标准

Candidate 必须至少证明：

- 服务端慢消费时，发送队列不会无限增长。
- 客户端慢播放时，接收 / 播放队列不会无限增长。
- 队列缓存时长可以限制在配置阈值内。
- 过期音频帧会被主动丢弃或重新同步。
- 丢帧原因可统计。
- 播放下溢 / 溢出可统计。
- Wi-Fi 断开恢复后可以自动恢复收发。
- 恢复后默认不发送或播放过期实时音频。
- 音频采集任务不会被网络发送长期阻塞。
- 网络接收任务不会被播放任务长期阻塞。
- 错误可以分类。
- 传输状态可以查询。
- 24 小时运行无明显内存泄漏。
- 额外 RAM / CPU 开销可接受。
- 上层接口不依赖 WebSocket 实现细节。

---

## 7. 输出物

价值验证阶段应输出：

```text
examples/direct_websocket_uplink_baseline/
examples/direct_websocket_downlink_baseline/
examples/websocket_policy_layer_stream/
tools/fault_server/
tools/slow_consumer_server/
tools/slow_player_simulator/
docs/value_validation.md
docs/metrics.md
```

最终应形成一份报告：

```text
docs/value_validation_report.md
```

---

## 8. 00.6 结论

`esp-audio-stream` 的复杂度必须由实测结果证明。

本阶段的目标不是实现完整产品，而是验证一个关键判断：

> 实时音频流是否需要一个独立策略层，还是直接 WebSocket / WebRTC 收发已经足够？

只有通过这个验证，本项目才应继续进入 SDD-01。
