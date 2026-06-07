---
title: ESP32-S3-RLCD 官方 Demo 学习路线
description: 面向零基础初学者，按 01-10 官方 ESP-IDF demo 学习 ESP32-S3-RLCD-4.2 的 Wi-Fi、ADC、I2C、SD、音频、LVGL 和综合测试。
---

这组文章把 Waveshare `ESP32-S3-RLCD-4.2-Demo/02_ESP-IDF` 下的 10 个 demo 拆成零基础学习笔记。目标不是背代码，而是先知道每个外设在做什么，再看 demo 如何初始化、运行和输出结果。

## 怎么阅读

建议按编号顺序读：

| 编号 | Demo | 学什么 |
| --- | --- | --- |
| 01 | [Wi-Fi AP](./wifi-ap/) | 让 ESP32 变成热点，理解 AP 模式。 |
| 02 | [Wi-Fi STA](./wifi-sta/) | 让 ESP32 连接路由器，理解 STA 模式和 IP 事件。 |
| 03 | [ADC Battery](./adc-battery/) | 读取电池电压，理解 ADC raw、校准和分压换算。 |
| 04 | [I2C PCF85063](./i2c-pcf85063/) | 读写 RTC 时间，理解 I2C 和实时时钟。 |
| 05 | [I2C SHTC3](./i2c-shtc3/) | 读取温湿度，理解 I2C 传感器。 |
| 06 | [SD Card](./sd-card/) | 挂载 SD 卡，理解 SDMMC、FATFS 和文件读写。 |
| 07 | [Audio Test](./audio-test/) | 播放/录制音频，理解 I2S、codec、PCM 和 PA。 |
| 08 | [LVGL v8](./lvgl-v8/) | 让屏幕显示 UI，理解 LVGL v8、flush 和生成代码。 |
| 09 | [LVGL v9](./lvgl-v9/) | 对比 LVGL v9，理解新版 UI 工程和图片格式。 |
| 10 | [Factory Program](./factory-program/) | 从出厂综合程序理解多外设集成。 |

## 学习主线

这 10 个 demo 可以按三层理解：

```text
连接能力：
  01 Wi-Fi AP
  02 Wi-Fi STA

硬件传感和存储：
  03 ADC Battery
  04 RTC
  05 SHTC3
  06 SD Card

交互和系统集成：
  07 Audio
  08 LVGL v8
  09 LVGL v9
  10 Factory Program
```

如果你后续回到 Pixel Soul 项目，这些 demo 对应的模块关系大致是：

| Demo 能力 | Pixel Soul 中的对应方向 |
| --- | --- |
| Wi-Fi AP/STA | `NetworkService`、配网、云端连接前置条件 |
| ADC Battery | `PowerService` 设计草案 |
| PCF85063 | `TimeService`、RTC/SNTP 时间基准 |
| SHTC3 | `SensorService` |
| SD Card | `SdService` |
| Audio | `AudioService`、`SRService`、`TTSPlayer` |
| LVGL | `display`、`app_ui` |
| Factory Program | 多 Service 集成和硬件 smoke 思路 |

## 读代码的方法

每个 demo 先找三个入口：

```text
main/
  app_main 或 main.cpp：程序从哪里开始。

components/*_bsp/
  板级封装：引脚、外设初始化、硬件读写。

components/user_app/
  demo 行为：循环读取、显示、播放、日志输出。
```

初学时不要一上来追所有库源码。先回答四个问题：

- 这个 demo 初始化了哪个外设？
- 用了哪些 GPIO、I2C、I2S、ADC 或 SDMMC 资源？
- 运行后串口或屏幕会看到什么？
- 这个能力在真实项目里应该封装成哪个 Service？

## 通用构建命令

在某个 demo 目录下进入 ESP-IDF PowerShell 后：

```powershell
idf.py build
idf.py -p COMx flash monitor
```

其中 `COMx` 替换成你设备实际串口。首次构建会下载依赖，耗时较长是正常现象。

## 补充阅读

- [Waveshare ESP32-S3-RLCD-4.2 资料页](https://docs.waveshare.com/ESP32-S3-RLCD-4.2)
- [ESP-IDF v5.5.3 编程指南](https://docs.espressif.com/projects/esp-idf/zh_CN/v5.5.3/esp32s3/index.html)
- [ESP-IDF 构建系统](https://docs.espressif.com/projects/esp-idf/zh_CN/v5.5.3/esp32s3/api-guides/build-system.html)
