---
title: UART AT 接口与主控侧驱动设计
description: 拆解 MCU 如何通过 UART 接入 Wi-Fi AT 模组，包括命令响应、异步事件、透传模式、ringbuf、流控、状态机和异常恢复。
---

## 先给结论

如果 Wi-Fi 模组提供 `Simple UART interface`，主控侧真正要开发的是：

```text
UART Driver
-> Ring Buffer
-> AT Parser
-> Command Dispatcher
-> Async Event Handler
-> Wi-Fi Manager State Machine
-> Socket / MQTT / HTTP Service
```

不要让业务代码到处直接拼 AT 命令。

## 为什么 AT 接口容易写乱

AT 模组不是简单的一问一答。

它有三类数据：

```text
命令响应：OK / ERROR / +CIPSTART
异步事件：WIFI DISCONNECT / GOT IP / CLOSED / +IPD
业务数据：网络收到的数据
```

这些数据都从同一个 UART 进来，所以必须有解析层。

如果没有解析层，就会出现：

```text
业务任务阻塞等 OK。
异步断线事件没人处理。
收到 +IPD 数据和命令响应混在一起。
重连时旧命令响应污染新状态。
```

## 推荐分层

```text
app_business
  只关心发送业务数据、收到云端命令。

wifi_service
  管理联网、重连、服务器连接、MQTT/HTTP。

at_client
  管理命令发送、响应匹配、超时、互斥。

at_parser
  从 UART 字节流解析行、事件和数据块。

uart_driver
  中断 / DMA 接收，ringbuf 缓冲，发送字节。
```

核心原则：

```text
UART 只负责收发字节。
AT Parser 只负责解析。
Wi-Fi Manager 只负责状态机。
业务层不直接理解 AT 细节。
```

## UART 接收怎么做

推荐：

```text
UART RX interrupt / DMA
-> rx_ringbuf
-> parser task
```

不要在中断里解析复杂协议。

如果数据量较大，要考虑：

```text
ringbuf 大小
波特率
RTS/CTS 硬件流控
接收任务优先级
溢出计数
```

面试表达：

> 我会把 UART 接收放到 ringbuf，解析放到独立任务，避免中断里做复杂逻辑。同时记录 overflow、parse error、timeout 等统计，方便现场定位。

## 命令发送怎么做

AT 命令通常要串行化。

推荐流程：

```text
take mutex
send command
wait expected response
handle timeout / error
release mutex
```

要注意：

```text
命令超时要清理等待状态。
异步事件不能被命令等待吞掉。
长数据发送要处理 prompt，例如 `>`。
重启模组后要清空旧状态。
```

## 异步事件怎么处理

常见事件：

```text
WIFI CONNECTED
WIFI DISCONNECT
GOT IP
SERVER CLOSED
+IPD
MQTT DISCONNECTED
```

这些事件应该进入 Wi-Fi Manager，而不是由业务层到处处理。

```text
AT Parser
-> Event Queue
-> Wi-Fi Manager
-> 更新状态 / 发起重连 / 通知业务层
```

## 透传模式和非透传模式

非透传模式：

```text
每次发送都带命令。
收到数据通过 +IPD 事件上报。
控制清晰，但开销大。
```

透传模式：

```text
进入 data mode 后，UART 字节直接映射到网络连接。
吞吐更高，但控制命令和数据切换更复杂。
```

第一版产品建议：

```text
先用非透传模式，状态清晰。
吞吐不足时再评估透传或 SPI。
```

## 硬件流控

当 UART 吞吐较高，或者主控任务可能来不及收数据时，建议使用：

```text
RTS / CTS
```

没有流控时，风险是：

```text
模组持续吐数据
主控 ringbuf 满
数据丢失
协议解析错乱
```

如果产品只发少量状态数据，低波特率也能跑。  
如果要传音频、日志、OTA 或大数据，必须认真评估波特率和流控。

## Wi-Fi Manager 状态机

推荐状态：

```text
POWER_OFF
BOOTING
READY
WIFI_CONNECTING
WIFI_CONNECTED
IP_READY
SERVER_CONNECTING
ONLINE
RECONNECT_WAIT
ERROR
```

状态机负责：

```text
初始化
联网
服务器连接
断线重连
错误恢复
低功耗进入和唤醒
```

业务层只关心：

```text
online / offline
send result
received command
```

## 面试 30 秒总结

> UART AT 模组开发的重点不是会发几条 AT 命令，而是主控侧驱动设计。我会把 UART、AT 解析、命令等待、异步事件和 Wi-Fi 状态机分层。UART 用 ringbuf 接收，AT Parser 区分命令响应、异步事件和业务数据，Wi-Fi Manager 负责联网、重连和服务器状态，业务层只通过清晰接口发送和接收数据。
