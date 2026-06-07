---
title: SRService 复习笔记
description: Pixel Soul 设备侧唤醒、语音活动检测与上行音频发布复习。
---

## 一句话定位

`SRService` 是设备侧语音输入执行器：它负责从 AudioService 读取麦克风 PCM，经过 ESP-SR AFE 做 Wake Detect 和 Voice Detect，并在 Session 授权后把 AFE 后单通道 PCM 写入上行 `audio_tx_ringbuf`。

## 基础原理

设备侧语音输入不是“麦克风一开就持续上传”。当前项目把它拆成三段：

```text
Wake Detect -> Voice Detect -> Audio Publish
```

这三段代表三种不同职责：

- Wake Detect：监听唤醒词，命中后 latch 本轮 wake，只发一次 wake 事件。
- Voice Detect：唤醒后判断是否真的有人声开始/结束，输出边沿事件。
- Audio Publish：只有 Session 授权后，才把当前 AFE mono PCM 写入上行 ringbuf。

`SRService` 只观察语音事实，不创建 AI Session，不维护 turn，不发送 WebSocket frame，不控制 TTS，也不处理 BOOT/KEY 的产品语义。这些由 App、Session、WebSocketTask、TTSPlayer 分别承担。

## 主流程

启动与输入：

```text
AppAIRuntime
  -> 创建 audio_tx_ringbuf
  -> sr_service_start(config, callback)
  -> audio_service_start_input(...)
  -> sr_feed_task 读取 AudioService input PCM
  -> ESP-SR AFE feed
```

检测与发布：

```text
sr_detect_task
  -> AFE fetch
  -> Wake Detect
  -> Voice Detect
  -> Audio Publish when wake_latched && audio_publish_enabled
  -> rb_write(audio_tx_ringbuf)
```

一次典型 AI 上行链路：

```text
BOOT long press
  -> App 激活 SR，提示用户说唤醒词
  -> audio_publish_enabled=false

WakeNet hit
  -> SR_SERVICE_EVENT_WAKE_WORD
  -> App/Session start
  -> session_start_ack 后 wake_start
  -> Session LISTENING

Voice Activity START
  -> Session 清空 audio_tx_ringbuf
  -> sr_service_set_audio_publish_enabled(true)
  -> sr_service_publish_voice_prefix()
  -> 当前 AFE mono PCM 持续写入 audio_tx_ringbuf
```

重点表达是：SR 负责发现“唤醒了、有人声了、可以把音频搬到 ringbuf 了”，但“什么时候允许发布”由 Session 控制。

## 为什么这样设计

第一，唤醒和上传分离。设备可以一直检测唤醒词，但不代表所有 PCM 都应该上传。只有 Session 已准备好接收用户语音时，才打开 `audio_publish_enabled`。

第二，Voice Activity 和 Audio Publish 分离。Voice Activity 是“检测到人声边沿”，Audio Publish 是“被授权写上行 ringbuf”。当前发布条件只看：

```text
wake_latched && audio_publish_enabled
```

不要把 VAD、post-roll 或 `voice_activity_active` 再塞回发布路径，否则 SR 会重新承担 Session 决策，主线会变乱。

第三，prefix 显式发布。VAD 发现人声时，真正的开头可能已经在 AFE 的 `vad_cache` 或 SR 的 pre-roll 中。`sr_service_publish_voice_prefix()` 只负责把缓存写入 ringbuf，不判断业务状态。调用时机由 Session 决定。

## 当前项目实现

公开接口在 `components/service/include/sr_service.h`：

- `sr_service_start()` / `sr_service_stop()`：启动和停止 SR。
- `sr_service_set_active(bool)`：运行门控，false 时进入 `PAUSED` 并清理 wake、voice、publish 上下文。
- `sr_service_set_voice_activity_enabled(bool)`：控制唤醒后的 Voice Activity 检测。
- `sr_service_set_audio_publish_enabled(bool)`：控制是否允许写上行 ringbuf。
- `sr_service_publish_voice_prefix()`：发布 `vad_cache` 和最多约 `200ms` pre-roll。
- `sr_service_clear_audio_tx()`：清空上行 ringbuf。
- `sr_service_reset_wake()`：清理 wake latch、Voice Activity 和发布上下文。
- `sr_service_get_snapshot()`：读取 SR 运行状态、wake、voice、publish、RMS、peak 等诊断字段。

当前关键常量：

- 唤醒模型：`wn9s_nihaoxiaozhi`。
- AFE 输出给后续消费者的是 `16000Hz / mono / 16-bit`。
- ES7210 TDM 输入注释为 `MRMN`，输入通道数为 `4`。
- Wake 去重窗口：`200000us`。
- VAD 配置：`VAD_MODE_0`、`vad_min_speech_ms=100`、`vad_min_noise_ms=800`。

Voice Detect 使用 ESP-SR VAD 为主判断；VAD 漏判时，使用 RMS EMA 作为 fallback。RMS fallback 需要连续满足约 `200ms`，避免短促噪声直接触发上行。

## 关键边界/踩坑

- `sr_service_set_active()` 只表示 SR 是否运行，不等于 AI Session active。
- `voice_activity_enabled` 不等于 `audio_publish_enabled`。前者是检测人声，后者是写上行 PCM。
- `audio_publish_enabled=true` 也不是“上传所有 PCM”；实际写入仍要求 `wake_latched`。
- `Audio Publish` 不再额外检查 `voice_activity_active`。Session 用 Voice Activity 事件决定何时打开/关闭授权。
- `sr_service_publish_voice_prefix()` 不判断 wake、publish、session，只搬运缓存。调用前必须由 Session 做好业务判断。
- `audio_tx_ringbuf` 满时，SR 整帧丢弃并限频日志，不阻塞 detect task。
- 播放期默认关闭 Voice Activity，避免 TTS 回声触发语音事件；当前主要打断路径是 KEY 触发 Session 的 `turn_terminate`。
- KEY turn terminate 时，Session 关闭上行授权并清空 `audio_tx_ringbuf`；完整 `reset_wake` 才清语音上下文。

## 面试问答

**问：请用一句话讲 SRService 的核心流程。**

答：SRService 从 AudioService 读取麦克风 PCM，送入 ESP-SR AFE，先做 Wake Detect，再做 Voice Detect，最后在 Session 授权时把 AFE 后 mono PCM 写入 `audio_tx_ringbuf`。

**问：为什么不是唤醒后立刻上传所有音频？**

答：唤醒只说明设备听到了唤醒词，不说明 Session 已经准备好接收用户语音。项目把上传授权交给 Session，避免 WebSocket、协议和 turn 状态没准备好时乱写音频。

**问：Voice Activity START 之后为什么要 publish prefix？**

答：VAD 事件产生时，人声开头可能已经过去一小段。`vad_cache` 和 pre-roll 保存这段前缀，Session 在正式打开上行前主动调用 prefix publish，可以减少“第一个字被吞”的问题。

**问：ringbuf 满了为什么丢帧而不是阻塞？**

答：detect task 是实时检测路径，阻塞会影响唤醒和 VAD 节奏。当前选择整帧丢弃并限频记录，优先保证 SR 任务继续运行。

**问：SRService 为什么不处理 `turn_terminate`？**

答：`turn_terminate` 是会话和协议语义，SR 只知道 wake、voice 和 PCM 发布。把文本协议或 turn 语义放进 SR 会破坏模块边界。

## 复习检查表

- [ ] 能完整说出 `Wake Detect -> Voice Detect -> Audio Publish`。
- [ ] 能区分 `active`、`voice_activity_enabled`、`audio_publish_enabled`。
- [ ] 能解释为什么发布条件是 `wake_latched && audio_publish_enabled`。
- [ ] 能说明 `vad_cache` 和 pre-roll 解决什么问题。
- [ ] 能说明 `sr_service_publish_voice_prefix()` 为什么不做业务判断。
- [ ] 能讲清 `audio_tx_ringbuf` 的 owner 和满队列处理。
- [ ] 能解释播放期为什么默认关闭 Voice Activity。
