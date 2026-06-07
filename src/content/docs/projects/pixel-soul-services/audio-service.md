---
title: AudioService 复习笔记
description: Pixel Soul 设备侧音频资源租约、token 与 codec 边界复习。
---

## 一句话定位

`AudioService` 是设备侧音频资源租约层：上层通过 input/output token 租用麦克风和扬声器链路，`AudioService` 负责安全打开、读写、关闭 codec，不理解 SR、Session、TTS 或 UI 业务语义。

## 基础原理

ESP32-S3 这条音频链路同时涉及 ES7210 ADC、ES8311 DAC、PA、I2C、I2S 和 codec 设备句柄。业务层如果直接操作这些底层资源，很容易出现两个模块同时读麦克风、播放链路被并发关闭、输入输出格式不一致等问题。

`AudioService` 用 token 把“谁能读写当前链路”收敛成资源租约：

- `AUDIO_SERVICE_TOKEN_NONE` 为 `0`，表示无效 token。
- `audio_service_start_input()` / `audio_service_start_output()` 成功后生成非零 token。
- `read_input()`、`write_output()`、`stop_input()`、`stop_output()`、`set_volume()` 都必须携带对应方向 token。
- stop 成功后，调用方持有的 token 会被置回 `0`。
- reset、I/O 失败或底层关闭失败会让内部 token 失效。

这里的 token 不是安全凭证，也不是业务身份。它只表达“当前这条输入或输出链路由谁租用”。因此 `AudioService` 不需要知道调用方是 SR、TTS、AI 还是测试。

## 主流程

输入主线：

```text
SRService
  -> audio_service_start_input(16k/mono/16-bit, &input_token)
  -> audio_service_read_input(input_token, pcm)
  -> AFE / WakeNet / VAD
  -> audio_service_stop_input(&input_token)
  -> input_token == 0
```

输出主线：

```text
TTSPlayer
  -> audio_service_start_output(16k/mono/16-bit, &output_token)
  -> audio_service_write_output(output_token, pcm)
  -> audio_service_set_volume(output_token, volume)
  -> audio_service_stop_output(&output_token)
  -> output_token == 0
```

状态主线：

```text
IDLE
  -> INPUT
  -> OUTPUT
  -> FULL_DUPLEX
  -> ERROR
```

`FULL_DUPLEX` 只表示输入和输出同时打开；能否边听边播，还要看输入输出格式是否一致。

## 为什么这样设计

核心设计取舍是：AudioService 只做资源层，不做业务层。

如果用 `owner=SR/AI/TEST` 这类枚举，AudioService 就会反向理解上层身份，后续新增 TTS、提示音、测试路径时都要改资源层。token 模型更干净：资源层只校验“当前 token 是否匹配”，业务层自己保存“为什么要录音/播放”。

第二个取舍是 input/output 分方向管理。SR 可以长期持有 input token 做唤醒检测，TTSPlayer 可以持有 output token 播放云端 PCM。两条链路可以并存，但格式必须一致，避免共享 I2S/codec 时钟下出现不可预期行为。

第三个取舍是 I/O 锁和 snapshot 锁分开。`read/write` 可能阻塞在 DMA、I2S 或 codec，不能拿着 snapshot 锁阻塞 UI 或诊断读取。方向 I/O lock 用于串行化 open/read/close，snapshot lock 用于快速读取状态。

## 当前项目实现

当前公开接口集中在 `components/service/include/audio_service.h`：

- 默认格式：`16000Hz`、`1` channel、`16` bit、`512` frame samples。
- 默认音量：`60`。
- 输入默认麦克风选择：`AUDIO_SERVICE_DEFAULT_MIC_SELECT`。
- AEC 麦克风选择：`AUDIO_SERVICE_SR_AEC_MIC_SELECT`。
- snapshot 暴露 `state`、`last_event`、`last_error`、`input_active`、`output_active`、`input_bytes`、`output_bytes`、`input_rms`、`input_peak`、`volume`。

实现边界：

- `audio_service.c` 管理状态、token、锁、读写和 snapshot。
- `audio_codec.c` 封装 esp codec device 的 input/output open/read/write/close/volume。
- `audio_codec_board.c` 挂载 ES7210、ES8311、PA、I2C/I2S 资源。
- BSP 提供板级 I2C/I2S/GPIO 资源和板级布线信息，AudioService 负责 codec 能力挂载。

与系统架构的关系：

```text
SRService / TTSPlayer
  -> AudioService
  -> audio_codec
  -> audio_codec_board
  -> BSP I2C/I2S/GPIO
  -> ES7210 / ES8311 / PA
```

## 关键边界/踩坑

- token 不等于业务 owner。不要把 token 显示给 UI，也不要用 token 判断“现在是 SR 还是 TTS”。
- 同一方向同一时间只有一个有效 token。重复 start 会被拒绝。
- 没有 token 不能 read/write/stop/set_volume。
- stop 后调用方 token 会归零；继续使用旧 token 会失败。
- reset 或 I/O 失败会让内部 token 失效，上层要按失败路径重新申请链路。
- full-duplex 要求输入输出格式一致，重点是 sample rate、channel、bits。
- KEY 播放期打断不能靠 `set_volume(0)` 当主方案；当前主路径是 Session 终止 turn、清空下行 PCM，并依赖 turn gate 阻止旧音频继续入队。
- `try_set_volume()` 只是“尽力调音量”，output 写锁忙时可立即返回 `ESP_ERR_TIMEOUT`，不能作为本地打断的必要步骤。

## 面试问答

**问：为什么 AudioService 不直接暴露 owner enum？**

答：因为 owner 是业务身份，属于 SR、Session、TTS 或测试上下文。AudioService 是资源层，只需要知道当前输入/输出链路是否被租用，以及调用方是否持有匹配 token。这样资源层不会反向依赖业务层，模块边界更稳定。

**问：token 解决了什么问题？**

答：token 把“谁可以读写/关闭当前链路”变成显式租约。没有 token 不能操作；旧 token 在 stop、reset 或错误后失效；因此可以避免非持有者误关链路，也方便定位并发资源问题。

**问：为什么 full-duplex 要检查格式一致？**

答：输入和输出共享底层 I2S/codec 时钟和数据链路。格式不一致时，底层行为可能不可预期，所以 AudioService 在另一方向已打开时拒绝不匹配格式。

**问：AudioService 和 TTSPlayer 的边界是什么？**

答：TTSPlayer 负责从 `audio_rx_ringbuf` 读 PCM，并携带 output token 写给 AudioService。AudioService 只负责把 PCM 写到 codec，不判断 PCM 属于哪个 session 或 turn。

**问：为什么 AudioService 不直接实现 TTS 打断？**

答：打断依赖当前 Session 状态、turn 上下文和云端协议。AudioService 只执行 output token 对应的写入、停止和音量控制，不判断“为什么要停播”。

## 复习检查表

- [ ] 能说清 AudioService 是“资源租约层”，不是业务层。
- [ ] 能解释 token 的生成、使用、失效和归零。
- [ ] 能画出 SR 输入链路和 TTS 输出链路。
- [ ] 能说明 full-duplex 为什么要求格式一致。
- [ ] 能区分 `set_volume()`、`try_set_volume()` 和播放打断主路径。
- [ ] 能说明 snapshot 只暴露音频状态，不暴露业务 owner。
- [ ] 能说出 read/write 失败后链路会进入 ERROR 并使 token 失效。
