---
title: ESP32-S3-RLCD FactoryProgram 综合测试拆解
description: 从出厂测试思路、硬件初始化、FreeRTOS 任务、事件组和 UI 结果展示入手，读懂 10_FactoryProgram 如何集成多外设。
---

## 一句话定位

`10_FactoryProgram` 是综合硬件测试程序，不是正式产品应用。它把 Wi-Fi、BLE、SD、ADC、RTC、SHTC3、音频、按键、LVGL 和 RLCD 串起来，用来快速验证开发板主要硬件能力是否工作。

## 基础原理

出厂测试程序像一张硬件体检表。它关心的是：

```text
屏幕能不能显示
SD 卡能不能读写
Wi-Fi 能不能扫描
BLE 能不能扫描
音频能不能录放
RTC 能不能读写
温湿度能不能读取
电池 ADC 能不能采样
按键能不能触发事件
```

它和产品应用的目标不同：

| 类型 | 目标 | 特点 |
| --- | --- | --- |
| FactoryProgram | 快速覆盖硬件测试项。 | 多任务、多模块并列，偏验证。 |
| 产品应用 | 长期稳定运行并提供用户体验。 | 需要清晰状态机、错误恢复、资源管理。 |

因此阅读 FactoryProgram 时，不要一上来追所有底层代码，而要先看“初始化了哪些模块、创建了哪些任务、每个任务验证什么”。

## 硬件与工程入口

源码阅读入口：

```text
02_ESP-IDF/10_FactoryProgram/main/main.cpp
02_ESP-IDF/10_FactoryProgram/components/user_app/user_app.cpp
02_ESP-IDF/10_FactoryProgram/components/app_bsp/esp_wifi_bsp.c
02_ESP-IDF/10_FactoryProgram/components/app_bsp/ble_scan_bsp.c
02_ESP-IDF/10_FactoryProgram/components/port_bsp/codec_bsp.cpp
02_ESP-IDF/10_FactoryProgram/components/port_bsp/sdcard_bsp.cpp
02_ESP-IDF/10_FactoryProgram/components/port_bsp/adc_bsp.cpp
02_ESP-IDF/10_FactoryProgram/components/port_bsp/i2c_equipment.cpp
02_ESP-IDF/10_FactoryProgram/components/ui_bsp/generated/
```

关键硬件事实：

| 模块 | 配置 |
| --- | --- |
| LVGL | v8.4，`400 x 300` RLCD |
| RLCD | GPIO12 MOSI、GPIO11 SCK、GPIO5 DC、GPIO40 CS、GPIO41 RST |
| I2C | SCL GPIO14、SDA GPIO13、port 0 |
| RTC | PCF85063，地址 `0x51` |
| SHTC3 | 地址 `0x70` |
| ADC | `ADC_UNIT_1 / ADC_CHANNEL_3`，电池分压采样 |
| SD | `/sdcard`，写读 `/sdcard/sdcard.txt` |
| Audio | ES8311 + ES7210，16 kHz、2 channels、16 bit |
| Wi-Fi | STA 模式，扫描 AP 数量 |
| BLE | active scan，扫描 3 秒，统计设备数量 |
| 按键 | BOOT、KEY(GPIO18) |

## 关键流程总图

```text
app_main()
  -> UserApp_AppInit()
      -> 分配 PSRAM 音频缓冲
      -> new CustomSDPort("/sdcard")
      -> Adc_PortInit()
      -> Custom_ButtonInit()
      -> Rtc_Setup(&I2cbus, 0x51)
      -> Rtc_SetTime(2026, 1, 5, 14, 30, 30)
      -> new Shtc3Port(I2cbus)
      -> espwifi_init()
      -> xEventGroupCreate()
      -> new CodecPort(I2cbus, "S3_RLCD_4_2")
      -> CodecPort_SetInfo("es8311 & es7210", 1, 16000, 2, 16)
      -> CodecPort_SetSpeakerVol(100)
      -> CodecPort_SetMicGain(35)
  -> RlcdPort.RLCD_Init()
  -> Lvgl_PortInit(400, 300, Lvgl_FlushCallback)
  -> UserApp_UiInit()
  -> UserApp_TaskInit()
      -> Lvgl_Cont1Task
      -> Lvgl_UserTask
      -> Lvgl_SDcardTask
      -> Lvgl_WfifBleScanTask
      -> BOOT_LoopTask
      -> KEY_LoopTask
      -> Codec_LoopTask
```

任务视角：

```text
Lvgl_UserTask
  -> 更新电池、RTC、温湿度

Lvgl_SDcardTask
  -> 写入 sdcard.txt
  -> 读回比较
  -> UI 显示 passed/failed/No Card

Lvgl_WfifBleScanTask
  -> 等 Wi-Fi 扫描 AP
  -> 释放 Wi-Fi
  -> 启动 BLE 扫描
  -> UI 显示数量

BOOT/KEY task
  -> 页面切换或设置音频事件

Codec_LoopTask
  -> 根据事件录音、播放录音、播放 PCM
```

## 关键方法速查

| 函数/方法 | 所在文件 | 作用 | 初学者需要理解的点 |
| --- | --- | --- | --- |
| `app_main()` | `main/main.cpp` | 串起综合程序启动顺序。 | 入口展示了“先服务，再 UI，再任务”。 |
| `Lvgl_FlushCallback()` | `main/main.cpp` | LVGL 像素转黑白并刷新 RLCD。 | FactoryProgram 仍使用 LVGL v8 风格 callback。 |
| `UserApp_AppInit()` | `components/user_app/user_app.cpp` | 初始化 SD、ADC、按键、RTC、SHTC3、Wi-Fi、codec。 | 这是硬件能力集合点。 |
| `UserApp_UiInit()` | `components/user_app/user_app.cpp` | 创建 generated UI。 | UI 对象初始化和硬件初始化分开。 |
| `UserApp_TaskInit()` | `components/user_app/user_app.cpp` | 创建各测试任务。 | 不同测试项由不同任务负责。 |
| `Lvgl_UserTask()` | `components/user_app/user_app.cpp` | 周期更新电池、时间、温湿度。 | 传感器结果最终写到 UI label。 |
| `Lvgl_SDcardTask()` | `components/user_app/user_app.cpp` | SD 写读一致性测试。 | 出厂测试重在验证“能写能读”。 |
| `Lvgl_WfifBleScanTask()` | `components/user_app/user_app.cpp` | Wi-Fi/BLE 扫描并显示数量。 | 注意 Wi-Fi 释放后再启 BLE。 |
| `BOOT_LoopTask()` / `KEY_LoopTask()` | `components/user_app/user_app.cpp` | 处理按键事件。 | 按键事件既切页面，也控制音频。 |
| `Codec_LoopTask()` | `components/user_app/user_app.cpp` | 统一处理录音、回放、播放音乐。 | 音频动作通过事件组触发。 |
| `espwifi_init()` | `components/app_bsp/esp_wifi_bsp.c` | 初始化 STA 并扫描 AP。 | 这里不是正式联网流程。 |
| `ble_scan_start()` | `components/app_bsp/ble_scan_bsp.c` | 启动 BLE 扫描。 | 用于统计附近 BLE 设备数量。 |
| `CustomSDPort` | `components/port_bsp/sdcard_bsp.cpp` | 挂载 SD 卡并提供读写。 | 复用 SD Card demo 的封装思路。 |
| `CodecPort` | `components/port_bsp/codec_bsp.cpp` | 音频 codec 封装。 | 复用 Audio Test 的封装思路。 |

## 关键代码讲解

`UserApp_AppInit()` 是阅读 FactoryProgram 的第一站。它集中初始化多个硬件能力：

```text
SD
ADC
Button
RTC
SHTC3
Wi-Fi
Codec
```

这说明 FactoryProgram 是集成测试，不是单一外设 demo。

SD 卡测试很直接：

```text
写入 "waveshare.com" 到 /sdcard/sdcard.txt
读回文件
比较内容
UI 显示 passed 或 failed
```

这种思路比单纯“挂载成功”更可靠，因为它验证了读写闭环。

Wi-Fi/BLE 测试体现了资源生命周期：

```text
先用 Wi-Fi 扫描 AP
  -> 等扫描结果
  -> espwifi_deinit()
  -> 初始化 BLE
  -> BLE 扫描设备数量
```

Wi-Fi 和 BLE 都使用无线资源。示例先释放 Wi-Fi 再跑 BLE，说明综合程序不能只看功能，还要看资源是否互相影响。

音频测试仍然沿用事件组：

```text
按键任务设置事件位
Codec_LoopTask 等事件位
收到事件后录音或播放
```

这种拆分比在按键回调里直接录音更稳定，因为按键任务不会被长时间音频读写阻塞。

## 实验现象

运行后，屏幕会显示综合测试界面，逐步更新：

| 显示项 | 代表含义 |
| --- | --- |
| Battery | ADC 电池百分比估算。 |
| RTC | PCF85063 时间读数。 |
| Temp/Humi | SHTC3 温湿度读数。 |
| SD | `passed` / `failed` / `No Card`。 |
| Wi-Fi | 扫描到的 AP 数量或失败标记。 |
| BLE | 扫描到的 BLE 设备数量。 |
| Audio | 录音、播放、音乐播放等状态。 |

按键用于页面切换和音频动作。读者可先只观察 UI 标签变化，再深入对应任务代码。

## 常见问题

| 现象 | 可能原因 | 排查方式 |
| --- | --- | --- |
| 代码看起来很复杂 | 多外设集成导致入口多。 | 先按任务划分看，不要从底层库开始。 |
| SD 显示 `No Card` | 未插卡或挂载失败。 | 先跑单独的 SD Card demo。 |
| Wi-Fi 数量异常 | 扫描环境、权限、天线、初始化状态影响。 | 先确认附近有 2.4 GHz AP。 |
| BLE 数量异常 | 扫描时间短或附近设备少。 | 增加扫描时间观察变化。 |
| 音频无声 | codec、喇叭、音量、PSRAM 缓冲问题。 | 先跑单独的 Audio Test。 |
| 时间每次固定 | demo 启动时写入固定 RTC 时间。 | 产品中应使用校时策略。 |
| 不能直接当产品架构 | FactoryProgram 追求覆盖测试项。 | 产品需要更清晰的状态机和错误恢复。 |

## 工程迁移思路

FactoryProgram 最值得学习的是“综合验证思路”，不是照搬文件结构。迁移到产品时，建议拆成服务：

```text
NetworkService
SensorService
TimeService
PowerService
SdService
AudioService
ButtonService
Display/LvglPort
AppUI
```

每个服务负责自己的硬件能力，App 层通过 snapshot 或事件拿结果。这样比把所有硬件测试都堆在 `user_app.cpp` 中更适合长期维护。

## 补充阅读

- [ESP-IDF Wi-Fi 编程指南](https://docs.espressif.com/projects/esp-idf/zh_CN/v5.5.3/esp32s3/api-guides/wifi.html)
- [ESP-IDF Bluetooth API](https://docs.espressif.com/projects/esp-idf/zh_CN/v5.5.3/esp32s3/api-reference/bluetooth/index.html)
- [ESP-IDF LCD 外设文档](https://docs.espressif.com/projects/esp-idf/zh_CN/v5.5.3/esp32s3/api-reference/peripherals/lcd/index.html)
- [ESP-IDF SDMMC Driver](https://docs.espressif.com/projects/esp-idf/zh_CN/v5.5.3/esp32s3/api-reference/peripherals/sdmmc_host.html)
- [LVGL v8.4 文档](https://docs.lvgl.io/8.4/)
- [LVGL v9.4 文档](https://docs.lvgl.io/9.4/)
- [Waveshare ESP32-S3-RLCD-4.2 资料页](https://docs.waveshare.com/ESP32-S3-RLCD-4.2)
