---
title: 08 Opus 降码率验证：协议原理、取舍与实机基线
description: 解释 Opus 在当前音频链路中的协议语义、优劣势，并记录上行吞吐匹配、下行接收解码和播放链路补测结果。
---

前面几章已经把问题收敛到一个更明确的判断：

> 在 Cloudflare 路径上继续传裸 PCM，即使把 WebSocket binary frame 从 `1024B` 聚合到 `4096B`，也只能缓解每帧固定开销，不能从根上解决上行码率过高导致的持续背压。

所以这一章先验证一个更直接的方向：**把上行输入音频从裸 PCM 降码率为 Opus，看 SRService 生产速率与 WebSocket 发送吞吐量是否能匹配。**

本章先讨论上行音频输入，再补充一次下行接收、解码和播放的最小验证；仍然不把它等同于完整 ASR / Agent / TTS 业务链路。

```text
SRService real capture / AFE output
-> AudioOpusEncoder
-> audio_tx_ringbuf
-> WebSocketTask
-> metrics-only server
```

## 为什么先看 Opus

裸 PCM 的数据量很直接：

```text
16 kHz * 16 bit * mono = 256 kbps = 32 KB/s = 31.25 KiB/s
```

在第 6 章的 Cloudflare WSS 测试里，`4096B` 聚合后的发送中位吞吐大约是 `110.9 kbps`，只能覆盖约一半的 PCM 生产速率。也就是说，继续优化 WebSocket frame 大小，只是在降低单位 KB 的发送成本；如果公网路径持续可用吞吐本来就达不到裸 PCM 需求，ringbuf 迟早会积压。

Opus 的作用不是让 WebSocket 变“可靠”，也不是替代 TCP。它解决的是另一个更底层的问题：

> 把源数据率从约 `256 kbps` 降到约 `20 kbps`，让上行音频需求落到当前链路能稳定承受的范围内。

这比继续调 `send_timeout`、ringbuf 或 frame 聚合更本质。

第 7 章已经明确：`poll_write` 等待的是本机 socket/TCP/TLS 发送路径变为可写。压缩数据并不会改变 `poll_write` 的判断逻辑，但会减少每秒写入 send buffer 和 TCP 发送窗口的字节数，让前序数据的 ACK / drain 更容易追上生产速度。因此它有机会把 `esp_transport_write()` 从“持续等窗口释放”变成“大多数时候立即可写”。

## Opus 的基本原理

Opus 是 IETF 标准化的交互式音频编码格式，规范定义在 [RFC 6716](https://www.rfc-editor.org/rfc/rfc6716)。它面向实时语音、会议、游戏语音和低延迟音频传输，官方说明中列出的能力包括：

- 支持从低码率语音到高质量音乐的宽范围码率。
- 支持 `8 kHz` 到 `48 kHz` 采样率。
- 支持 `2.5 ms` 到 `60 ms` 的 frame size。
- 支持 CBR / VBR。
- 支持语音和音乐场景。
- 支持 PLC、FEC、DTX 等实时音频常用能力。

内部可以简单理解为两类编码能力的组合：

| 层 | 更适合 | 作用 |
|---|---|---|
| SILK / LP | 语音 | 利用语音信号的预测特征，在低码率下保持可懂度。 |
| CELT / MDCT | 音乐、瞬态、宽带音频 | 利用频域编码保持更高带宽和更低延迟的音频质量。 |

对当前项目来说，不需要一开始就使用 Opus 的所有能力。v1 只用最保守的语音上行配置：

| 参数 | 当前取值 |
|---|---:|
| 输入 PCM | `pcm_s16le / 16 kHz / mono / 16 bit` |
| Opus frame | `20 ms` |
| 目标码率 | `20 kbps` |
| 应用模式 | `VOIP` |
| complexity | `0` |
| CBR / VBR | `CBR` |
| FEC | off |
| DTX | off |

`20 ms` 的 16k/16bit/mono PCM 大小是：

```text
16000 samples/s * 0.02 s * 2 bytes = 640 B
```

按 `20 kbps` CBR 编码后，一个 `20 ms` Opus packet 大约是：

```text
20000 bit/s * 0.02 s / 8 = 50 B
```

也就是把每个 `640B` PCM frame 压到约 `50B`，压缩比约 `12.8:1`。这正好对应本轮实测中的 `50B` WebSocket binary frame。

## 当前协议语义

这里要区分两件事：

- Opus 本身是音频编码格式。
- Pixel Soul 的 WebSocket 音频协议规定了 Opus packet 怎么放到链路里传。

当前 v1 的协议语义是：

```text
session_start.input_media_config.format = "opus"
session_start.output_media_config.format = "pcm_s16le"

每个 WebSocket binary frame = 一个完整 raw Opus packet
```

不使用 Ogg 容器，不加长度前缀，也不引入 RTP/WebRTC。packet 边界直接由 WebSocket binary frame 边界承载。

```text
设备侧:
PCM 20ms
-> opus_encode()
-> raw Opus packet
-> WebSocket binary frame

云端:
WebSocket binary frame
-> raw Opus packet
-> libopus decode
-> PCM 16k/mono
-> 后续 enhancer / endpoint / ASR
```

这样做的好处是最小改动：

- `SRService` 仍然以 PCM / AFE 输出为本地处理基础。
- `WebSocketTask` 仍然只负责发送 binary frame，不需要理解语音编码。
- `Session` 只通过 `input_media_config.format` 告诉云端上行格式。
- 云端在进入 ASR 之前把 Opus 解码回 PCM，后续 pipeline 不必大改。

但它也有明确边界：

- 当前没有序列号、时间戳、jitter buffer。
- 当前没有 RTP/RTCP 风格的 loss / jitter 统计。
- 当前没有 FEC、DTX、自适应码率。
- 如果未来要做乱序检测、补包、迟到包丢弃，需要在 Opus packet 外再加应用层 frame header，或者切换到 RTP/WebRTC 类协议。

## 为什么不是直接上 RTP / WebRTC

当前问题的主线不是“缺一个复杂实时媒体协议”，而是“上行 PCM 数据率超过当前公网路径稳定承载能力”。所以 v1 没有直接引入 RTP / WebRTC，原因是：

| 方案 | 优点 | 当前代价 |
|---|---|---|
| WebSocket + raw Opus packet | 改动小，保留现有 JSON 控制协议，易于 metrics-only 验证。 | 缺少 RTP/RTCP 的时间戳、序列号、jitter/loss 语义。 |
| RTP / RTCP | 天然适合实时音频统计，支持 sequence、timestamp、SR/RR。 | 需要新增会话协商、端口/NAT/防火墙处理、服务端接入和调试链路。 |
| WebRTC | 媒体能力完整，包含拥塞控制、抖动缓冲、NAT 穿透等。 | 接入复杂度高，ESP32 侧资源和移植成本都高，不适合当前最小验证。 |

所以当前选择是：**先用 WebSocket + Opus 验证降码率是否能解决吞吐匹配问题。** 如果后续目标升级为弱网实时媒体质量，再讨论 RTP/WebRTC 或应用层 frame header。

## 优势

### 1. 直接降低源数据率

这是本轮最核心的收益。裸 PCM 理论码率约 `256 kbps`，当前 Opus 配置约 `20 kbps`。即使算上 WebSocket / TLS / TCP 开销，上行压力也明显降低。

### 2. 保留当前端云协议主干

当前设备和云端已经有：

```text
session_start / wake_start / binary audio / audio_sr / audio_rr / turn_done
```

Opus 方案只改变 binary audio 的内容，不改变 JSON 控制面。这样更容易做 A/B 对照，不会把“编码收益”和“协议重构收益”混在一起。

### 3. 与实时语音场景匹配

Opus 原本就是为实时交互音频设计的。官方能力覆盖语音、会议、游戏语音等场景；20ms frame 也是语音链路里常见的低延迟取舍。

### 4. 组件成熟

设备侧使用乐鑫官方 `esp_audio_codec` 的 Opus encoder。该组件明确支持 OPUS 编码，包含 `16 kHz`、mono、16bit、20kbps 起的 CBR、VoIP mode、complexity、FEC、DTX、VBR 等配置项。

云端使用系统 `libopus` 解码 raw Opus packet，解码后仍进入现有 PCM pipeline。

## 劣势和风险

### 1. 引入编码 CPU、栈和内存成本

本轮为了保持设备侧数据流简单，采用同步编码接口：

```text
SRService -> audio_opus_encoder_encode_pcm() -> ringbuf
```

这样没有新 task，改动小，但实测暴露出一个明显问题：`sr_detect` 栈需要临时提高到 `32768B` 才稳定跑通。这个结果不能直接当作最终生产设计。

后续需要评估：

- 是否继续同步 encode；
- 是否把 encode 放到一个极简 worker，避免污染 `sr_detect` 栈和实时性；
- 是否用宏编译控制 Opus 相关模块，避免默认全量编译。

### 2. 有损编码可能影响 ASR

Opus 20kbps 对人耳语音通常够用，但 ASR 对某些音素、噪声、远场语音、低音量输入可能更敏感。当前本章只验证吞吐匹配，还不能证明 ASR 准确率不下降。

后续必须补：

```text
同一测试音频
PCM 上行识别结果
vs
Opus 上行解码后识别结果
```

再比较 ASR final 文本、置信度、首响延迟和失败率。

### 3. packet 边界变成协议约束

PCM 裸流可以任意切片，Opus 不行。当前规定：

```text
一个 WebSocket binary frame 必须是一个完整 raw Opus packet
```

如果未来中间层做聚合、拆分、重传，必须保持 packet 边界，或者显式增加长度字段。否则云端解码会失败。

### 4. 没有解决所有可靠性问题

Opus 降码率解决的是“链路承载压力”，不是完整可靠传输。它不能自动解决：

- 乱序；
- 迟到包；
- 应用层 RTT 趋势；
- 服务端慢处理；
- 打断后的旧包清理；
- VAD 结束后尾包收口。

这些仍然需要 `audio_sr/audio_rr`、应用层状态机和后续测试来约束。

## 本轮实机 smoke 范围

本轮测试刻意不跑完整链路，只看生产速率和 WebSocket 吞吐是否匹配：

```text
SRService real capture/production
-> AudioOpusEncoder sync encode
-> audio_tx_ringbuf
-> WebSocketTask
-> metrics-only matrix_server
-> audio_sr/audio_rr / server_events
```

不包含：

- ASR；
- Agent；
- TTS；
- 下行播放；
- 完整会话闭环。

证据目录：

```text
D:\Tools\ESP-IDF\projects\worktrees\pixel-soul-cloud-new-asr-streaming\cloud_new\tests\record\opus_sr_ws_baseline_20260611_174500
```

关键文件：

```text
device_serial_reset_capture.log
server_events.jsonl
verdict.json
summary.md
```

## 实测结果

最终 run：

| 字段 | 值 |
|---|---:|
| `session_id` | `2462f1951a8e4ac9acba4658750de1a8` |
| `case_id` | `opus_sr_ws_baseline_50` |
| `codec` | `opus` |
| WebSocket binary frame | `50B` raw Opus packet |
| `actual_duration_ms` | `15018` |
| device result | `TEST_AUDIO_LINK_BASELINE PASS` |

核心指标：

| Metric | Value |
|---|---:|
| `source_pcm_bytes` | `372736` |
| `source_pcm wall rate` | `24.24 KiB/s` |
| `source audio seconds by bytes` | `11.648 s` |
| `encoded_bytes` | `29100` |
| `encoded_frames` | `582` |
| `encoded bitrate by source-audio time` | `19.99 kbps` |
| `sent_bytes` | `29100` |
| `server_binary_bytes_received` | `29100` |
| `server_binary_frames_received` | `582` |
| `sent / encoded` | `1.0` |
| `server / sent` | `1.0` |
| `dropped_bytes / drop_count` | `0 / 0` |
| `tx_ringbuf_depth_ms final / max` | `0 / 17` |
| `encode_ms_p95` | `5 ms` |
| `ws_send_call_ms avg / p95 / max` | `4 / 5 / 244 ms` |
| `first_binary_delay_ms` | `2681 ms` |
| server frame sizes | `{"50": 582}` |

## 结果解读

### 1. WebSocket 吞吐已经能跟上 Opus 生产

最关键的三项完全对齐：

```text
encoded_bytes = 29100
sent_bytes = 29100
server_binary_bytes_received = 29100
```

并且：

```text
dropped_bytes = 0
drop_count = 0
tx_ringbuf_depth_ms_max = 17
```

这说明在本轮 `20kbps Opus` 上行配置下，设备侧 WebSocket 发送与 metrics-only server 接收都能跟上编码后的生产速率。链路没有持续积压，也没有丢弃。

### 2. `ws_send_call_ms` 尾部偶发，但不形成持续背压

本轮 `ws_send_call_ms`：

```text
avg = 4 ms
p95 = 5 ms
max = 244 ms
```

`max=244ms` 说明 Cloudflare 路径上仍然存在偶发发送尾延迟。但和 PCM 测试不同的是，Opus 每帧只有 `50B`，平均上行码率低很多。即使偶发一次阻塞，ringbuf 也没有持续积压。

所以这里的结论不是“Cloudflare 路径变快了”，而是：

> 降码率后，链路所需吞吐大幅下降，当前路径的偶发背压不再足以压垮音频发送队列。

### 3. `first_binary_delay_ms` 不是持续吞吐指标

本轮 `first_binary_delay_ms = 2681ms`，它主要覆盖 session ready、wake/input 打开、SR 首帧输出、编码和首个 binary 到达 server 的组合路径。它不能直接当作每帧发送耗时。

后续如果要优化首包，需要单独拆：

```text
input_start -> first_pcm
first_pcm -> first_opus_packet
first_opus_packet -> first_ws_send
first_ws_send -> first_server_binary
```

### 4. 当前 SRService 生产速率低于理论值，需要单独定位

本轮 `source_pcm wall rate` 约 `24.24 KiB/s`，低于理论 `31.25 KiB/s`。

当前证据不支持把它归因为 WebSocket 阻塞：

- `tx_ringbuf_depth_ms_max = 17`，没有积压；
- `dropped_bytes = 0`，没有因为发送慢导致写入失败；
- `ws_send_call_ms p95 = 5ms`，没有持续长尾；
- `SRService -> ringbuf` 写入是非阻塞，空间不足会直接 drop。

更可疑的是 SR 自身节奏：

- AFE feed chunk 为 `1024 samples`，16kHz 下约 `64ms` 音频；
- 当前 `sr_feed_task` 和 `sr_detect_task` 每轮都有 `SR_SERVICE_TASK_YIELD_MS = 10ms`；
- 同步 Opus encode 放在 `sr_detect` 路径里，会增加每轮处理时间；
- 日志、调度、AFE fetch 也会产生额外开销。

这需要后续做独立三组对照：

```text
SR_SERVICE_TASK_YIELD_MS = 10ms / 1ms / 0ms
Opus on / off
```

目标是区分：

- SR/AFE fetch loop pacing；
- 同步编码耗时；
- WebSocket 发送背压；
- 测量口径差异。

## 和 PCM 4096B 基线的对比

第 6 章的 Cloudflare WSS `4096B` PCM 聚合测试中：

```text
sent/produced 中位数约 50.4%
sent 中位数约 110.9 kbps
send P95 约 316 ms
最大积压中位数约 1920 ms
总丢弃约 436224 B
```

本轮 Opus：

```text
encoded bitrate ~= 20 kbps
sent/encoded = 100%
server/sent = 100%
tx_ringbuf_depth_ms_max = 17 ms
dropped_bytes = 0
```

这说明：

| 方案 | 主要问题 | 当前结果 |
|---|---|---|
| PCM + 4096B 聚合 | 源数据率仍高，Cloudflare 路径持续背压 | 改善明显，但仍跟不上实时生产 |
| Opus 20kbps | 增加编码成本，但源数据率大幅降低 | 本轮 metrics-only 吞吐匹配 |

所以从工程优先级看，**降码率是比继续扩大 PCM frame 更有效的方向**。

## 下行 Opus 补测

上行 Opus smoke 通过之后，还需要回答另一个问题：

> 如果云端下行也发送 Opus，设备侧能否稳定接收、解码并交给播放链路？

这次补测仍然是测试专用链路，不代表正式 session 协议已经切换为下行 Opus。它只用来区分三个瓶颈：

```text
Cloudflare WSS 下行吞吐
-> 设备 Opus 解码
-> TTSPlayer / I2S 播放
```

### 测试条件

统一条件：

| 项目 | 配置 |
|---|---|
| 路径 | Cloudflare WSS |
| 时长 | `15s * 3` |
| 设备 | ESP32-S3 / COM6 / 同一 Wi-Fi |
| 服务端 | metrics-only downlink server |
| 业务链路 | 不启用 ASR / Agent / TTS provider |

三组 case：

| Case | 服务端发送 | 设备侧处理 |
|---|---|---|
| PCM drain-only | `640B / 20ms` PCM，约 `32KB/s` | 只接收并 drain |
| Opus decode drain | `50B / 20ms` valid Opus packet，约 `20kbps` | 解码为 PCM 后 drain |
| Opus decode player | `50B / 20ms` valid Opus packet | 解码为 PCM 后交给 TTSPlayer 播放 |

这里有一个重要边界：测试中 Opus 使用固定 `50B` CBR packet，并用 WebSocket binary frame 边界承载 packet 边界。当前生产下行 PCM ringbuf 是字节流，如果未来正式接入下行 Opus，还需要单独设计“保留 packet 边界”的队列或 frame header。

### 结果汇总

| Case | 轮次 | 发送 | 接收 | 接收率 | 解码 PCM | 结果 |
|---|---:|---:|---:|---:|---:|---|
| PCM drain-only | 1 | `480640B` | `327680B` | `68.2%` | N/A | FAIL |
| PCM drain-only | 2 | `480640B` | `324480B` | `67.5%` | N/A | FAIL |
| PCM drain-only | 3 | `480640B` | `300160B` | `62.5%` | N/A | FAIL |
| Opus decode drain | 1 | `37550B` | `37550B` | `100%` | `480640B` | PASS |
| Opus decode drain | 2 | `37550B` | `37550B` | `100%` | `480640B` | PASS |
| Opus decode drain | 3 | `37550B` | `37550B` | `100%` | `480640B` | PASS |
| Opus decode player | 1 | `37550B` | `37550B` | `100%` | `480640B` | PASS |
| Opus decode player | 2 | `37550B` | `37550B` | `100%` | `480640B` | FAIL |
| Opus decode player | 3 | `37550B` | `37550B` | `100%` | `480640B` | PASS |

关键细节：

| 指标 | 结果 |
|---|---|
| PCM drain-only | 3 轮均无法覆盖 `32KB/s` 裸 PCM |
| Opus decode drain | 3 轮全收、全解码，`decode_fail=0` |
| Opus decode P95 / max | `2ms / 2ms` |
| Opus decode player | 3 轮全收、全解码，`short_write=0` |
| 失败 player 轮次 | `underrun=3`、`rebuffer=2`、`short_write=0` |

### 结论解释

第一，Cloudflare WSS 下行裸 PCM 不能稳定覆盖 `16kHz / 16bit / mono` 的实时码率。

PCM drain-only 中，服务端按 `640B / 20ms` 发送，也就是约 `32KB/s`。设备侧实际只收到 `62.5% - 68.2%`，但 `rb_fail=0`、`rb_wait_ms_max=1ms`，说明设备本地接收 ringbuf 和 drain 不是第一瓶颈。瓶颈仍然在 Cloudflare WSS 下行路径的持续吞吐。

第二，Opus 下行接收和设备侧解码能力是足够的。

valid Opus decode drain 三轮都是：

```text
server_sent = 37550B
device_rx = 37550B
decoded_pcm = 480640B
decode_fail = 0
decode_ms_p95 = 2ms
```

这说明 `20kbps` Opus 下行能显著降低 Cloudflare 路径压力，ESP32-S3 侧 Opus 解码耗时也远小于 `20ms` frame 周期。

第三，播放不连续更可能落在 TTSPlayer 缓冲策略，而不是网络或 Opus 解码。

`opus_decode_player` 三轮都完成了全量接收和全量解码，失败轮也不是因为丢包：

```text
server_to_device_ratio = 1.0
decode_fail = 0
short_write = 0
```

失败轮的差异在播放层：

```text
TTS_UNDERRUN = 3
rebuffer = 2
max_backlog_ms = 600
```

这更像是播放启动水位、播放中低水位 rebuffer、以及“服务端结束后的收尾 underrun”没有被区分好。换句话说，本次测试把问题从“是不是 Cloudflare 下行吞吐不够”收敛到了“低码率下行已能覆盖，下一步应优化 TTSPlayer 播放连续性”。

### TTSPlayer 水位矩阵补测

为了继续定位“下行 Opus 已经全收全解码，但扬声器播放偶发不连续”的问题，本轮又做了一次 TTSPlayer 启动水位 / 恢复水位矩阵补测。

测试前先发现一个容易误判的问题：最初几轮运行目录虽然命名为 `800/500ms`、`1000/600ms`，但固件日志仍然显示实际水位是 `600/320ms`。原因是测试宏只传给了 `components/service/CMakeLists.txt`，而 `test_audio_downlink_baseline.c` 实际由 `components/test` 编译。修正编译参数后重新烧录，下面只记录修正后的有效矩阵。

统一条件：

| 项目 | 配置 |
|---|---|
| 路径 | Cloudflare WSS |
| 服务端发送 | valid Opus `50B / 20ms`，约 `20kbps` |
| 设备处理 | WebSocket 接收 -> Opus 解码 -> PCM -> TTSPlayer / I2S |
| 每组轮次 | `15s * 3` |
| 业务链路 | 不启用 ASR / Agent / TTS provider |

有效结果：

| 启动 / 恢复水位 | 轮次 | Rebuffer | Underrun | `rx_gap_ms_max` | 解码 PCM 产出 | `max_write_ms` | 结论 |
|---|---:|---:|---:|---:|---:|---:|---|
| `600/320ms` | 3/3 | 0 | 0 | `329ms` | 约 `245.2kbps` | `45-46ms` | PASS |
| `800/500ms` | 3/3 | 0 | 1 | `670ms` | 约 `242.5kbps` | `46ms` | PASS |
| `1000/600ms` | 3/3 | 0 | 0 | `344ms` | 约 `245.1kbps` | `45-46ms` | PASS |

这组结果说明三件事。

第一，当前 Cloudflare WSS + Opus 下行场景里，`600/320ms` 已经能覆盖本轮 `15s` 测试的到达抖动。三轮都是 `rebuffer=0`、`underrun=0`，说明之前的偶发播放不连续更像是播放水位策略不足，而不是 Opus 解码能力不足。

第二，更高水位不是免费收益。`1000/600ms` 更保守，但会把启动等待推到接近 `700-760ms` 的量级；对语音对话来说，这会直接增加“云端已经开始回话，但设备还没出声”的体感延迟。`800/500ms` 在一轮里遇到 `rx_gap_ms_max=670ms` 仍没有 rebuffer，但出现了 `underrun=1`，更像是收尾读空或边界统计问题，不能直接当作中途可感知卡顿。

第三，`max_write_ms` 稳定在 `45-46ms`，且没有 `short_write`。这说明本轮瓶颈不在 I2S 写入本身；播放连续性的关键更偏向“开始播放前攒多少 PCM”和“播放中低于水位后如何暂停 / 恢复”。

因此当前更稳妥的结论是：

```text
Cloudflare WSS 下行裸 PCM：吞吐不足，不适合直接实时播放。
Cloudflare WSS 下行 Opus：网络接收和解码能力足够。
TTSPlayer 默认 600/320ms 水位：本轮 15s 矩阵可通过，可作为当前默认策略。
动态水位：暂不需要立即引入，等更长真实 TTS 流和更复杂网络抖动再评估。
```

后续如果真实 TTS 不是稳定 `50B / 20ms`，而是存在更明显的 burst / gap，就需要把 `streaming_underrun` 和 `end_of_stream_underrun` 区分开，再考虑有限范围内的自适应水位，例如把启动水位限制在 `400-1000ms` 之间，而不是无上限增加播放延迟。

## 当前结论

本章能得出的结论有四个：

1. **Opus 上行在 metrics-only 范围内可行。**  
   `encoded == sent == server_received`，无 drop，无 ringbuf 积压。

2. **降码率确实能把 Cloudflare 路径从“持续追不上”变成“可承载当前上行音频”。**  
   这不是因为 `esp_transport_write()` 消失了，而是因为每秒需要发送的数据量下降了一个数量级。

3. **当前实现还不是最终生产设计。**  
   同步编码导致 `sr_detect` 栈需求明显上升；SR wall-clock 生产速率低于理论值；ASR 准确率和全链路首响还没有验证。

4. **下行 Opus 接收、解码和基础播放水位策略通过最小验证。**  
   Cloudflare WSS 裸 PCM 下行覆盖不了 `32KB/s`；Opus 下行能全量接收并解码。补测 TTSPlayer 水位矩阵后，`600/320ms`、`800/500ms`、`1000/600ms` 三组均无 rebuffer，当前可先保留 `600/320ms` 作为默认策略，再用更长真实 TTS 流验证。

## 下一步

下一步不应该直接宣布“Opus 已完成”，而是继续做三个窄验证：

1. **SR 生产速率定位**
   - `SR_SERVICE_TASK_YIELD_MS=10/1/0` 对照；
   - Opus on/off 对照；
   - 增加 `fetch_wait_ms`、`detect_process_ms`、`encode_process_ms`、`first_pcm_ms`、`last_pcm_ms`。

2. **真实 ASR 等价性验证**
   - 同一测试音频；
   - PCM 上行 vs Opus 上行；
   - 比较 ASR final、首响、失败率和设备回 listening 的状态。

3. **真实 TTS 播放连续性验证**
   - 用真实 TTS provider 输出替代固定 `50B / 20ms` 测试流；
   - 延长到 `60s` 或多段连续回复；
   - 区分播放中 `streaming_underrun` 和服务端结束后的 `end_of_stream_underrun`；
   - 记录 `rx_gap_ms_max`、`read_timeout`、`rebuffer`、`short_write`、`max_backlog_ms` 与用户听感。

只有这些验证都通过后，Opus 才能从“吞吐验证通过”升级为“可进入生产链路的编码方案”。

## 参考资料

- [RFC 6716: Definition of the Opus Audio Codec](https://www.rfc-editor.org/rfc/rfc6716)
- [RFC 7587: RTP Payload Format for the Opus Speech and Audio Codec](https://www.rfc-editor.org/rfc/rfc7587)
- [Opus Codec official website](https://opus-codec.org/)
- [Espressif esp_audio_codec 2.5.0](https://components.espressif.com/components/espressif/esp_audio_codec)
