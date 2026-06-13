---
title: 10 下行 Opus 速率协商：paced sender 验证
description: 记录设备侧接入 output_media_config.send_rate_multiplier 后，Cloudflare WSS 双向 Opus 链路的实机 smoke 结果，以及对下行队列、解码和播放水位的分析。
---

第 9 章的结论是：双向 Opus 协议已经打通，但真实长回复阶段下行 Opus packet 会以 burst 方式进入设备，最终把 `AudioOpusDecoder` packet queue 打满。

这一章验证的是一个更窄的问题：

> 云端按设备协商的速率 pacing 下发 Opus packet，能否解决下行队列溢出，并让真实 `ASR -> Agent -> TTS -> Opus downlink -> TTSPlayer` 链路跑完？

本轮不重新设计协议，不引入 `downlink_rr`，也不调整 decoder timeout、RX ringbuf 或 TTSPlayer 水位。目标是先控制变量，验证云端 paced sender 是否有效。

## 本轮改动

### 1. 协议增加下行速率协商字段

`session_start.output_media_config` 在下行使用 Opus 时新增：

```json
{
  "format": "opus",
  "sample_rate": 16000,
  "channels": 1,
  "send_rate_multiplier": 1.2
}
```

含义：

- `send_rate_multiplier` 是云端下行发送速率倍率；
- `1.0` 表示按音频实时长度发送；
- `1.2` 表示约以 `1.2x` 实时速率发送；
- 它不是设备播放倍率，不改变采样率，也不直接改变 TTSPlayer 水位。

设备侧增加编译配置：

```text
CONFIG_AI_DOWNLINK_OPUS_SEND_RATE_MULTIPLIER_X100=120
```

用整数百分比表达倍率，避免浮点配置在 Kconfig 里变复杂。当前允许范围是 `50..200`，也就是 `0.5x..2.0x`。

### 2. 设备校验 `session_start_ack`

设备在收到 `session_start_ack` 后校验云端回显：

```text
SESSION_MEDIA_ACK input=opus output=opus send_rate_x100=120
```

下行 Opus 模式下，以下情况都视为媒体配置不匹配：

- `send_rate_multiplier` 缺失；
- 类型不是 number，例如字符串、bool；
- 超出 `0.5..2.0`；
- 与设备请求值不一致。

PCM 下行不发送也不要求该字段，避免影响原有 PCM 路径。

### 3. 云端改成 packet 级 paced sender

云端仍然让 `VoicePipeline` 处理 PCM：

```text
Agent text
-> TTS PCM
-> Opus encode
-> packet queue
-> paced sender
-> WebSocket binary
```

关键变化是：`send_chunk` 不再把一个 TTS chunk 的所有 Opus packet 连续写进 WebSocket，而是先放入 turn 级发送队列，由 sender task 按预算下发。

当前策略：

- `100ms` tick 累计发送预算；
- 默认 `send_rate_multiplier=1.2`，约每 `100ms` 发送 `120ms` 音频；
- 每个 packet 之间保留约 `10ms` micro gap；
- `turn_done` 等当前 turn 队列 drain 后再发送；
- 新 turn、打断、关闭时清理旧 turn packet。

这个策略的目的不是追求最低首响，而是先避免真实长回复把设备端 decoder queue 一次性打满。

## 测试条件

| 项目 | 配置 |
|---|---|
| 设备 | ESP32-S3，COM6 |
| 路径 | Cloudflare WSS |
| URI | `wss://pixel-soul.gpt0417.space` |
| 上行 | `pcm_s16le/16k/mono -> Opus 20ms/20kbps/CBR` |
| 下行 | `TTS PCM -> Opus -> 设备解码 PCM -> TTSPlayer` |
| Agent | `pi-agent` |
| TTSPlayer 水位 | `600/320ms` |
| decoder submit timeout | `20ms`，本轮不改 |
| RX ringbuf | `32KB`，本轮不改 |
| smoke 场景 | `TEST_SESSION_CLOUD_SMOKE_SCENARIO=5` |

证据目录：

```text
D:\Tools\ESP-IDF\projects\worktrees\test\session_cloud_10_opus_paced_1p2_20260612_184716
```

关键文件：

```text
serial_cloud_smoke_120s.log
key_events_serial.txt
key_events_gateway.txt
metrics_serial_extract.txt
summary.md
verdict.json
```

## 测试结果

本轮自动化 smoke 结果：

```text
TEST_SESSION_CLOUD_SMOKE: PASS total=1 failed=0
```

协议协商成功：

```text
SESSION_MEDIA_ACK input=opus output=opus send_rate_x100=120
```

设备侧下行 Opus 关键指标：

| 指标 | 结果 |
|---|---:|
| `OPUS_DEC_QUEUE depth_packets_max` | 93 |
| `OPUS_DEC_QUEUE drops_max` | 0 |
| `OPUS_DEC_QUEUE output_drops_max` | 0 |
| `decoded_pcm_bytes_max` | 450560 |
| `decode_ms_p95_max` | 2ms |
| `WS_RX_AUDIO sink_bytes_max` | 30113 |
| `WS_RX_AUDIO frames_max` | 711 |

TTSPlayer 汇总：

```text
TTS_PLAYER_SUMMARY
read_count=460
write_count=460
read_bytes=469760
written_bytes=469760
underrun=2
rebuffer=1
short_write=0
read_timeout=2
start_buffer_ms=600
resume_buffer_ms=320
max_backlog_ms=1024
max_write_ms=45
```

上行 Opus 汇总：

```text
WS_TX_SUMMARY
sent_bytes=10700
sent_frames=214
send_call_count=214
send_call_avg_ms=2
send_call_max_ms=4
tx_ringbuf_depth_ms_max=0
```

## 和第 9 章失败现象的对比

第 9 章失败点：

```text
OPUS_DEC_QUEUE depth_packets=256 drops=1
WS_RX_AUDIO sink_failed err=ESP_ERR_NO_MEM
```

本轮结果：

```text
OPUS_DEC_QUEUE depth_packets_max=93
drops=0
output_drops=0
```

这说明 paced sender 的方向是有效的。它没有改变设备侧解码能力，也没有扩大队列，而是把云端突发下发削成了设备可以持续消化的节奏。

## 为什么 `1.2x` 比固定 burst 更合理

下行 Opus 的字节量很小，但 packet 数量不小。以当前 `20ms/packet` 估算：

```text
1s 音频 = 50 packet
10s 音频 = 500 packet
```

如果云端把一个 TTS chunk 编完后立刻连续发送，设备端看到的是：

```text
短时间大量 packet
-> WebSocketTask 快速 submit
-> AudioOpusDecoder packet queue 积压
-> queue 满后 sink_failed
```

但设备播放是按真实音频时间消耗 PCM 的。即使 Opus 解码很快，TTSPlayer 也不能无限快地消耗 PCM，否则就不是正常播放。

因此这里真正需要匹配的不是“网络能不能一瞬间塞进去”，而是：

```text
云端下发速率
<= 设备解码 + PCM ringbuf + TTSPlayer 长期可承受速率
```

`1.2x` 的含义是：比实时播放稍快，能建立一点缓冲；但又不至于像 burst 那样把 decoder queue 和 PCM ringbuf 瞬间填满。

## 对 `underrun=2 / rebuffer=1` 的解释

本轮自动化 PASS，但日志里仍有：

```text
underrun=2
rebuffer=1
```

从时间线看，它们主要出现在 turn 结束和两轮之间的尾部收口阶段，而不是下行 Opus 正在持续到达时的队列溢出。

所以本轮不能简单把它判成“播放中断续”。更准确的结论是：

- 下行 Opus queue 溢出已被解决；
- TTSPlayer 没有 `short_write`；
- 但播放层仍缺少更细的 underrun 分类；
- 后续应区分：
  - `streaming_underrun`：播放中断流，影响听感；
  - `end_of_stream_underrun`：尾部无数据后的正常收口；
  - `turn_gap_rebuffer`：两轮之间等待新音频。

这也是后续优化 TTSPlayer 观测口径的重点。

## 当前结论

本轮结论是：

```text
PASS-AUTO-HITL-PENDING
```

含义：

1. `input=opus / output=opus / send_rate_multiplier=1.2` 协议协商通过。
2. Cloudflare WSS 双向 Opus 链路自动化 smoke 通过。
3. 第 9 章的下行 decoder queue 溢出没有复现。
4. Opus 解码耗时很低，`decode_ms_p95=2ms`，不是当前瓶颈。
5. 设备播放链路完成，`short_write=0`，最终回到 `LISTENING/IDLE`。
6. 还需要人工听感确认，判断是否存在可感知的播放断续。

## 下一步

如果人工听感正常，下一步可以把双向 Opus 作为真实会话联调默认链路，继续验证：

- 多轮连续对话；
- 用户打断；
- 更长 TTS 回复；
- 弱网下 `send_rate_multiplier=1.0/1.1/1.2` 对比。

如果人工听感仍有断续，优先不再调 Opus decoder queue，而是转向：

1. 区分播放中 underrun 和尾部 underrun；
2. 给 TTSPlayer 增加更精确的 backlog 时间线；
3. 测 `600/320ms`、`800/500ms`、`1000/600ms` 在真实 TTS 下的听感差异；
4. 再决定是否需要下行 RR 或动态 pacing。

这轮最重要的收获是：问题已经从“协议能不能打通、队列会不会溢出”，收敛到“真实播放听感和播放层水位策略是否足够稳”。
