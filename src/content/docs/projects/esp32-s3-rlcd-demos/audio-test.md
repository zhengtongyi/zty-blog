---
title: ESP32-S3-RLCD-4.2 Audio Test 零基础教程
description: 从 I2S、codec、PA、PCM、录音和播放流程开始，读懂 Waveshare ESP32-S3-RLCD-4.2 Audio Test 示例。
---

## 一句话目标

把 `07_Audio_Test` 跑起来，并看懂“按键触发 -> 录音或播放 -> I2S/codec/PA 完成音频输入输出”的完整链路。

## 先懂概念

零基础先记住一句话：声音在程序里不是“声音”，而是一串数字。

- `PCM`：最原始、最容易理解的音频数字数据。比如这个示例里内置了 `canon.pcm`，程序把它当作一段已经准备好的声音数据来播放。
- 录音：麦克风把空气振动变成电信号，`ES7210` 这类 ADC/codec 芯片把电信号变成 PCM 数字数据，ESP32-S3 再读进内存。
- 播放：ESP32-S3 把 PCM 数字数据送出去，`ES8311` 这类 codec 芯片把数字数据变成模拟音频，再经过功放或扬声器输出。
- `I2S`：专门传音频数据的总线。你可以把它理解成 ESP32-S3 和音频 codec 之间的“数字音频传送带”。
- `codec`：音频编解码芯片，这个 demo 里用 `ES8311` 负责播放输出，用 `ES7210` 负责麦克风录音输入。
- `PA`：功放，负责把 codec 输出的音频信号放大到能推动喇叭的程度。程序通常不会直接“播放到喇叭”，而是控制 codec，再由板载音频电路把声音送到喇叭接口。

## 硬件/代码入口

示例工程在：

```text
D:\Tools\ESP-IDF\ESP32-S3-RLCD-4.2-Demo\ESP32-S3-RLCD-4.2-Demo\02_ESP-IDF\07_Audio_Test
```

最重要的入口文件：

- `main/main.cpp`：初始化应用、RLCD、LVGL UI，然后创建任务。
- `components/user_app/user_app.cpp`：音频测试的主业务流程，按键事件、录音、播放都在这里串起来。
- `components/port_bsp/codec_bsp.cpp`：封装 codec 的读写、音量、麦克风增益、PCM 数据入口。
- `components/port_bsp/button_bsp.c`：配置 `BOOT` 和 `KEY(GPIO18)` 两个按键。
- `components/port_bsp/pcm/canon.pcm`：内置 PCM 音频资源。

硬件上需要关注：

- `BOOT` 按键：GPIO0。
- `KEY` 按键：GPIO18。
- I2C 总线：源码里创建了 `I2cMasterBus I2cbus(14,13,0)`，用于访问音频 codec 的控制寄存器。
- codec 地址：`ES8311` 地址是 `0x18`，`ES7210` 地址是 `0x40`。
- 屏幕：RLCD 通过 `DisplayPort RlcdPort(12,11,5,40,41,LCD_WIDTH,LCD_HEIGHT)` 初始化，用来显示当前状态。

## 运行现象

烧录后，屏幕会显示一个简单状态界面，英文状态会在这些值之间变化：

- `IDLE`：等待操作。
- `Recording...`：正在录音。
- `Rec Done`：录音完成。
- `Playing...`：正在播放录音。
- `Play Music`：正在播放内置 PCM 音乐。
- `Play Done`：播放完成。

按键动作来自源码里的事件绑定：

- `BOOT` 单击：触发播放录音。
- `BOOT` 双击：触发录音。
- `KEY(GPIO18)` 单击：停止内置音乐播放。
- `KEY(GPIO18)` 双击：播放内置 `canon.pcm`。

如果你刚上电还没有录过音，直接按 `BOOT` 单击通常不会听到录音回放，因为程序只有在录音完成后才允许播放录音缓存。

## 核心流程

这个 demo 的业务主线可以这样读：

```text
app_main
-> UserApp_AppInit
-> 初始化按键、I2C、codec、音频缓存
-> 初始化 RLCD 和 LVGL UI
-> UserApp_TaskInit
-> BOOT/KEY 任务等待按键
-> Codec_LoopTask 根据事件录音、播放录音或播放内置 PCM
```

再拆成音频链路：

```text
录音：麦克风 -> ES7210 -> I2S -> ESP32-S3 -> PSRAM 缓存
播放录音：PSRAM 缓存 -> ESP32-S3 -> I2S -> ES8311 -> PA/喇叭
播放内置音乐：canon.pcm -> ESP32-S3 -> I2S -> ES8311 -> PA/喇叭
```

这就是初学者最应该先看懂的部分：按键不直接录音，按键只是设置事件；真正录音和播放由 `Codec_LoopTask` 统一处理。

## 关键代码讲解

`UserApp_AppInit()` 做准备工作：

```cpp
audio_ptr = heap_caps_malloc(AUDIO_BUFFER_SIZE, MALLOC_CAP_SPIRAM);
CodecGroups = xEventGroupCreate();
Custom_ButtonInit();
```

这段说明三件事：音频缓存放在 PSRAM，音频动作通过 FreeRTOS 事件组传递，按键初始化单独封装在 `button_bsp.c`。

codec 初始化也在 `UserApp_AppInit()`：

```cpp
codecport = new CodecPort(I2cbus, "S3_RLCD_4_2");
codecport->CodecPort_SetInfo("es8311 & es7210", 1, 16000, 2, 16);
codecport->CodecPort_SetSpeakerVol(100);
codecport->CodecPort_SetMicGain(35);
```

这里的 `16000, 2, 16` 分别表示 16 kHz 采样率、双声道、16 bit 采样位宽。对零基础来说，可以先理解为“音频格式必须前后一致”：录音、播放、PCM 数据格式对不上，就容易变速、噪声或无声。

`BOOT_LoopTask()` 不直接播放，它只把用户意图翻译成事件：

```cpp
CODEC_BIT_PLAY
CODEC_BIT_RECORD
```

`KEY_LoopTask()` 负责内置音乐：

```cpp
is_Music = true;
xEventGroupSetBits(CodecGroups, CODEC_BIT_MUSIC);
```

真正干活的是 `Codec_LoopTask()`：

- 收到 `CODEC_BIT_RECORD`：调用 `CodecPort_EchoRead(audio_ptr, AUDIO_BUFFER_SIZE)`，把录音读到 PSRAM。
- 收到 `CODEC_BIT_PLAY`：调用 `CodecPort_PlayWrite(audio_ptr, AUDIO_BUFFER_SIZE)`，把刚才录到的数据写给播放端。
- 收到 `CODEC_BIT_MUSIC`：通过 `CodecPort_GetPcmData()` 找到内置 `canon.pcm`，每次写 `256` 字节给播放端。

底层 `codec_bsp.cpp` 把 codec 读写压缩成两个很直观的动作：

```cpp
esp_codec_dev_read(record, ptr, ptr_len);
esp_codec_dev_write(playback, ptr, ptr_len);
```

所以你可以把它理解成：

- `read(record)`：从麦克风链路拿 PCM。
- `write(playback)`：把 PCM 送到喇叭链路。

## 动手改一改

建议从最安全的参数开始改：

1. 改播放音量  
   在 `UserApp_AppInit()` 里把 `DEFAULT_SPEAKER_VOL` 从 `100` 改成 `60` 或 `80`，重新烧录后听音量变化。

2. 改麦克风增益  
   把 `DEFAULT_MIC_GAIN` 从 `35` 改小一点，例如 `25`。如果录音太小再逐步调大。

3. 改录音时长  
   `AUDIO_BUFFER_SIZE` 是录音缓存大小。当前是 `288 * 1000` 字节。缓存越大，能录的 PCM 越多，但占用 PSRAM 也越多。

4. 换内置 PCM  
   `canon.pcm` 通过 `EMBED_FILES "./pcm/canon.pcm"` 编进固件。如果替换文件，要尽量保持采样率、声道数、位宽和程序设置一致。

每次只改一个变量，烧录验证一次。这样最容易知道是哪一个参数影响了结果。

## 常见坑

- 没声音：先确认喇叭接在板子的 speaker 接口，音量没有被调太低，再看串口日志有没有 codec 初始化错误。
- 录音回放没声音：先双击 `BOOT` 录音，看到 `Rec Done` 后再单击 `BOOT` 播放。
- 播放很快、很慢或全是噪声：重点检查 PCM 的采样率、声道、位宽是否和 `CodecPort_SetInfo()` 一致。
- 按键没反应：源码里 `BOOT` 是 GPIO0，`KEY` 是 GPIO18，并且使用上拉输入、低电平有效；外接按键时不要和板载按键逻辑打架。
- 内存不足或崩溃：录音缓存放在 PSRAM，确认板子和工程配置启用了 PSRAM。
- UI 中文乱码：源码里的中文字符串在当前查看环境下显示为乱码，但英文状态仍然可以用于判断流程。

## 和 Pixel Soul 项目的关系

Pixel Soul 如果要做“会听、会说、有表情反馈”的桌面设备，这个 Audio Test 是最基础的音频链路样板。

它能帮你验证三件底层能力：

- 麦克风是否能稳定采集 PCM。
- 喇叭链路是否能稳定播放 PCM。
- 按键或 UI 事件是否能触发音频动作。

后续接入语音唤醒、语音识别或 TTS 时，业务会复杂很多，但底层仍然离不开这条链路：

```text
采集 PCM -> 送给语音算法或云端 -> 得到回复音频 -> 播放 PCM
```

所以不要急着一上来接大模型，先用这个 demo 把“录得到、播得出、事件能触发”跑稳。

## 补充阅读

- [ESP-IDF v5.5.3 I2S 文档](https://docs.espressif.com/projects/esp-idf/en/v5.5.3/esp32s3/api-reference/peripherals/i2s.html)
- [ESP-IDF v5.5.3 GPIO 文档](https://docs.espressif.com/projects/esp-idf/en/v5.5.3/esp32s3/api-reference/peripherals/gpio.html)
- [Waveshare ESP32-S3-RLCD-4.2 官方资料](https://docs.waveshare.com/ESP32-S3-RLCD-4.2/)
- [LVGL v8 Display porting 文档](https://docs.lvgl.io/8.3/porting/display.html)
