---
title: 嵌入式面试八股文
description: 围绕当前简历技术栈整理嵌入式面试常见问题，按简历追问方式准备回答。
---

这个专栏用于准备嵌入式软件工程师面试。

它不是完整教材，而是围绕简历中的技术栈做“简历追问式”整理：面试官看到 `ESP32-S3 / ESP-IDF / FreeRTOS / 外设 / 音频 / WebSocket / LVGL / CAN / HIL` 后，可能会怎么问，以及应该如何回答。

## 简历技术栈地图

| 简历关键词 | 面试官可能关注 |
|---|---|
| ESP32-S3 / ESP-IDF / FreeRTOS | RTOS 调度、任务拆分、栈、队列、组件化工程 |
| I2C / SPI / I2S / UART / SDMMC | 外设接口差异、驱动调试、硬件联调经验 |
| 音频采集 / 播放 / Opus | PCM、码率、I2S、编解码、播放断续定位 |
| Wi-Fi / TCP / TLS / WebSocket | 设备联网、长连接、断线重连、binary 数据传输 |
| LVGL / SD 卡 / PSRAM | UI 刷新、资源外置、运行时内存和固件体积优化 |
| CAN / DBC / HIL / ECU-TEST | 汽车电子通信、故障注入、自动化测试、模型生成 |

## 推荐阅读顺序

1. [FreeRTOS 任务调度与实时性](./01-freertos-scheduling/)
2. [ESP-IDF 与嵌入式 C 工程开发](./02-esp-idf-embedded-c/)
3. [常见外设驱动：I2C / SPI / I2S / UART / SDMMC](./03-peripheral-drivers/)
4. [嵌入式音频链路：PCM / I2S / Opus / 多麦](./04-embedded-audio/)
5. [IoT 网络通信：Wi-Fi / TCP / TLS / WebSocket](./05-iot-network-websocket/)
6. [LVGL / SD 卡 / PSRAM / 固件资源优化](./06-ui-memory-resource/)
7. [CAN / DBC / HIL / ECU-TEST / MATLAB Simulink](./07-can-hil-automotive/)
8. [简历项目综合追问：模块边界、TDD/SDD/DDD、问题定位](./08-project-deep-dive/)

## 使用方式

每篇文章都按同一种方式组织：

```text
面试官为什么问
-> 高频问题
-> 短答
-> 展开回答
-> 结合我的项目
-> 继续追问
-> 易错回答
-> 30 秒总结
```

准备时不要死背概念。更好的方式是把每个问题落到自己的项目：

```text
我在项目中怎么设计模块？
遇到过什么问题？
如何定位？
如何验证？
如果重做会怎么优化？
```

