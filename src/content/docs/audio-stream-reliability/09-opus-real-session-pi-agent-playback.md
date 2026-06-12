---
title: 09 双向 Opus 真实会话验证：协议打通与下行背压
description: 记录 Cloudflare WSS + pi-agent 下 PCM -> Opus -> ASR -> Agent -> TTS -> Opus -> PCM -> TTSPlayer 的实机验证结果，并分析下行 Opus 队列背压问题。
---

第 8 章证明的是：在 metrics-only 场景里，Opus 上行可以把 Cloudflare WSS 路径从“裸 PCM 吞吐不足”拉回到“编码后数据可承载”的范围内。

但 metrics-only 只证明传输压力下降，不能证明真实会话可用。真实链路还会叠加：

- `session_start / wake_start / turn_done` 等会话状态；
- 上行 `PCM -> Opus -> 云端 decode -> ASR`；
- `pi-agent` 路由、工具调用和首 token 延迟；
- TTS 分段生成节奏；
- 下行 `TTS PCM -> Opus -> 设备 decode -> PCM`；
- `TTSPlayer` 缓冲、水位、rebuffer 和 I2S 写入。

所以这一章补齐的目标是：**在 Cloudflare WSS + pi-agent 路径下验证双向 Opus 链路是否真实可用**，也就是：

```text
PCM -> Opus uplink -> ASR -> Agent -> TTS PCM -> Opus downlink -> PCM decode -> TTSPlayer
```

## 结论先行

本轮最终结论是 `FAIL-DOWNLINK-BACKPRESSURE`，不是 `PASS`。

| 维度 | 结论 | 说明 |
|---|---|---|
| 协议协商 | PASS | 运行配置为 `input_codec=opus`、`output_codec=opus`，设备能收到 `session_start_ack` 并进入会话。 |
| 上行 Opus | PASS | `weather1` 样本发送 `encoded_bytes=10700`、`encoded_frames=214`，设备侧未观察到上行 ringbuf 积压。 |
| ASR / Agent | PASS | 云端识别出“明天深圳会下雨吗？”，并进入 `pi-agent` 天气回复路径。 |
| 下行 Opus 解码 | PARTIAL | Opus decoder 能解码并持续输出 PCM，`decode_ms_p95=2ms`，但真实长回复阶段队列仍会积满。 |
| 播放闭环 | FAIL | 天气长回复下行过程中 `OPUS_DEC_QUEUE depth_packets=256 drops=1`，`WS_RX_AUDIO sink_failed err=ESP_ERR_NO_MEM`，随后自动化脚本判定会话异常。 |

这说明：**双向 Opus 的协议和基本数据路径已经打通，但真实 TTS 长回复还不能稳定播放完成。**  
更准确地说，上行 Opus 已经把原来的 Cloudflare 发送吞吐瓶颈压下去了；当前主要问题转移到下行侧：

```text
TTS chunk
-> gateway Opus encode
-> Cloudflare WSS downlink
-> device websocket receive
-> AudioOpusDecoder packet queue
-> decoded PCM ringbuf
-> TTSPlayer
```

其中最直接的失败点是 `AudioOpusDecoder` packet queue 被真实 TTS burst 填满。

## 测试条件

| 项目 | 配置 |
|---|---|
| 设备 | ESP32-S3 / COM6 |
| 公网路径 | `wss://pixel-soul.gpt0417.space` |
| Gateway | Windows 启动 gateway，后端连接 WSL `Ubuntu-24.04-PIXEL` 的 `pi-agent` |
| Agent | `pi-agent` |
| 输入 codec | `opus` |
| 输出 codec | `opus` |
| 输入音频 | `audio_weather1.wav`，PC 播放，设备麦克风收音 |
| input audio gap | `0.8s` |
| 下行 Opus pacing | `10ms / packet` |
| 设备播放 | 真实 `TTSPlayer` + 扬声器链路 |

证据目录：

```text
D:\Tools\ESP-IDF\projects\worktrees\test\session_cloud_09_duplex_opus\
├── 20260612_154739_tail_guard\
├── 20260612_155540_opus_paced_downlink\
└── 20260612_160855_opus_paced_gap08\
```

最终重点 run：

```text
20260612_160855_opus_paced_gap08
├── run_config.json
├── device_serial_duplex_opus_gap08.log
├── gateway_windows.err.log
├── gateway_windows.out.log
├── pi_agent_gateway_8787.err.log
└── pi_agent_gateway_8787.out.log
```

`run_config.json` 中记录的关键配置：

```json
{
  "input_codec": "opus",
  "output_codec": "opus",
  "uri": "wss://pixel-soul.gpt0417.space",
  "input_audio_gap_final_timeout_s": 0.8,
  "output_opus_packet_pace_ms": 10
}
```

## 推进过程

这次不是一次跑通，而是连续收敛了三个问题。

### 1. 短尾音保护

早期 run 中，天气音频后面被 ASR 额外切出一个极短尾音，例如“么？”。这会导致 `pi-agent` 仍在处理上一轮天气请求时，又收到一个新的短文本请求，从而返回类似 `agent is already processing` 的忙碌错误。

云端增加了短尾音保护：当 voice pipeline 仍处于 busy 状态，且 final transcript 只是极短尾音/语气词时，不替换当前 turn，也不再转发给 Agent。

这一步解决的是“重复 turn / busy 429”问题，但不解决下行播放。

### 2. 下行 Opus packet pacing

下行切成 Opus 后，云端原本会把一个 TTS chunk 编码出的多个 Opus packet 连续 `send_binary`。这对公网吞吐来说字节量很小，但对设备端 decoder queue 来说是一个短时间 burst。

第一次改为 `20ms / packet` 后，queue 不再立刻溢出，但播放侧出现 underrun/rebuffer。原因也比较直观：`20ms / packet` 接近 1x 实时速率，只要 Cloudflare、调度或设备端有一点额外抖动，player 就会被饿到。

因此后续改为 `10ms / packet`，目标是让云端以约 2x 实时速率下发 Opus packet，给设备侧留出一点缓冲余量。

### 3. input audio gap 从 0.3s 调到 0.8s

`20ms pacing` 那轮还暴露了另一个问题：天气句子被切成两段：

```text
明天深圳会。
下雨吗？
```

这不是 Opus 编码本身的问题，而是云端输入音频 gap final timeout 偏短。固定样本播放时，句子中间的短暂停顿会被误判为一轮结束。

把 `input_audio_gap_final_timeout_s` 从默认 `0.3s` 调到 `0.8s` 后，最终 run 成功识别出完整意图：

```text
明天深圳会下雨吗？
```

## 最终 run 时间线

最终 run 是 `20260612_160855_opus_paced_gap08`。

设备侧关键事件：

```text
16:11:11 session_start_ack
16:11:12 wake_start turn_new
16:11:15 wake greeting output_text
16:11:17 wake turn_done
16:11:25 weather1 OPUS_SENT encoded_bytes=10700 encoded_frames=214
16:11:28 weather turn_new text="明天深圳会下雨吗？"
16:11:34 weather output_text chunk_index=1
16:11:36 OPUS_DEC_QUEUE depth_packets=256 drops=1
16:11:36 WS_RX_AUDIO sink_failed len=51 err=ESP_ERR_NO_MEM
16:11:37 TEST_SESSION_CLOUD_SMOKE: FAIL
```

云端侧对应的下行 TTS/Opus 输出：

| turn | chunk | source PCM bytes | duration |
|---|---:|---:|---:|
| wake greeting | 1 | `110080B` | `3440ms` |
| wake greeting | 2 | `33920B` | `1060ms` |
| weather reply | 1 | `115840B` | `3620ms` |
| weather reply | 2 | `131840B` | `4120ms` |
| weather reply | 3 | `83840B` | `2620ms` |
| weather reply | 4 | `85120B` | `2660ms` |

天气回复合计：

```text
source PCM bytes = 416640B
PCM duration = 13020ms
```

如果按当前 `20ms / packet`、约 `50B / packet` 的 Opus 配置估算，13.02s 回复大约会产生 `651` 个 Opus packet。最终日志里设备接收侧在失败前已经到：

```text
WS_RX_AUDIO sink_bytes=28448
frames=659
OPUS_DEC_QUEUE depth_packets=256
drops=1
```

这个数量级是对得上的：失败不是“没收到 Opus”，而是**真实长回复的 Opus packet 到达速度超过了解码/播放链路可持续消化速度，队列最终打满**。

## 上行已经不是主要瓶颈

本轮上行数据很干净：

```text
OPUS_SENT label=weather1 encoded_bytes=10700 encoded_frames=214
```

`10700B / 214 frames = 50B/frame`，正好对应当前 `20ms / 20kbps / CBR` raw Opus packet。  
这说明设备不是少发、漏发，也不是把 PCM 裸流误发到云端。云端也成功得到完整 ASR final：

```text
明天深圳会下雨吗？
```

因此，下一步不应该继续优先抠上行 WebSocket 吞吐。更值得定位的是下行侧的速率匹配和背压：

- 云端 TTS chunk 生成是 bursty 的；
- gateway 会把一段 TTS PCM 快速编码成很多 Opus packet；
- `10ms / packet` 虽然比 `20ms / packet` 更不容易饿播放器，但仍可能快于设备端 decoder queue 的长期消费能力；
- 设备端当前在 queue 满时返回 `ESP_ERR_NO_MEM`，导致 websocket sink 失败，进而影响会话稳定性。

## 解码本身看起来不是 CPU 瓶颈

设备侧 decoder 关键指标：

```text
OPUS_DEC_QUEUE depth_packets=144 decoded_pcm=243840 decode_ms_p95=2
OPUS_DEC_QUEUE depth_packets=256 drops=1 decoded_pcm=273920 decode_ms_p95=2
OPUS_DEC_STACK_WATERMARK free=6052 stack=16384
```

`decode_ms_p95=2ms` 明显低于 `20ms` 音频帧周期。也就是说，单包 Opus 解码本身并不慢。  
问题更像是队列和调度模型：

```text
WebSocket RX burst
-> packet queue 快速上涨
-> decoder / PCM ringbuf / player 消费速度没有同步追上
-> queue 满
-> websocket sink 返回 ESP_ERR_NO_MEM
-> 会话进入异常收口
```

这也解释了为什么“继续增大 decoder queue”不是根治方案。当前 256 包约等于 5.12s 音频，已经不是一个很小的缓冲。如果 256 包仍会满，说明系统缺少真正的下行背压或节流闭环。

## 和第 8 章的关系

第 8 章固定流测试证明：

- Cloudflare WSS 下，固定 `50B / 20ms` valid Opus 流可以被设备接收；
- 设备端可以解码为 PCM；
- `TTSPlayer` 在 `600/320ms` 水位下可以稳定播放固定节奏输入。

第 9 章真实会话补充了一个关键事实：**真实 TTS 不是固定 `50B / 20ms` 流。**

真实 TTS 的输出形态是：

```text
模型/Agent 生成文本
-> TTS 按 chunk 输出 PCM
-> gateway 把一个 chunk 编成一批 Opus packet
-> packet 经过 Cloudflare 到设备
```

所以真实链路里同时存在两类风险：

- 太慢：pacing 接近 1x 实时速率时，player 容易 underrun/rebuffer；
- 太快：pacing 过快或 chunk burst 太集中时，decoder packet queue 容易打满。

第 8 章解决的是“设备能不能承载稳定 Opus 流”；第 9 章暴露的是“真实业务 burst 下缺少背压和水位协同”。

## 当前判断

本轮能支持的判断是：

1. **双向 Opus 协议已经打通，但不能判定真实播放通过。**  
   `input=opus / output=opus` 能完成协商，wake greeting 也能收到和播放；天气真实长回复阶段失败。

2. **上行 Opus 可作为后续真实会话联调的默认方向。**  
   它解决了裸 PCM 在 Cloudflare WSS 上行不匹配的问题，并且本轮 ASR 意图正确。

3. **下行 Opus 需要背压，而不是只靠固定 pacing。**  
   `20ms / packet` 容易让 player 饿；`10ms / packet` 又可能让 decoder queue 在长回复里打满。固定 pacing 只能临时折中，不能覆盖所有 TTS chunk 形态。

4. **decoder queue 满时直接失败的策略太脆。**  
   当前 `ESP_ERR_NO_MEM` 会把局部下行拥塞放大成会话失败。后续需要至少区分“可恢复背压”和“不可恢复错误”。

## 下一步动作

下一轮不建议继续盲目扩大 queue。更合理的顺序是：

1. **先补下行观测字段。**  
   设备侧记录 `opus_rx_packets`、`decoder_queue_depth_ms`、`decoded_pcm_ringbuf_ms`、`player_backlog_ms`、`decode_drops`、`sink_fail_count`。云端记录每个 TTS chunk 的 `packet_count`、`send_duration_ms`、`packet_pace_ms`。

2. **把下行 queue 满从硬失败改成可观测背压。**  
   例如 `AudioOpusDecoder` 在队列满时短暂等待、统计等待时间和丢弃策略，而不是立即让 `WebSocketTask` 报 `ESP_ERR_NO_MEM`。

3. **设计最小下行 RR。**  
   上行已经有 `audio_sr/audio_rr` 的思路。下行也需要类似水位回报，让云端知道设备端 decoder/player 当前是“饿了”还是“堵了”。否则云端只能靠固定 `10ms/15ms/20ms` 猜。

4. **再测 pacing 矩阵。**  
   在有下行水位数据后，再比较 `10ms`、`15ms`、`20ms`、动态 pacing，而不是只看最终是否播放失败。

5. **最后再做真人听感。**  
   自动化日志先证明队列、水位和播放连续性稳定，再让用户在设备旁听“讲个笑话/天气回复”是否自然。

这一章最重要的收获不是“Opus 后已经完美可用”，而是把问题边界进一步缩小了：**上行从吞吐瓶颈变成可用基线；真实双向链路的关键问题转移到了下行 Opus burst、设备端队列背压和播放水位协同。**
