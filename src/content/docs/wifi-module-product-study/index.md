---
title: Wi-Fi 模组产品拆解
description: 从市面上的 Wi-Fi 模组产品出发，拆解模组架构、运行原理、802.11、TCP/IP、UART AT、低功耗和量产测试，形成面向嵌入式岗位的完整知识地图。
---

## 这个专栏解决什么问题

面试 Wi-Fi 模组公司时，最容易出现两个偏差：

1. 一上来背 `802.11` 细节，但讲不清产品怎么用。
2. 只说“我会 Wi-Fi 联网”，但讲不清模组内部、主控接口、协议栈和低功耗边界。

这个专栏的目标不是把自己包装成射频专家，也不是从零实现 Wi-Fi 协议栈，而是建立一个产品级认知：

```text
Wi-Fi 模组是什么
-> 它内部有哪些模块
-> 它怎么和 MCU / Linux 主控协作
-> 它如何完成联网、TCP/IP、MQTT/HTTP 数据上传
-> 它如何处理低功耗、断线重连、量产测试和现场问题
```

## 推荐阅读顺序

1. [市面上 Wi-Fi 模组的产品形态与架构](./01-product-architecture/)
2. [从上电到联网：Wi-Fi 模组运行主流程](./02-runtime-flow/)
3. [802.11、2.4GHz、天线与射频基础](./03-80211-rf-antenna/)
4. [TCP/IP 协议栈与 MQTT、HTTP、Socket](./04-tcpip-and-application-protocols/)
5. [UART AT 接口与主控侧驱动设计](./05-uart-at-host-integration/)
6. [低功耗、量产测试与现场稳定性](./06-low-power-production-test/)
7. [面试时怎么讲 Wi-Fi 模组项目](./07-interview-output/)

## 用一张图先串起来

```text
传感器 / 外设 / 主控 MCU
        ↓ UART / SPI / SDIO / GPIO
Wi-Fi 模组
  - Wi-Fi Radio / Baseband / MAC
  - 802.11 b/g/n
  - TCP/IP Stack
  - AT 固件或用户应用
  - 天线 / 射频匹配 / 晶振 / Flash / RAM
        ↓
AP / Router
        ↓
TCP / UDP / TLS
        ↓
MQTT / HTTP / WebSocket / 私有云协议
        ↓
云平台 / App / 本地服务器
```

## 当前面试的产品参考

`FLC-WFM102` 这类产品可以先理解成：

```text
低功耗 Wi-Fi MCU 模组
+ 2.4GHz 802.11 b/g/n
+ 1x1 SISO / HT20
+ Cortex-M4F MCU
+ 内置 TCP/IP 协议栈
+ UART 简化接入
+ SPI / I2C / I2S / ADC / GPIO 等外设
+ 天线与小尺寸封装
```

面试重点不是说“我会完整 Wi-Fi 协议栈”，而是：

```text
我知道 Wi-Fi 模组如何接入嵌入式产品；
知道主控 MCU 和模组如何分工；
知道联网、协议、低功耗、异常恢复和量产测试怎么设计。
```

## 参考产品

后续文章会反复拿几类公开产品做参照：

- [ESP32-WROOM-32](https://www.espressif.com/sites/default/files/documentation/esp32-wroom-32_datasheet_en.pdf)：典型 Wi-Fi + Bluetooth MCU 模组。
- [ESP-AT](https://docs.espressif.com/projects/esp-at/en/latest/esp32/AT_Command_Set/)：典型 AT 命令式 Wi-Fi 模组固件。
- [u-blox NINA-W10](https://www.u-blox.com/en/product/nina-w10-series-open-cpu)：典型 open CPU Wi-Fi / Bluetooth 模组。
- [Murata Type 1DX](https://www.murata.com/en-us/products/connectivitymodule/wi-fi-bluetooth/overview/lineup/type1dx)：典型 host-driven Wi-Fi / Bluetooth 连接模组，常见于 Linux / Android 主机。

这些产品形态不同，但共同问题都是：

```text
如何把无线能力稳定地放进一个嵌入式产品。
```
