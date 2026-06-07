---
title: ESP32-S3-RLCD Audio Test 示例拆解
description: 从 PCM、I2S、ES8311/ES7210、PA、PSRAM 缓冲和按键事件入手，读懂 07_Audio_Test 的录音与播放链路。
---

## 一句话定位

`07_Audio_Test` 演示开发板的音频输入输出能力：按键触发录音、回放录音或播放内置 PCM，底层通过 I2S 和 ES8311/ES7210 codec 完成音频链路。

## 基础原理

声音在程序里通常表现为一串 PCM 数据。PCM 可以理解为“按固定采样率和位宽记录下来的声音数字样本”。

本 demo 有三条链路：

```text
录音：
  麦克风 -> ES7210 -> I2S -> ESP32-S3 -> PSRAM 缓冲

播放录音：
  PSRAM 缓冲 -> ESP32-S3 -> I2S -> ES8311 -> PA/喇叭

播放内置音乐：
  canon.pcm -> ESP32-S3 -> I2S -> ES8311 -> PA/喇叭
```

需要区分几个概念：

| 名词 | 含义 |
| --- | --- |
| I2S | 数字音频总线，负责在 ESP32-S3 和 codec 之间传 PCM。 |
| codec | 音频编解码/转换芯片，负责模拟音频和数字 PCM 的转换。 |
| ES7210 | 本板上用于麦克风录音输入的音频 ADC/codec。 |
| ES8311 | 本板上用于播放输出的音频 codec。 |
| PA | 功放，把输出信号放大到能推动喇叭。 |
| PSRAM | 外部 RAM，用来放较大的录音缓冲。 |

## 硬件与工程入口

源码阅读入口：

```text
02_ESP-IDF/07_Audio_Test/main/main.cpp
02_ESP-IDF/07_Audio_Test/components/user_app/user_app.cpp
02_ESP-IDF/07_Audio_Test/components/port_bsp/codec_bsp.cpp
02_ESP-IDF/07_Audio_Test/components/port_bsp/button_bsp.c
02_ESP-IDF/07_Audio_Test/components/port_bsp/pcm/canon.pcm
```

关键配置：

| 项目 | 配置 |
| --- | --- |
| codec board type | `"S3_RLCD_4_2"` |
| 播放 codec | ES8311 |
| 录音 codec | ES7210 |
| I2S 模式 | `CODEC_I2S_MODE_TDM` |
| 采样率 | `16000 Hz` |
| 声道 | `2` |
| 位宽 | `16 bit` |
| 录音缓冲 | `288 * 1000` bytes，PSRAM |
| 内置 PCM | `components/port_bsp/pcm/canon.pcm` |
| 音乐播放块大小 | `256` bytes |
| 默认扬声器音量 | `100` |
| 默认麦克风增益 | `35` |
| BOOT | GPIO0 |
| KEY | GPIO18 |

## 关键流程总图

```text
app_main()
  -> UserApp_AppInit()
      -> heap_caps_malloc(288 KB PSRAM audio buffer)
      -> xEventGroupCreate()
      -> Custom_ButtonInit()
      -> new CodecPort(I2cbus, "S3_RLCD_4_2")
      -> CodecPort_SetInfo("es8311 & es7210", 1, 16000, 2, 16)
      -> CodecPort_SetSpeakerVol(100)
      -> CodecPort_SetMicGain(35)
  -> RlcdPort.RLCD_Init()
  -> Lvgl_PortInit(400, 300, Lvgl_FlushCallback)
  -> UserApp_UiInit()
  -> UserApp_TaskInit()
      -> BOOT_LoopTask
      -> KEY_LoopTask
      -> Codec_LoopTask
```

运行时事件流：

```text
BOOT 单击
  -> CODEC_BIT_PLAY
  -> CodecPort_PlayWrite(audio_ptr)

BOOT 双击
  -> CODEC_BIT_RECORD
  -> CodecPort_EchoRead(audio_ptr)

KEY 双击
  -> CODEC_BIT_MUSIC
  -> CodecPort_GetPcmData()
  -> 每次 CodecPort_PlayWrite(256 bytes)

KEY 单击
  -> stop music flag
```

## 关键方法速查

| 函数/方法 | 所在文件 | 作用 | 初学者需要理解的点 |
| --- | --- | --- | --- |
| `app_main()` | `main/main.cpp` | 串起应用、屏幕、LVGL、任务初始化。 | 音频 demo 同时带 UI，不只是串口程序。 |
| `UserApp_AppInit()` | `components/user_app/user_app.cpp` | 分配音频缓冲、初始化按键和 codec。 | 大块音频缓冲放 PSRAM。 |
| `Custom_ButtonInit()` | `components/port_bsp/button_bsp.c` | 初始化 BOOT/KEY 按键。 | 按键只产生事件，不直接录音播放。 |
| `CodecPort` | `components/port_bsp/codec_bsp.cpp` | 封装 ES8311/ES7210 音频设备。 | 上层不用直接操作 codec 寄存器。 |
| `CodecPort_SetInfo()` | `components/port_bsp/codec_bsp.cpp` | 设置采样率、声道、位宽等音频格式。 | 格式必须和 PCM 数据匹配。 |
| `CodecPort_SetSpeakerVol()` | `components/port_bsp/codec_bsp.cpp` | 设置播放音量。 | 音量过大可能失真，过小可能听不清。 |
| `CodecPort_SetMicGain()` | `components/port_bsp/codec_bsp.cpp` | 设置麦克风增益。 | 增益影响录音响度和噪声。 |
| `BOOT_LoopTask()` | `components/user_app/user_app.cpp` | 把 BOOT 操作变成录音/播放事件。 | 输入事件和音频执行分离。 |
| `KEY_LoopTask()` | `components/user_app/user_app.cpp` | 控制内置音乐播放和停止。 | KEY 双击播放，单击停止。 |
| `Codec_LoopTask()` | `components/user_app/user_app.cpp` | 等待事件并执行录音、回放、播放 PCM。 | 音频动作统一集中在一个任务。 |
| `esp_codec_dev_read()` | codec driver | 从录音设备读取 PCM。 | 录音本质是读 PCM buffer。 |
| `esp_codec_dev_write()` | codec driver | 向播放设备写 PCM。 | 播放本质是写 PCM buffer。 |

## 关键代码讲解

音频初始化先分配大缓冲：

```cpp
audio_ptr = heap_caps_malloc(AUDIO_BUFFER_SIZE, MALLOC_CAP_SPIRAM);
```

录音数据比较大，放在内部 SRAM 容易占满内存，所以 demo 明确使用 PSRAM。随后创建事件组：

```cpp
CodecGroups = xEventGroupCreate();
```

按键任务不直接调用录音函数，而是设置事件位。这样做的好处是输入事件和音频执行解耦：按键任务保持轻量，真正耗时的读写由 `Codec_LoopTask()` 处理。

codec 初始化设置了音频格式：

```cpp
CodecPort_SetInfo("es8311 & es7210", 1, 16000, 2, 16);
```

读者需要重点记住：采样率、声道数、位宽必须和 PCM 数据一致。不一致时常见现象是声音变速、噪声或完全无声。

录音和播放最终都落到底层读写：

```cpp
esp_codec_dev_read(record, ptr, ptr_len);
esp_codec_dev_write(playback, ptr, ptr_len);
```

因此音频主线可以抽象为：

```text
record read  -> 得到 PCM
playback write -> 输出 PCM
```

## 实验现象

屏幕会显示音频状态，例如等待、录音、录音完成、播放、播放完成、播放内置音乐等。

按键行为：

| 操作 | 作用 |
| --- | --- |
| BOOT 双击 | 录音到 PSRAM 缓冲。 |
| BOOT 单击 | 播放刚才录到的内容。 |
| KEY 双击 | 播放内置 `canon.pcm`。 |
| KEY 单击 | 停止内置音乐播放。 |

如果刚上电还没有录音，直接 BOOT 单击通常不会有有效回放。

## 常见问题

| 现象 | 可能原因 | 排查方式 |
| --- | --- | --- |
| 完全没声音 | 喇叭、PA、音量或 codec 初始化问题。 | 先播放内置 PCM，再排查录音。 |
| 录音回放没声音 | 没有先录音或麦克风增益太低。 | 先 BOOT 双击录音，再 BOOT 单击播放。 |
| 播放变速或噪声 | PCM 格式不匹配。 | 检查采样率、声道、位宽。 |
| 按键无反应 | 按键事件没触发或 GPIO 不匹配。 | 查看 BOOT GPIO0、KEY GPIO18。 |
| 内存不足 | PSRAM 未启用或缓冲过大。 | 确认工程 PSRAM 配置。 |
| 状态文字异常 | 源码中部分中文可能受编码影响。 | 以英文状态和实际音频现象判断流程。 |

## 工程迁移思路

真实语音产品可以把本 demo 拆成三个服务能力：

```text
ButtonService
  -> 产生 BOOT/KEY 单击、双击等事件

AudioService
  -> 管理 codec、I2S、音量、麦克风增益、播放资源

TTS/SR 上层模块
  -> 读取麦克风 PCM
  -> 写入 TTS PCM
```

不要让业务状态机直接操作 `esp_codec_dev_read/write`。底层音频服务负责“读写 PCM”，上层负责“什么时候录、什么时候播、是否打断”。

## 补充阅读

- [ESP-IDF I2S Driver](https://docs.espressif.com/projects/esp-idf/zh_CN/v5.5.3/esp32s3/api-reference/peripherals/i2s.html)
- [ESP-IDF GPIO Driver](https://docs.espressif.com/projects/esp-idf/zh_CN/v5.5.3/esp32s3/api-reference/peripherals/gpio.html)
- [Waveshare ESP32-S3-RLCD-4.2 资料页](https://docs.waveshare.com/ESP32-S3-RLCD-4.2)
