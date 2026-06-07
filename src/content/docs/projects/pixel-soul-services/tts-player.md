---
title: TTSPlayer 复习笔记
description: Pixel Soul 设备侧 TTS PCM 播放、下行 ringbuf 与播放打断边界复习。
---

## 一句话定位

`TTSPlayer` 是设备侧 TTS PCM 播放器：它从调用方提供的 `audio_rx_ringbuf` 阻塞读取 16kHz mono PCM，携带 AudioService output token 写入扬声器链路。

## 基础原理

云端 TTS 是流式下行 PCM，不是本地 WAV playlist。设备侧需要一个稳定的播放消费者，把 WebSocketTask 写入的二进制 PCM 从 ringbuf 搬到 AudioService output。

下行链路是：

```text
cloud TTS PCM
  -> WebSocketTask binary downlink
  -> audio_rx_ringbuf
  -> TTSPlayer task
  -> AudioService output token
  -> codec / speaker
```

ringbuf 在这里是字节队列和同步原语，不理解 session、turn、generation 或音频格式。旧 turn 的 PCM 是否还能写入 ringbuf，由 Session 的 output context gate 控制，不由 TTSPlayer 判断。

## 主流程

创建与启动：

```text
tts_player_config_init_defaults()
  -> config.audio_rx_ringbuf = shared audio_rx_ringbuf
  -> tts_player_create()
  -> tts_player_start()
  -> audio_service_start_output(..., &output_token)
  -> 创建 tts_player task
```

播放循环：

```text
while !stop_requested:
  rb_read(audio_rx_ringbuf, pcm_buf, frame_bytes, portMAX_DELAY)
  if stop_requested: break
  if read <= 0: continue
  if interrupt_generation changed: continue
  audio_service_write_output(output_token, pcm_buf, read, timeout)
```

打断和停止：

```text
tts_player_clear()
  -> rb_reset(audio_rx_ringbuf)
  -> 保留 task 和 output token

tts_player_interrupt()
  -> interrupt_generation++
  -> rb_reset(audio_rx_ringbuf)
  -> rb_unblock_reader(audio_rx_ringbuf)
  -> 保留 task 和 output token

tts_player_stop()
  -> 恢复默认音量
  -> stop_requested=true
  -> rb_unblock_reader(audio_rx_ringbuf)
  -> 等 task 退出
  -> audio_service_stop_output(&output_token)
```

## 为什么这样设计

第一，TTSPlayer 只做播放，不做会话判断。它不保存 `session_id`、`turn_id` 或 generation，避免把 Session 的新旧 turn 规则塞进播放器。

第二，播放器持有 AudioService output token。这样所有扬声器写入都经过 AudioService 的资源租约模型，避免绕过 token 直接操作 I2S/codec。

第三，clear、interrupt、stop 分层表达不同强度的动作：

- `clear`：丢弃排队 PCM，播放任务继续等下一段。
- `interrupt`：丢弃排队 PCM，同时唤醒 reader，并用 generation 避免刚读出的旧帧继续写。
- `stop`：结束播放器生命周期，释放 output token。

这个分层对面试表达很重要：播放期“本地立即停播”的主路径不是销毁播放器，而是 Session 关闭旧 output gate、调用 TTSPlayer 打断/清空下行队列，并发送协议级 `turn_terminate`。

## 当前项目实现

公开接口在 `components/service/include/tts_player.h`：

- `tts_player_config_init_defaults()`：默认 `16000Hz / mono / 16-bit / 512 frame samples / volume=60`。
- `tts_player_create()`：创建播放器对象和内部 PCM buffer；`audio_rx_ringbuf` 由调用方创建和销毁。
- `tts_player_start()`：申请 AudioService output token，并创建播放 task；重复 start 已运行播放器返回 `ESP_OK`。
- `tts_player_set_volume()`：运行中通过 output token 调 AudioService 设置音量。
- `tts_player_resume()`：恢复配置里的默认音量。
- `tts_player_get_snapshot()`：返回 `running`、`playback_active`、`queued_bytes`、`backlog_ms`。
- `tts_player_clear()`：reset 下行 ringbuf，不停 task，不释放 token。
- `tts_player_interrupt()`：增加 generation，reset ringbuf，并 unblock reader。
- `tts_player_stop()`：请求 task 退出，唤醒 reader，等待最多约 `1000ms`，最后释放 output token。
- `tts_player_destroy()`：先 stop，再释放内部 buffer 和 player 对象。

snapshot 中的 `playback_active` 不是单纯看队列是否有数据；它还会看最近约 `120ms` 是否写过 PCM，用于覆盖 codec/DMA 里可能还在播放的短尾音。

旧 `esp_skainet_player` 是本地 WAV 播放参考，不是当前云端 TTS 主路径。它面向 WAV 文件和 playlist，并且不走 AudioService token 模型。

## 关键边界/踩坑

- `TTSPlayer` 不解析 JSON，不创建 WebSocket，不判断 turn 归属。
- `audio_rx_ringbuf` 只是下行 PCM 队列；旧 turn PCM 是否能入队由 Session gate 决定。
- `clear` 只清空尚未播放的 PCM，已经写入 I2S/DMA/codec 的短尾音可能继续响一瞬间。
- `interrupt` 比 `clear` 更适合播放期打断，因为它会递增 generation 并唤醒阻塞 reader，避免刚读出的旧帧继续写。
- `stop` 是生命周期结束，会释放 AudioService output token；普通 turn 打断不应默认 stop 整个播放器。
- `set_volume(0)` 不能替代打断。音量只是输出参数，不能清理旧 turn 队列，也不能阻止迟到 PCM 再入队。
- 如果 `audio_service_write_output()` short write，TTSPlayer 只记录 warning，不关闭 Session，也不重连 WebSocket。

## 面试问答

**问：TTSPlayer 和 WebSocketTask 怎么配合？**

答：WebSocketTask 负责接收云端 binary PCM 并写入 `audio_rx_ringbuf`；TTSPlayer 只从这个 ringbuf 读 PCM，再用 AudioService output token 播放。

**问：`clear`、`interrupt`、`stop` 的区别是什么？**

答：`clear` 只是 reset ringbuf，播放器继续运行；`interrupt` 在 clear 的基础上递增 generation 并唤醒 reader，适合当前播放被用户打断；`stop` 结束 task 并释放 output token，是生命周期操作。

**问：播放期 KEY 打断为什么不能只靠 TTSPlayer？**

答：TTSPlayer 只能处理本地下行队列和播放任务。旧 turn 后续是否还会有 binary PCM 到达，必须由 Session 关闭旧 output gate 并发送 `turn_terminate`，否则清空后旧音频还可能再次入队。

**问：为什么 TTSPlayer 不保存 turn_id？**

答：turn_id 是会话语义，应由 Session 统一维护。播放器只搬运 PCM，保持单一职责，测试和复用都更简单。

**问：为什么 stop 要 `rb_unblock_reader()`？**

答：播放 task 可能阻塞在 `rb_read(..., portMAX_DELAY)`。如果 stop 不唤醒 reader，task 可能无法退出，也就无法释放 output token。

## 复习检查表

- [ ] 能画出 `WebSocketTask -> audio_rx_ringbuf -> TTSPlayer -> AudioService`。
- [ ] 能解释 TTSPlayer 为什么必须走 AudioService output token。
- [ ] 能区分 `clear`、`interrupt`、`stop`。
- [ ] 能说明为什么普通 turn 打断不应默认销毁播放器。
- [ ] 能讲清 Session gate 和 TTSPlayer 本地清队列的关系。
- [ ] 能解释 `rb_unblock_reader()` 在 stop/interrupt 中的作用。
- [ ] 能说明 snapshot 中 `queued_bytes/backlog_ms/playback_active` 的用途。
