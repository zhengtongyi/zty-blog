---
title: Pixel Soul
description: 基于 ESP32-S3-RLCD-4.2 的桌面 AIoT 项目记录。
---

Pixel Soul 是一个桌面 AIoT 设备项目，目标是在小型硬件上组合显示、音频、语音识别、云端 Agent 和本地交互。

## 设备侧

- ESP32-S3-RLCD-4.2 开发板。
- 4.2 英寸全反射屏。
- 双麦克风与音频 codec。
- 温湿度、RTC、SD 卡、电池电压监测等外设。

## 云端侧

- Gateway 负责设备 WebSocket 会话。
- ASR 负责语音识别。
- TTS 负责语音合成。
- Agent 负责对话和工具调用。

## 写作计划

- ESP32-S3 ADC 与电池电压采集。
- RLCD 刷新和 LVGL 局部刷新优化。
- 语音打断、VAD、AEC 与 KEY 中断策略。
- Session 状态机和云端协议设计。

