---
title: 厦门嵌入式市场与方向判断
description: 结合岗位关键词看厦门嵌入式市场，更适合走 MCU/RTOS、Linux 网关，还是纯 Linux 驱动。
---

## 先给结论

如果目标是结合当前经历尽快提高面试匹配度，厦门更适合走这条线：

```text
RTOS 设备端 + Linux 平台补齐
偏 IoT 通信 / 音频链路 / 网关 / 边缘设备
```

不建议直接把目标切成：

```text
纯 Linux 内核驱动工程师
```

## 为什么不是直接硬切 Linux 驱动

因为这条路当然有岗位，但它对“真实驱动经验”的要求更硬，常见描述会直接写：

- `Linux 驱动开发`
- `设备树 DTS`
- `U-Boot`
- `内核裁剪`
- `USB / Camera / LCD / Wi-Fi / BT 驱动`
- `BSP bring-up`

这类岗位如果没有完整平台经验，面试会比较吃亏。你现在最强的还是：

- `ESP32-S3 / ESP-IDF / FreeRTOS`
- `I2C / SPI / I2S / UART / SDMMC`
- `音频采集 / 播放 / Opus / WebSocket`
- `LVGL / SD 卡 / PSRAM`
- `CAN / HIL`

所以更好的做法不是推翻重来，而是在原有主线上补 Linux。

## 厦门市场更现实的三类方向

### 1. MCU / RTOS / IoT 类

这类岗位通常会要：

- `ESP32 / STM32 / GD32`
- `FreeRTOS`
- `Wi-Fi / BLE / MQTT / TCP/IP`
- `LVGL`
- `外设驱动`

这类是你当前最容易匹配的。

### 2. Linux 应用 / 网关 / 边缘计算类

这类岗位更适合你升级后的方向，关键词常见为：

- `嵌入式 Linux`
- `Buildroot / Yocto`
- `WebSocket / MQTT / HTTP`
- `设备接入 / 网关 / 边缘计算`
- `串口 / RS485 / CAN / Modbus`
- `音视频 / ALSA / 网络传输`

这个方向的好处是，你现有的音频链路、协议状态机、网络传输经验都能迁移过去。

### 3. 纯 BSP / 内核驱动类

这类更偏平台底层，适合作为中长期补强，但不建议现在把它作为唯一求职方向。

## 所以我该怎么调整自己的人设

不要把自己讲成：

```text
我主要做 AI 语音助手
```

而要逐渐讲成：

```text
我主要做嵌入式设备侧通信与音频链路，
擅长 RTOS 多任务、外设驱动、网络传输、WebSocket 长连接、
编码解码与播放链路，以及设备到云端的协议集成。
下一步在补 Linux 平台和网关侧能力。
```

这样对 HR 和技术面都更友好。

## 这条路线的简历价值

它能覆盖更多岗位关键词：

- `ESP32`
- `FreeRTOS`
- `I2C / SPI / I2S / UART`
- `TCP/IP / MQTT / HTTP / WebSocket`
- `音频采集与播放`
- `Linux`
- `Buildroot`
- `ALSA`
- `网关 / 边缘设备`

## 接下来最值得做的事

如果只做一件对求职最有帮助的升级，我建议是：

```text
把当前 ESP32 语音链路项目升级成
“ESP32 终端 + Linux 网关”的双平台项目
```

这样你会比“再堆一个纯开发板实验项目”更像真实岗位需要的人。
