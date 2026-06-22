---
title: 市面上 Wi-Fi 模组的产品形态与架构
description: 从 FLC-WFM102、ESP32-WROOM、ESP-AT、u-blox NINA-W10、Murata Type 1DX 这类产品出发，拆解 Wi-Fi 模组的常见架构和运行边界。
---

## 先给结论

Wi-Fi 模组不是单一形态。市面上常见产品大致可以分成三类：

```text
1. Wi-Fi MCU 模组
2. AT / 网络协处理器模组
3. Host-driven Wi-Fi 连接模组
```

面试时要先判断产品属于哪一类，再谈开发职责。

`FLC-WFM102` 这类描述里同时出现：

```text
Cortex-M4F CPU
Embedded TCP/IP Stack
Simple UART interface
SPI / UART / I2C / I2S / ADC / GPIO
Low Power
Antenna
```

它更像：

```text
低功耗 Wi-Fi MCU 模组
```

它既可以作为主控 MCU 的 Wi-Fi 网络协处理器，也可能独立跑小型应用。

## 形态一：Wi-Fi MCU 模组

典型产品：

- `FLC-WFM102`
- `ESP32-WROOM-32`
- `u-blox NINA-W10`

典型内部结构：

```text
Wi-Fi Radio / RF Front-End
        ↓
Baseband / MAC
        ↓
MCU Core
        ↓
RTOS / Wi-Fi Driver / TCP-IP Stack
        ↓
User App / AT Firmware
        ↓
UART / SPI / I2C / I2S / ADC / GPIO
```

这种模组的特点：

1. 模组内部有 MCU。
2. 模组内部跑 Wi-Fi 协议栈。
3. 模组可能内置 TCP/IP。
4. 可以通过 SDK 开发应用。
5. 也可以烧 AT 固件，让外部主控通过 UART 控制它。

适合场景：

```text
低功耗传感器
智能家电
工业采集节点
简单音频或控制终端
主控资源较弱但需要联网的产品
```

面试表达：

> Wi-Fi MCU 模组把无线射频、协议栈和 MCU 集成在一起，产品开发重点不是从零写 802.11，而是做好模组初始化、联网状态机、TCP/IP 数据收发、低功耗和异常恢复。

## 形态二：AT / 网络协处理器模组

典型产品形态：

```text
主控 MCU
  ↓ UART / SPI
Wi-Fi 模组 AT 固件
  ↓
Wi-Fi + TCP/IP
```

典型命令：

```text
AT
AT+GMR
AT+CWMODE
AT+CWJAP
AT+CIPSTART
AT+CIPSEND
AT+MQTTCONN
AT+HTTPCLIENT
```

这种形态的重点是：

```text
主控不直接跑 Wi-Fi 协议栈。
主控通过命令让模组完成联网和数据收发。
```

优点：

1. 主控 MCU 资源压力小。
2. 接入门槛低。
3. 协议升级可以通过模组固件完成。
4. 适合已有产品快速增加 Wi-Fi。

缺点：

1. AT 状态机容易写乱。
2. 命令响应和异步事件会交织。
3. UART 吞吐和流控要处理好。
4. 模组内部状态不可完全透明，问题定位依赖日志和错误码。

面试表达：

> AT 模组开发的重点是主控侧驱动。底层 UART 只负责收发字节，中间层解析命令响应和异步事件，上层 Wi-Fi Manager 管理联网、Socket、MQTT/HTTP 和重连。

## 形态三：Host-driven Wi-Fi 连接模组

典型产品：

- `Murata Type 1DX`
- 很多 Linux / Android 平台常见 Wi-Fi + Bluetooth combo 模组

典型结构：

```text
Linux / Android Host
        ↓ SDIO / PCIe / USB
Wi-Fi / Bluetooth Combo Module
        ↓
RF / Baseband / MAC
```

这类模组更像连接器件，不一定自己跑完整应用。

软件栈通常在主机侧：

```text
Linux Kernel Driver
cfg80211 / mac80211 / vendor driver
wpa_supplicant
DHCP client
TCP/IP Stack
Application
```

适合场景：

```text
路由器
Linux 网关
HMI
平板
车机
摄像头
复杂边缘设备
```

面试表达：

> Host-driven 模组和 AT 模组不同。AT 模组把 TCP/IP 和连接管理藏在模组里，Host-driven 模组通常由 Linux 主机跑驱动、wpa_supplicant、DHCP 和应用协议，调试重点在驱动、固件、设备树、接口和系统网络栈。

## 三类模组怎么对比

| 类型 | 主控在哪里 | TCP/IP 在哪里 | 常见接口 | 适合产品 |
| --- | --- | --- | --- | --- |
| Wi-Fi MCU 模组 | 模组内部 | 模组内部 | UART / SPI / GPIO / I2C | 传感器、家电、小终端 |
| AT 模组 | 外部 MCU + 模组协作 | 模组内部 | UART / SPI | 给已有 MCU 产品加联网 |
| Host-driven 模组 | Linux / Android 主机 | 主机侧 | SDIO / PCIe / USB | 网关、HMI、摄像头、车机 |

`FLC-WFM102` 由于强调 `Cortex-M4F`、`TCP/IP`、`Simple UART interface` 和低功耗，更应该按前两类准备：

```text
Wi-Fi MCU 模组
+ AT / 网络协处理器接入
```

## 一个 Wi-Fi 模组里通常有什么

从硬件看：

```text
Wi-Fi 芯片 / SoC
RF 前端
晶振
Flash
RAM
天线或天线座
电源管理
射频匹配网络
屏蔽罩
GPIO / UART / SPI / I2C / I2S / ADC 引脚
```

从软件看：

```text
Boot ROM
Bootloader
Wi-Fi Firmware
RTOS
Wi-Fi Driver
TCP/IP Stack
TLS / MQTT / HTTP
AT Command Parser 或 User App
OTA / NVS / 参数保存
低功耗管理
```

面试里把它讲成：

```text
硬件集成无线能力；
固件管理联网能力；
接口把联网能力暴露给产品主控。
```

## 和 MCU 产品怎么协作

典型产品架构：

```text
传感器 / 电机 / RFID / 屏幕 / 按键
        ↓
主控 MCU：STM32 / GD32 / AT32
        ↓ UART / SPI
Wi-Fi 模组
        ↓
路由器 / 云平台
```

主控 MCU 负责：

```text
实时采集
本地控制
外设驱动
业务状态机
数据缓存
模组控制
```

Wi-Fi 模组负责：

```text
扫描 AP
认证关联
DHCP
DNS
TCP / UDP / TLS
MQTT / HTTP
低功耗联网
```

这就是你要表达的能力边界。

## 面试 30 秒总结

> Wi-Fi 模组有不同形态。如果是 FLC-WFM102 这种集成 MCU、TCP/IP 和 UART 接口的低功耗模组，我会把它理解成 Wi-Fi MCU / 网络协处理器。实际开发重点不是从零实现 802.11，而是根据产品架构决定它是独立运行还是被外部 MCU 控制，然后做好 UART/SPI 接口、联网状态机、TCP/IP 数据收发、低功耗、断线重连和量产测试。

## 参考资料

- [ESP32-WROOM-32 Datasheet](https://www.espressif.com/sites/default/files/documentation/esp32-wroom-32_datasheet_en.pdf)
- [ESP-AT Command Set](https://docs.espressif.com/projects/esp-at/en/latest/esp32/AT_Command_Set/)
- [u-blox NINA-W10 series](https://www.u-blox.com/en/product/nina-w10-series-open-cpu)
- [Murata Type 1DX](https://www.murata.com/en-us/products/connectivitymodule/wi-fi-bluetooth/overview/lineup/type1dx)
