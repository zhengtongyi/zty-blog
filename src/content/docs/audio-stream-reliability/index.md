---
title: 音频流链路搭建与可靠性优化
description: 记录 ESP32-S3 实时语音终端中音频流链路搭建、常见问题、可靠性优化过程和验证结果。
---

这个专栏用于记录 Pixel Soul 语音链路里“音频流链路搭建与可靠性优化”这个问题的持续深化过程。

它不是为了把项目包装得更大，而是为了把一个真实工程问题讲清楚：在 ESP32-S3 这种资源受限设备上，如何让上行语音 PCM、下行 TTS PCM、WebSocket 控制帧、会话状态机和异常收口稳定协作。

当前阶段更准确的定位是“链路搭建”：先把 `采集 -> 分帧 -> 发包 -> 云端 -> 下行 -> 播放` 这条链路讲清楚、跑稳定、量出来。可靠性优化是后续目标，需要通过日志、指标、弱网测试和实机联调逐步证明。

## 专栏原则

这组文章坚持实事求是：

- 已经实现的能力，写清楚实现边界和证据。
- 还没有实现的能力，只写成计划或待验证项。
- 不把“能跑通”夸大成“稳定可靠”。
- 不把单个参数优化包装成完整低延迟方案。
- 每一章尽量对应一个具体工程问题、一个取舍和一个验证方式。

## 章节路线

| 章节 | 内容 |
|---|---|
| [01 问题背景与常见问题](./01-problem-background/) | 说明为什么要把音频流链路作为独立问题，梳理常见风险、指标和方案取舍。 |
| [02 Xiaozhi 音频流传输源码研究](./02-xiaozhi-audio-transport-study/) | 对照 `xiaozhi-esp32-main`，研究 WebSocket、MQTT+UDP、Opus 队列和协议抽象。 |
| [03 上行 PCM 发包链路：积压、回压与弱网基线](./03-uplink-pcm-backpressure-baseline/) | 研究上行 PCM 从采集到 WebSocket 发包之间的积压问题，明确瓶颈、指标和基线。 |
| [04 Cloudflare 公网音频链路基线](./04-cloudflare-public-link-baseline/) | 记录 LAN 与 Cloudflare WSS 实机对照，定位发送阻塞、TX 积压和 PCM 丢弃。 |
| [05 四象限对照基线分析](./05-four-quadrant-baseline-analysis/) | 对比 LAN WS、LAN WSS、Cloudflare WS、Cloudflare WSS，收敛公网退化边界和下一步决策。 |
| [06 Frame 聚合单变量实验](./06-frame-aggregation-analysis/) | 对比 1024B、2048B、4096B frame，验证聚合有效但不足以消除 Cloudflare 路径背压，并拆解每帧固定开销。 |
| [07 Transport 写入分层](./07-transport-write-breakdown/) | 通过 ESP-IDF transport 临时观测补丁拆解 `poll_write` 与 `payload_write`，确认 Cloudflare 路径背压层级。 |
| [08 Opus 降码率验证](./08-opus-uplink-bitrate-baseline/) | 解释 Opus 协议语义、优劣势，并记录上行吞吐匹配、下行接收解码和 TTSPlayer 水位矩阵补测。 |
| [09 Opus 后真实会话验证](./09-opus-real-session-pi-agent-playback/) | 记录 Cloudflare WSS + pi-agent 真实闭环，确认 Opus 上行可用，同时收敛下行 PCM 播放不连续瓶颈。 |

## 当前状态

目前已经完成从问题定义到第一轮公网基线定位：

- 第 1 章定义问题和常见风险。
- 第 2 章研究 Xiaozhi 的协议抽象、队列和传输模式。
- 第 3 章定义上行积压指标，并拆出 `AudioLinkObserver`。
- 第 4 章用 LAN/Cloudflare WSS 对照，定位当前公网发送路径的性能退化。
- 第 5 章用四象限矩阵进一步确认：LAN WSS 基本健康，Cloudflare WS/WSS 都退化，因此不能简单归因为设备侧 TLS。
- 第 6 章完成 frame 聚合单变量实验：4096B 显著降低单位 KB 发送成本，但仍只能跟上约一半的 PCM 生产速率，下一步需要拆分 transport write 耗时。
- 第 7 章完成 transport 写入分层：Cloudflare WS/WSS 的主要尾延迟来自 `poll_write` 与 payload write 背压，TLS 不是第一瓶颈。
- 第 8 章完成 Opus 上行 metrics-only smoke、下行接收解码补测和 TTSPlayer 水位矩阵：上行 `encoded == sent == server_received`；下行 Opus 全量接收解码通过；`600/320ms`、`800/500ms`、`1000/600ms` 三组播放水位均无 rebuffer，当前先保留默认 `600/320ms`，后续用更长真实 TTS 流验证。
- 第 9 章完成 Opus 后真实 `pi-agent` 会话 smoke：业务链路可从 `session_start` 跑到 `turn_done -> IDLE`，Opus 上行无积压；但真实下行 PCM 仍出现 `underrun/rebuffer`，当前结论是 `PARTIAL-PASS`，下一步聚焦真实 TTS chunk cadence 和 TTSPlayer 水位策略。

后续章节会随着代码优化和实机测试逐步补齐。
