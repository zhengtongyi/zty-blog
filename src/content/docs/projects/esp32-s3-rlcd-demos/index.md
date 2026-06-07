---
title: ESP32-S3-RLCD 官方 Demo 拆解路线
description: 面向刚接触 ESP-IDF 与 ESP32-S3-RLCD-4.2 的读者，按官方 01-10 demo 梳理 Wi-Fi、ADC、I2C、SD、音频、LVGL 和综合测试。
---

这组文章基于 Waveshare `ESP32-S3-RLCD-4.2-Demo/02_ESP-IDF` 中的 10 个 ESP-IDF 示例。写作目标不是逐行翻译源码，而是把每个 demo 拆成公开读者更容易理解的结构：

```text
基础概念 -> 硬件资源 -> 代码入口 -> 关键流程 -> 关键方法 -> 实验现象 -> 常见问题 -> 工程迁移
```

公开教程常见的价值在于“先搭框架，再进代码”。因此这里会先说明某个外设解决什么问题、板子用了哪些资源，再看 `app_main()` 如何一路调用到 BSP 或驱动 API。读者即使没有接触过 ESP32-S3，也能先知道应该从哪里读起。

## 阅读顺序

建议按编号阅读。前两个 demo 先解决联网概念，中间四个 demo 训练外设读写，后面四个 demo 进入音频、显示和系统集成。

| 编号 | Demo | 学习重点 |
| --- | --- | --- |
| 01 | [Wi-Fi AP](./wifi-ap/) | 让开发板创建热点，理解 AP 模式、网络接口和 Wi-Fi 事件。 |
| 02 | [Wi-Fi STA](./wifi-sta/) | 让开发板连接路由器，理解 STA 模式、连接事件和 IP 事件。 |
| 03 | [ADC Battery](./adc-battery/) | 从 ADC 原始值换算电池电压，理解校准、分压和百分比估算。 |
| 04 | [I2C PCF85063](./i2c-pcf85063/) | 读写 RTC 时间，理解 I2C 主机、设备地址和寄存器封装。 |
| 05 | [I2C SHTC3](./i2c-shtc3/) | 读取温湿度，理解传感器唤醒、测量命令、CRC 校验。 |
| 06 | [SD Card](./sd-card/) | 挂载 SD 卡，理解 SDMMC、FATFS、文件读写和挂载点。 |
| 07 | [Audio Test](./audio-test/) | 录音和播放 PCM，理解 I2S、codec、PA、PSRAM 音频缓存。 |
| 08 | [LVGL v8](./lvgl-v8/) | 移植 LVGL v8 到反射式屏幕，理解 draw buffer、flush callback。 |
| 09 | [LVGL v9](./lvgl-v9/) | 对比 LVGL v9 显示注册方式，理解新版 display API。 |
| 10 | [Factory Program](./factory-program/) | 综合测试多外设，理解任务拆分、事件组、UI 状态展示。 |

## Demo 目录结构

文章中统一使用公开相对路径，不使用任何个人电脑上的绝对路径。源码根目录按如下方式表示：

```text
ESP32-S3-RLCD-4.2-Demo/
  02_ESP-IDF/
    01_WIFI_AP/
    02_WIFI_STA/
    03_ADC_Test/
    04_I2C_PCF85063/
    05_I2C_SHTC3/
    06_SD_Card/
    07_Audio_Test/
    08_LVGL_V8_Test/
    09_LVGL_V9_Test/
    10_FactoryProgram/
```

每个工程通常有三类入口：

| 目录 | 作用 |
| --- | --- |
| `main/` | ESP-IDF 程序入口，通常从 `app_main()` 开始。 |
| `components/user_app/` | 示例业务层，负责创建任务、循环读取、更新界面或触发动作。 |
| `components/*_bsp/` / `components/port_bsp/` | 板级支持层，封装引脚、总线、外设初始化和硬件读写。 |

## 学习主线

10 个 demo 可以按三层理解：

```text
联网能力：
  Wi-Fi AP
  Wi-Fi STA

硬件观测与存储：
  ADC Battery
  PCF85063 RTC
  SHTC3 Sensor
  SD Card

交互与系统集成：
  Audio Test
  LVGL v8
  LVGL v9
  Factory Program
```

对于真实产品，demo 不能直接当架构照搬。更合理的迁移方式是把“硬件能力”封装成服务，把“页面和业务”放在应用层。例如：

| Demo 能力 | 真实工程中的常见抽象 |
| --- | --- |
| Wi-Fi AP/STA | 网络服务、配网入口、连接状态 snapshot。 |
| ADC Battery | 电源服务、电量百分比、电池状态图标。 |
| PCF85063 | 时间服务、RTC/SNTP 校时、离线时间基准。 |
| SHTC3 | 传感器服务、温湿度 snapshot、可选硬件降级。 |
| SD Card | 存储服务、资源加载、日志或缓存读写。 |
| Audio | 音频服务、录音、播放、TTS/SR 的底层能力。 |
| LVGL | UI 端口、页面渲染、状态展示。 |
| Factory Program | 硬件 smoke test、集成测试、产线自检思路。 |

## 通用构建方式

进入某个 demo 工程目录后，在 ESP-IDF 环境中执行：

```powershell
idf.py build
idf.py -p COMx flash monitor
```

`COMx` 替换为实际串口号。首次构建会下载依赖并生成 `managed_components/`，耗时较长是正常现象。

## 读源码的顺序

建议每个 demo 都按同一套问题阅读：

1. `app_main()` 调用了谁？
2. demo 初始化了哪条总线或哪个外设？
3. 用了哪些 GPIO、ADC channel、I2C 地址、I2S/SDMMC 资源？
4. 运行后串口、屏幕、喇叭或文件系统有什么现象？
5. 哪些代码是板级硬件封装，哪些代码是 demo 业务逻辑？
6. 如果迁移到产品，哪些内容应该留在服务层，哪些内容应该交给 UI 或业务层？

## 补充阅读

- [Waveshare ESP32-S3-RLCD-4.2 资料页](https://docs.waveshare.com/ESP32-S3-RLCD-4.2)
- [ESP-IDF v5.5.3 编程指南](https://docs.espressif.com/projects/esp-idf/zh_CN/v5.5.3/esp32s3/index.html)
- [ESP-IDF 构建系统](https://docs.espressif.com/projects/esp-idf/zh_CN/v5.5.3/esp32s3/api-guides/build-system.html)
