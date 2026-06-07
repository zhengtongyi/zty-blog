---
title: Pixel Soul 设备侧复盘
description: 面向项目复习和面试表达的 ESP32-S3 设备侧架构、链路与工程取舍总结。
---

Pixel Soul 设备侧是一台运行在 ESP32-S3 上的 400x300 横屏 1bit 黑白反射屏 AI 宠物终端：它负责把屏幕、按键、传感器、网络、音频、唤醒词、WebSocket 和 AI Session 状态机组织成一个稳定的用户体验，ASR、Agent、TTS 和 provider runtime 则放在云端。

## 一句话定位

如果面试时只能用一句话介绍，我会这样说：

> 这是一个资源受限硬件上的端云 AI 交互终端，设备侧不做大模型推理，而是负责本地交互、音频采集播放、唤醒与会话状态收口，让云端 ASR/Agent/TTS 能像一个连续会话一样被用户感知。

这里的关键词有三个：

- `端侧 owner`：设备侧掌握 UI、按键、Session 状态、turn 生命周期和本地播放体验。
- `云端能力`：ASR、Agent、TTS、provider runtime 不塞进 ESP32 固件。
- `工程稳定性`：AI 链路失败时，基础页面、传感器、时间、配网仍要可用。

## 整体架构

设备侧按 `Application -> Service -> Driver/HAL -> BSP -> ESP-IDF/Hardware` 分层。

```text
Application
  AppCore / AppAIRuntime / App UI

Service
  Button / Network / Sensor / Time / SD / Audio
  SR / Session / Protocol / WebSocketTask / TTSPlayer

Driver / HAL
  display / LVGL / audio codec / SHTC3 / PCF85063

BSP
  board init / GPIO / I2C / I2S
```

核心边界是：

- `AppCore` 决定页面、按键、Footer 和产品语义。
- `Service` 提供能力，不直接渲染 UI，也不写产品文案。
- `BSP` 只表达板级事实，例如引脚、I2C、I2S、GPIO 初始化。
- `Protocol` 只负责 JSON 构建和解析。
- `WebSocketTask` 只做 text/binary frame 搬运。
- `Session` 是 AI 会话 owner，维护 `session_id`、`turn_id`、输出上下文和业务状态。

这个架构的价值是：底层模块不知道“用户正在对话”这种业务语义，上层也不需要逐帧处理音频和硬件细节。

## 启动流程

启动主线可以记成：

```text
Board Init
  -> Display Init
  -> AppCore Init
  -> Services Init
  -> AI Runtime Init
  -> Render Home
  -> Background Services Start
  -> AppEvent Loop
```

更具体一点：

```text
app_application_start()
  -> app_core_start()
  -> app_event_bus_init()
  -> display_service_init()
  -> app_ui_init()
  -> Sensor / Time / SD / Audio / Network / Button init
  -> app_ai_runtime_init()
       -> create uplink/downlink audio ringbuf
       -> start SRService
  -> refresh service snapshots
  -> render Home
  -> start Sensor / Time / Network background work
  -> receive AppEvent and dispatch serially
```

所有外部回调都先投递为 `AppEvent`，再由 `AppCore` 串行消费。这一点很关键：按键、网络、传感器、SR、Session 都可能异步回调，如果每个回调都直接改 UI 或改状态，项目很快会变成竞态地狱。现在的做法是让 `dispatch_event()` 成为业务决策入口。

## UI / 按键

设备有 `Home / Game / Info` 三个主页面，外加全局 Footer。

按键层只输出“事实事件”，例如 `BOOT single_click`、`KEY very_long_press`；真正的业务含义由 `AppCore` 根据当前页面和 AI 状态决定。

常规页面行为：

| 输入 | 行为 |
| --- | --- |
| `BOOT_KEY` 单击 | `Home -> Game -> Info -> Home` |
| `BOOT_KEY` 双击 | 回到 Home |
| `BOOT_KEY` 长按 | AI inactive 时显示唤醒提示；AI active 或连接中时停止 Session |
| `KEY` 在 Game 页 | 计分或连击 |
| `KEY` 在 Info 页超长按 | 清除 Wi-Fi 凭据并进入配网 |

AI active 时，`KEY` 会优先进入 AI 逻辑，不再触发 Game 计分或 Info 配网。特别是 `SPEAKING` 期间的 `KEY` 单击，会执行协议级 `turn_terminate`：设备先本地停播、清空旧下行 PCM、关闭旧 turn gate，再通知云端取消当前 turn。

Footer 是用户感知 AI 状态的主要入口：

| AI 状态 | Footer 表达 |
| --- | --- |
| `IDLE` | 当前页面默认提示 |
| `WAKE_PROMPT` | 提示用户说唤醒词 |
| `LISTENING` 且输入窗未打开 | `WAIT SESSION` |
| `LISTENING` 且输入窗已打开 | `LISTENING...` |
| `THINKING` | `THINKING...` |
| `SPEAKING` | 云端 `output_text` 或 speaking 文案 |
| `ERROR` | 错误提示 |

## AI Session 链路

AI 主链路可以记成：

```text
BOOT Long Press
  -> Wake Prompt
  -> WakeNet Hit
  -> Session Start
  -> wake_start
  -> LISTENING
  -> User PCM Upload
  -> turn_new
  -> output_text + Downlink PCM
  -> Local Playback
  -> turn_done + playback drained
  -> LISTENING
```

注意 BOOT 长按本身不创建 Session。它只把设备带到“请说唤醒词”的产品入口。真正启动云端 Session 的触发点是本地 WakeNet 命中。

Session 状态模型只有五个：

```text
IDLE -> LISTENING -> THINKING -> SPEAKING -> LISTENING
                     \                         /
                      -> ERROR / close -> IDLE
```

几个关键点：

- `session_start_ack` 后设备发送 `wake_start`，但在 wake greeting 播放完成前不上传用户音频。
- `turn_new` 是强边界，新 turn 会替换旧输出上下文。
- 旧 turn 的迟到 `output_text`、binary PCM、`turn_done` 都要被丢弃。
- `turn_done` 不等于本地说完，设备要等 TTS 播放 drained 后才回 `LISTENING`。
- `turn_terminate_ack` 只表示云端收到了终止请求，不驱动本地停播；本地已经先停了。

协议上，JSON 走 WebSocket text frame，PCM 走 binary frame。固定音频格式是 `pcm_s16le / 16000Hz / mono / 16-bit`。设备在 `session_start` 里声明媒体配置，云端 `session_start_ack` 必须确认同一套配置，否则设备按协议错误收口。

## 音频 / SR 链路

音频上行主线：

```text
AudioService input
  -> SRService AFE
  -> Wake Detect
  -> Voice Detect
  -> Session opens audio_publish_enabled
  -> SRService writes audio_tx_ringbuf
  -> WebSocketTask sends binary PCM
```

音频下行主线：

```text
WebSocketTask receives binary PCM
  -> audio_rx_ringbuf
  -> TTSPlayer
  -> AudioService output
  -> codec / speaker
```

这里有三个非常重要的工程边界。

第一，`AudioService` 是资源租约层。它用 input/output token 管理麦克风和扬声器，不关心调用方是 SR、AI 还是测试模块。读写 PCM 必须携带当前有效 token，同一方向不能被多个模块同时抢占。full-duplex 允许输入输出同时打开，但要求采样率、声道数、位宽一致。

第二，`SRService` 是语音输入执行器。它负责 WakeNet、Voice Activity、AFE mono PCM 发布，但不创建 Session、不理解 turn、不发送 WebSocket，也不更新 UI。

第三，`Session` 不逐帧搬 PCM。它只在业务时机上打开或关闭 `audio_publish_enabled`，并在 Voice Activity START 时先清空上行 ringbuf，再发布 `vad_cache/pre-roll` 作为前置补偿，减少用户开口初段被截掉的风险。

播放期默认不做自动 VAD barge-in，主打断路径是 `KEY`。这样取舍更稳定：设备不用在 TTS 播放、麦克风回声、VAD 误触发之间硬拼，用户也有明确的物理打断入口。

## 显示 / 性能优化

设备使用 400x300 1bit 黑白反射屏。显示链路是：

```text
LVGL render buffer
  -> flush callback
  -> 1bit RLCD DispBuffer
  -> esp_lcd_panel_io_tx_color()
  -> SPI DMA
```

这里踩过一个典型嵌入式性能坑：旧实现把 RLCD 1bit 发送缓冲放在 PSRAM，SPI 发送时驱动可能临时申请内部 DMA bounce buffer。AI/SR/Wi-Fi 并发时内部 DMA 内存紧张，就可能出现 no-mem，然后显示发送失败触发整机 abort。

修复思路不是“少刷一点屏”这么简单，而是把显示发送路径的内存属性改正确：

- RLCD 发送缓冲使用内部 DMA-capable 内存。
- `max_transfer_sz` 按真实 1bit 发送长度配置，也就是 `width * height / 8`。
- LVGL 中间渲染 buffer 可以继续放 PSRAM，因为最终会转换到内部 DMA buffer 再发。
- LVGL partial render 的多个 flush chunk 只写入 1bit buffer，只有最后一个 chunk 才整屏发送。

这个优化的面试表达可以是：我把“高负载偶发崩溃”定位到显示 DMA 临时缓冲，而不是 AI 逻辑本身；最后通过约束 buffer 所在内存和发送大小，让刷屏路径不再依赖运行时临时 DMA 分配。

## 关键工程取舍

### 1. 设备侧不实现 ASR/Agent/TTS

ESP32-S3 做本地 UI、音频、唤醒和状态管理，云端做重计算。这样既符合硬件资源现实，也让 provider runtime、模型和密钥留在云端。

### 2. BOOT 长按不直接建 Session

BOOT 长按只是进入唤醒提示，WakeNet 命中后才 `session_start`。这样可以避免误触按键就创建云端会话，也让用户交互更像“先唤醒，再对话”。

### 3. WebSocketTask 保持极简

WebSocketTask 只有 `DISCONNECTED / CONNECTED` 两个状态，连接后每轮处理 JSON/control、上行 audio、接收 frame。它不解析业务 JSON、不自动重连、不清 ringbuf、不加业务 audio gate。业务复杂度留给 Session。

### 4. Session 是唯一 AI 会话 owner

`Protocol` 管格式，`WebSocketTask` 管传输，`SRService` 管语音事实，`TTSPlayer` 管播放 sink。只有 `Session` 维护 session/turn/output 上下文，避免 turn 边界散落在多个模块。

### 5. 资源层不用业务 owner enum

AudioService 从“谁在使用音频”的 owner enum，收敛成 input/output token。这样资源层只关心租约是否有效，不理解 SR、AI、TEST 等业务身份。

### 6. 外设缺失不阻塞主 App

SHTC3、RTC、SD 这类增强能力失败时，Service 进入 `N/A` 或 `Error`，但 App 继续启动。基础 UI、网络、AI 入口不能被非核心外设拖垮。

### 7. 播放打断先保证本地 UX

KEY 打断时设备先停本地下行，再发送 `turn_terminate`。ACK 只是云端确认，不决定用户是否马上听到停止。这个取舍让交互响应更可控。

### 8. 显示优化优先解决内存属性

反射屏刷新慢、1bit 转换、LVGL partial flush 都会影响体验，但真正会导致重启的是 DMA buffer 内存属性和传输大小。优化时先解决会崩溃的问题，再谈刷新观感。

## 面试问答

### 1. 这个项目设备侧到底负责什么？

设备侧负责用户可见交互和本地硬件能力，包括页面、按键、Footer、网络配网、温湿度、时间、SD 状态、音频采集播放、WakeNet、AFE 音频流、WebSocket IO 和 AI Session 状态机。云端负责 ASR、Agent、TTS 和 provider runtime。

### 2. 为什么要分 Application / Service / BSP？

因为三层变化原因不同。Application 变化来自产品交互，Service 变化来自能力实现，BSP 变化来自板级硬件。分层后，页面不直接操作 GPIO/I2S/WebSocket，底层也不理解“AI 会话”这种业务语义，维护时边界更清楚。

### 3. BOOT 长按为什么不直接创建 Session？

BOOT 长按只是用户进入 AI 的意图，不一定代表已经开始说话。设备先显示唤醒提示，等 WakeNet 命中后再启动 Session，可以减少误触造成的云端连接和资源占用，也让交互路径更自然。

### 4. `Session` 和 `Protocol` 有什么区别？

`Protocol` 只构建和解析 JSON，校验消息字段和媒体格式，不维护状态。`Session` 才是业务 owner，它保存 `session_id`、当前 `turn_id`、输出上下文、上下行 gate 和 `IDLE/LISTENING/THINKING/SPEAKING/ERROR` 状态。

### 5. `WebSocketTask` 为什么不解析 JSON？

因为它是传输层 IO pump，只负责 text/binary frame 的收发和转发。业务 JSON 如果放进去，WebSocketTask 会同时承担协议、状态和传输，后续 turn 边界、重连、错误恢复都会混在一起，难以测试和维护。

### 6. 上行音频什么时候真正发给云端？

不是 WakeNet 一命中就立刻上传。Session 建立后先发送 `wake_start`，在正式 `LISTENING` 输入窗口里，SR 检测到 Voice Activity START，Session 清空上行 ringbuf、打开 `audio_publish_enabled`，再发布前置缓存，后续 AFE mono PCM 才进入 WebSocket binary 上行。

### 7. 播放期 KEY 打断如何保证旧音频不会回来？

设备本地先清空下行 PCM、关闭旧 turn 的下行 gate，把 `active_turn_id` 置为无效并回到 `LISTENING`，再发送 `turn_terminate`。后续旧 turn 的 `output_text`、binary PCM、`turn_done`、`turn_terminate_ack` 都会因为 turn_id 不匹配被忽略。

### 8. AudioService 的 token 模型解决了什么问题？

它把“音频硬件资源租约”和“业务身份”分开。上层拿到 token 才能读写或释放输入输出，token 不匹配就不能操作。这样 SR 和 TTS 可以安全共享底层 I2S/codec，AudioService 不需要知道调用方是不是 AI。

### 9. 为什么 `turn_done` 后不立刻回 `LISTENING`？

`turn_done` 是云端说“这个 turn 的输出已经发完”，但设备本地下行 ringbuf 和 codec 里可能还有未播放完的 PCM。用户感知上仍处于 speaking，所以要等 TTSPlayer 播放 drained 后再回 `LISTENING`。

### 10. 显示 no-mem 崩溃是怎么解决的？

根因是 RLCD 发送缓冲在 PSRAM，SPI 发送时高负载下需要临时内部 DMA bounce buffer，AI/SR/Wi-Fi 并发时可能申请失败。解决方案是把 1bit 发送缓冲放到内部 DMA-capable 内存，并把 SPI 最大传输长度配置为真实 1bit buffer 大小。

### 11. 传感器、RTC、SD 失败时为什么不让 App 启动失败？

这些是增强能力，不是设备可用性的硬前提。SHTC3 缺失显示 `N/A`，RTC 无效可等 SNTP，SD 无卡显示不可用。这样某个外设异常不会拖垮 UI、配网和 AI 主链路。

### 12. 这个项目最能体现工程能力的点是什么？

不是简单把 ESP32 接上 WebSocket，而是把“异步硬件 + 实时音频 + 端云协议 + 用户交互”拆成清楚的 owner：AppCore 管产品编排，Session 管会话状态，SR 管语音事实，WebSocketTask 管传输，AudioService 管资源租约，Display 管屏幕刷新。

## 复习检查表

- 能一句话说清楚：设备侧是端云 AI 终端，不在本地跑 ASR/Agent/TTS。
- 能画出分层：Application -> Service -> Driver/HAL -> BSP。
- 能讲清启动流程：BSP、Display、AppCore、Services、AI Runtime、Home、后台任务、AppEvent loop。
- 能说明按键语义：BOOT 导航和 AI 入口，KEY 页面业务和播放期打断。
- 能背出 AI 主链路：Wake Prompt -> WakeNet -> Session Start -> wake_start -> LISTENING -> PCM -> turn_new -> output_text -> playback -> LISTENING。
- 能解释 `turn_new` 是强边界，旧 turn 消息必须丢弃。
- 能区分 `voice_input_open`、`audio_publish_enabled`、SR active、Voice Activity。
- 能讲清 AudioService token 模型，以及为什么不用业务 owner enum。
- 能讲清 WebSocket text frame 和 binary PCM 分离。
- 能讲清 `turn_done` 和本地 playback drained 的区别。
- 能讲清 KEY 打断为什么本地先停播，不等待 ACK。
- 能讲清 RLCD DMA buffer 从 PSRAM 改到内部 DMA 内存的原因。
- 能说明 SHTC3、RTC、SD 的降级策略。
- 能总结核心设计原则：上层做业务决策，下层做能力执行。

## 事实来源摘要

本文只根据设备侧仓库资料改写，没有复制源码文档原文。阅读来源包括：

- `README.md`：项目定位、仓库边界、当前能力、目录结构和工程亮点。
- `docs/ARCHITECTURE.md`：分层架构、启动流程、页面按键、AI Session 状态主线和错误处理策略。
- `docs/MODULES.md`：模块索引与推荐阅读路径。
- `docs/PROTOCOL.md`：`ai-session-ws/1` 协议、固定音频格式、上下行消息、turn 终止和安全边界。
- `components/app_application/APP_APPLICATION_MODULE.md`：AppCore、AppAIRuntime、事件流、Footer、按键业务和 UI 投影边界。
- `components/service/SERVICE_MODULE.md`：Service 层定位和子模块职责。
- `components/service/src/audio/AUDIO_SERVICE_MODULE.md`：AudioService token 租约、full-duplex 格式约束、snapshot 和并发模型。
- `components/service/src/sr/SR_SERVICE_MODULE.md`：Wake Detect、Voice Detect、Audio Publish、pre-roll/vad_cache 和 Session 门控边界。
- `components/service/src/session/SESSION_MODULE.md`：Session owner、状态模型、turn 边界、上行授权、下行播放和 turn terminate。
- `components/service/src/protocol/PROTOCOL_MODULE.md`：JSON 构建解析、媒体配置校验和协议错误边界。
- `components/service/src/websocket/WEBSOCKET_TASK_MODULE.md`：WebSocketTask 两状态 IO pump、queue/ringbuf 通道和维护约束。
- `components/service/src/player/PLAYER_MODULE.md`：TTSPlayer 从下行 ringbuf 播放 PCM、clear/stop 边界。
- `components/service/src/button/BUTTON_SERVICE_MODULE.md`：KEY/BOOT 事件模型和“事实事件”边界。
- `components/service/src/network/NETWORK_SERVICE_MODULE.md`：Wi-Fi STA、AP 配网、NVS 凭据、portal、snapshot 和异步命令队列。
- `components/service/src/sensor/SENSOR_SERVICE_MODULE.md`：SHTC3 snapshot、缺失降级、后台读取任务。
- `components/service/src/time/TIME_SERVICE_MODULE.md`：RTC/SNTP、系统时间基准、分钟级 UI 通知和网络断开策略。
- `components/service/src/sd/SD_SERVICE_MODULE.md`：SD 卡挂载策略和无卡/失败不阻塞 App。
- `components/display/DISPLAY_MODULE.md`：LVGL 到 RLCD 刷新链路、1bit DMA buffer、PSRAM no-mem 根因和修复。
- `components/bsp/BSP_MODULE.md`：BSP 作为板级硬件资源与引脚差异屏蔽层。
