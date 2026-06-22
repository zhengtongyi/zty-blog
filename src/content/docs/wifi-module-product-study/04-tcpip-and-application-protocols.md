---
title: TCP/IP 协议栈与 MQTT、HTTP、Socket
description: 理解 Wi-Fi 模组内置 TCP/IP 的意义，以及 DHCP、DNS、TCP、UDP、TLS、MQTT、HTTP 在嵌入式联网产品里的职责边界。
---

## 先给结论

Wi-Fi 连接成功，只代表设备接入了 AP，不代表业务已经在线。

完整联网链路是：

```text
Wi-Fi 接入
-> DHCP 获取 IP
-> DNS 解析域名
-> TCP / UDP 传输
-> TLS 加密
-> MQTT / HTTP / WebSocket 业务协议
```

模组产品写 `Embedded TCP/IP Stack` 的意思是：

```text
模组内部已经处理 IP、TCP、UDP、DNS 等网络协议；
主控 MCU 可以通过 UART / SPI 命令使用这些能力。
```

## TCP/IP 协议栈放在哪里

有两种常见模式。

模式一：模组内部 TCP/IP。

```text
主控 MCU
  ↓ AT / 私有协议
Wi-Fi 模组
  - Wi-Fi
  - IP
  - TCP / UDP
  - TLS / MQTT / HTTP
```

优点：

```text
主控简单
RAM 压力小
接入快
```

缺点：

```text
状态隐藏在模组里
调试依赖 AT 响应和错误码
UART 吞吐可能成为瓶颈
```

模式二：主机侧 TCP/IP。

```text
Linux / RTOS Host
  - Wi-Fi Driver
  - TCP/IP Stack
  - MQTT / HTTP
        ↓ SDIO / SPI / USB
Wi-Fi 连接模组
```

适合复杂主机，例如 Linux 网关、摄像头、HMI。

## DHCP

DHCP 负责自动分配网络参数：

```text
IP 地址
子网掩码
网关
DNS
租约
```

常见问题：

```text
Wi-Fi connected 但没有 IP。
DHCP 超时。
AP 地址池满。
静态 IP 配置错误。
```

排查时要区分：

```text
Wi-Fi 层已连接
IP 层未就绪
```

## DNS

DNS 负责把域名解析成 IP。

例如：

```text
mqtt.example.com -> 1.2.3.4
```

常见问题：

```text
能 ping IP，不能访问域名。
DNS 服务器不可达。
设备时间错误导致 TLS 后续失败。
```

模组 AT 命令里常见：

```text
域名解析命令
建立 TCP / SSL 连接命令
查询连接状态命令
```

## TCP 和 UDP

TCP 特点：

```text
面向连接
可靠传输
三次握手
重传
滑动窗口
适合 MQTT / HTTP / WebSocket
```

UDP 特点：

```text
无连接
开销小
不保证可靠
适合低延迟或自定义可靠性的场景
```

IoT 设备最常见：

```text
MQTT over TCP / TLS
HTTP over TCP / TLS
```

## TLS

TLS 解决：

```text
加密
身份认证
数据完整性
```

嵌入式模组里 TLS 常见风险：

```text
证书太大
RAM 不足
系统时间错误
CA 证书过期
SNI / 域名校验问题
握手耗时长
低功耗唤醒后重连慢
```

面试表达：

> TLS 不是只打开一个选项。嵌入式设备要关注证书存储、时间同步、内存占用、握手耗时和错误码。

## MQTT

MQTT 很适合 IoT，因为它有：

```text
publish / subscribe
topic
keepalive
QoS
retain
last will
```

常见 topic：

```text
device/{device_id}/telemetry
device/{device_id}/status
device/{device_id}/command
device/{device_id}/event
```

设备侧要处理：

```text
connect
subscribe command topic
publish telemetry
keepalive timeout
reconnect
offline cache
```

## HTTP

HTTP 适合：

```text
设备注册
配置拉取
固件升级
一次性数据上传
诊断文件上传
```

不适合高频低延迟双向控制，除非产品本身很简单。

## WebSocket

WebSocket 适合：

```text
长连接
双向实时通信
音频流
控制消息
实时状态同步
```

它比普通 HTTP 更像持续在线通道，但也更依赖连接状态、心跳和断线恢复。

## 面试 30 秒总结

> 模组写内置 TCP/IP，说明主控 MCU 不一定要自己跑完整网络协议栈。主控可以通过 UART/SPI 控制模组完成 DHCP、DNS、TCP/UDP、TLS、MQTT/HTTP。开发时我会把 Wi-Fi 接入、IP 就绪、服务器连接和业务在线分成不同状态，并分别处理超时、错误码、重连和日志。
