---
title: 09 Opus 后真实会话验证：pi-agent 闭环与下行播放瓶颈
description: 记录 Opus 上行切换后，Cloudflare WSS + pi-agent + 真实 TTSPlayer 播放链路的实机 smoke 结果，并分析下行 PCM 播放不连续的下一步定位方向。
---

前面第 8 章证明的是：在 metrics-only 场景里，Opus 上行可以把 Cloudflare WSS 路径从“裸 PCM 吞吐不足”拉回到“编码后数据可承载”的范围内。

但 metrics-only 只能证明传输压力下降，不能证明真实会话可用。真实链路还会叠加：

- `session_start / wake_start / turn_done` 等会话状态；
- ASR 解码和最终识别文本；
- `pi-agent` 路由和首 token 延迟；
- TTS 分段生成节奏；
- Cloudflare WSS 下行 PCM 到达节奏；
- 设备侧 `TTSPlayer` 缓冲、rebuffer 和 I2S 写入。

所以这一章的目标更具体：**用 Opus 上行跑一次真实 `pi-agent` 会话，判断链路是否能功能性闭环，以及播放连续性瓶颈是否已经解决。**

## 测试结论先行

本轮结论是 `PARTIAL-PASS`。

| 维度 | 结论 | 说明 |
|---|---|---|
| 业务会话闭环 | PASS | 设备完成 `session_start -> wake_start -> Opus audio -> ASR -> pi-agent -> TTS -> turn_done -> IDLE`。 |
| Opus 上行 | PASS | `sent_bytes=10700`，`sent_frames=214`，`tx_ringbuf_depth_ms_max=0`，没有上行积压。 |
| pi-agent 路由 | PASS | ASR 识别到“明天深圳会下雨吗？”，天气请求进入 `pi-agent`，首 token 约 `6465ms`。 |
| 真实 TTSPlayer 播放 | PARTIAL | PCM 全量被 player 消费，`short_write=0`，但出现 `underrun=38`、`rebuffer=37`。 |

这次不能写成“完整通过”。更准确的说法是：

> Opus 上行后，真实会话已经能在 Cloudflare WSS + pi-agent 路径上功能性收口；但真实 TTS 下行仍然呈现 bursty PCM 到达，当前 `600/320ms` 播放水位不能证明听感连续。

设备端最终 smoke 标记为：

```text
TEST_SESSION_CLOUD_SMOKE: PASS total=1 failed=0
SESSION_CLOUD_SMOKE cloud_05_playback_single_turn PASS playback_seen=1 encoded_bytes=10700 encoded_frames=214
```

这说明业务自动化脚本认为“会话跑完了”，但它不等价于“用户听到的播放是连续的”。

## 测试条件

| 项目 | 配置 |
|---|---|
| 设备 | ESP32-S3 / COM6 |
| 公网路径 | `wss://pixel-soul.gpt0417.space` |
| Gateway | WSL `Ubuntu-24.04-PIXEL` |
| Agent | WSL `pi-agent` |
| Gateway port | `8769` |
| pi-agent port | `8797` |
| 上行 codec | Opus |
| 下行格式 | PCM |
| 场景 | `TEST_SESSION_CLOUD_SMOKE_SCENARIO=5` |
| 播放 | `TEST_SESSION_CLOUD_PLAYBACK_SMOKE_ENABLED=1`，真实 `TTSPlayer` + 扬声器链路 |

证据保存在本地测试记录：

```text
worktrees/test/opus_real_usability_20260612_100503/
└── 03_tts_playback/
    └── opus_scenario_5_real_player_wsl_pi_agent/
        ├── summary.md
        ├── verdict.json
        ├── device_flash_monitor_real_player.log
        ├── gateway_wsl.err.log
        └── pi_agent_gateway_wsl.err.log
```

## 关键时间线

本轮按真实会话路径推进：

```text
Device connected
-> session_start_ack
-> wake greeting TTS
-> Opus weather sample upload
-> cloud decode
-> ASR final: 明天深圳会下雨吗？
-> pi-agent weather route
-> first token about 6465ms
-> 5 TTS chunks
-> downlink PCM
-> TTSPlayer real playback
-> turn_done
-> IDLE
```

这条时间线证明两个事实：

1. 上行 Opus 没有破坏现有会话协议和云端 ASR 输入。
2. 真实 Agent/TTS 路径已经接入，而不是 metrics-only 自测。

## 上行分析

上行指标如下：

| 指标 | 数值 |
|---|---:|
| `sent_bytes` | `10700` |
| `sent_frames` | `214` |
| `send_call_count` | `214` |
| `send_call_avg_ms` | `2ms` |
| `send_call_max_ms` | `4ms` |
| `tx_ringbuf_depth_ms_max` | `0ms` |

这组数据和第 8 章的结论一致：Opus 上行已经不再触发 Cloudflare WSS 路径下的持续发包背压。

`10700B / 214 frames = 50B/frame`，正好对应当前 `20ms / 20kbps / CBR` 的 raw Opus packet。也就是说，本轮不是偶然少发，而是按预期把每个 20ms 上行音频帧压缩到了约 50B。

因此，至少在这个场景中，下一步不应该继续优先抠上行 WebSocket 吞吐。上行的主要剩余风险是：

- Opus 对 ASR 准确率是否有长期影响；
- `sr_detect` 同步编码造成的栈和调度压力是否需要继续拆分；
- 更多真实样本下是否还会出现识别意图退化。

## Agent 与 TTS 产出

天气轮的关键信息：

| 指标 | 数值 |
|---|---:|
| ASR final | `明天深圳会下雨吗？` |
| `provider_first_token_ms` | `6465ms` |
| weather TTS chunks | `5` |
| weather TTS PCM | `562560B` |
| weather TTS duration | `17580ms` |
| wake greeting PCM | `170880B` |

这里的 `6465ms` 主要反映 `pi-agent` / 模型 / 天气工具链路的首 token 延迟，不应误判为音频传输延迟。

下行 PCM 数据量也能对上：

```text
wake greeting: 170880B = 5.34s PCM
weather reply: 562560B = 17.58s PCM
total: 733440B = 22.92s PCM
```

设备侧 player 最终统计：

```text
read_bytes=733440
written_bytes=733440
short_write=0
```

这说明 `TTSPlayer` 最终确实消费并写出了期望的 PCM 总量，I2S 写入本身没有出现 short write。

## 播放连续性问题

问题出现在播放过程中的等待和恢复：

| 指标 | 数值 |
|---|---:|
| `underrun` | `38` |
| `rebuffer` | `37` |
| `read_timeout` | `38` |
| `start_buffer_ms` | `600ms` |
| `resume_buffer_ms` | `320ms` |
| `max_backlog_ms` | `742ms` |
| `max_wait_buffer_ms` | `2019ms` |
| `rx_gap_ms_max` | `19975ms` |

`rx_gap_ms_max=19975ms` 不能直接当作播放中断，因为它包含 wake greeting 和天气回复之间的业务间隔。但即使不看这个最大值，`underrun=38`、`rebuffer=37` 也说明播放过程中多次出现“player 消费速度快于新 PCM 到达速度”的现象。

这和第 8 章固定流测试形成了一个很重要的对照：

| 测试 | 下行输入 | 结果 |
|---|---|---|
| 第 8 章固定 Opus player | `50B / 20ms` 稳定 Opus packet，设备解码后播放 | `600/320ms` 可通过，基本无 rebuffer。 |
| 第 9 章真实会话 | TTS provider 生成 PCM，经 gateway 分块下发 | 完整播放收口，但多次 underrun/rebuffer。 |

因此，问题不再是“ESP32-S3 能不能解码 Opus”或“player 能不能写 I2S”，而更像是：

> 真实 TTS 输出不是稳定 20ms cadence，而是按 TTS chunk / gateway flush / Cloudflare 到达节奏形成 burst。当前 player 水位只覆盖了固定流测试，没有覆盖真实业务流的到达间隔。

## 为什么这不是上行问题

如果上行仍然是瓶颈，通常会看到：

- `tx_ringbuf_depth_ms` 上升；
- `sent_bytes < encoded_bytes`；
- `send_call_ms` 持续走高；
- 云端迟迟拿不到完整音频，ASR final 缺失或很晚。

本轮没有这些现象。相反，上行数据很干净：

```text
sent_frames=214
send_call_avg_ms=2
send_call_max_ms=4
tx_ringbuf_depth_ms_max=0
```

ASR 也已经识别出正确意图，并完成 pi-agent 路由。所以当前瓶颈应收敛到下行侧：

```text
TTS chunk cadence
-> gateway downlink flush
-> Cloudflare WSS arrival gap
-> device rx ringbuf
-> TTSPlayer watermarks / rebuffer
-> I2S write
```

其中 I2S 写入暂时不是第一嫌疑，因为 `short_write=0` 且 `written_bytes` 与期望 PCM 总量一致。

## 当前判断

这一轮能支持的判断是：

1. **Opus 上行可以作为后续真实会话联调的默认基线。**  
   它已经解决了此前 Cloudflare WSS 裸 PCM 上行吞吐不匹配的问题。

2. **业务闭环已经打通，但不能声明播放体验完全通过。**  
   自动化脚本 PASS 只能证明状态机和数据量收口；听感连续性还要看播放过程是否 rebuffer，以及用户现场是否听到卡顿。

3. **真实下行 PCM 是当前更值得优先定位的瓶颈。**  
   第 8 章已经证明固定 Opus 下行可稳定接收、解码和播放；第 9 章真实 TTS PCM 仍然 bursty，所以后续要么优化 player 水位策略，要么把下行也切成 Opus/packet queue。

4. **`600/320ms` 不是最终结论。**  
   它在固定流测试里够用，但真实 TTS 流里仍有多次 rebuffer。后续需要用真实 TTS chunk cadence 来重新设计水位，而不是只依赖固定 `50B / 20ms` 流。

## 下一步动作

下一轮建议按这个顺序做，不要同时改太多变量：

1. **先把播放 underrun 分型。**  
   在日志里区分 `streaming_underrun` 和 `end_of_stream_underrun`。如果大部分 underrun 发生在服务端结束后，就不应当判定为播放中卡顿；如果发生在 TTS chunk 中间，则必须优化。

2. **提取真实 TTS chunk cadence。**  
   记录每个 `output_audio` chunk 的生成时间、字节数、下发时间、设备收到时间、player backlog。目标是看清楚真实 gap 是 `300ms`、`800ms` 还是 `2s` 级别。

3. **做真实 TTS 水位矩阵。**  
   不再只测固定 Opus 流，而是用同一个真实天气回复对比：
   ```text
   600/320ms
   1000/600ms
   1500/800ms
   ```
   指标同时看 `first_play_delay_ms`、`rebuffer`、`streaming_underrun` 和用户听感。

4. **评估正式下行 Opus。**  
   如果真实 PCM 下行的 burst 无法靠合理水位解决，下一步就应把下行也压缩为 Opus。但正式接入前必须补 packet 边界设计，不能继续把 Opus 当作普通字节流随意切片。

这轮最重要的收获不是“全链路已经完美”，而是把问题边界进一步缩小了：**上行 Opus 已经可用，真实播放体验的主要工作应转向下行 PCM 到达节奏与 TTSPlayer 缓冲策略。**
