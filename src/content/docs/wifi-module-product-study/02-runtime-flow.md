---
title: 从上电到联网：Wi-Fi 模组运行主流程
description: 拆解 Wi-Fi 模组从上电、固件启动、扫描、认证、关联、DHCP、DNS 到 TCP/MQTT 数据收发的完整运行链路。
---

## 先给结论

Wi-Fi 模组的运行流程可以拆成四层：

```text
硬件启动
-> Wi-Fi 接入
-> IP 网络
-> 应用协议
```

如果面试官问“Wi-Fi 模组怎么工作”，不要只说“连路由器”。要能讲出：

```text
上电复位
-> 固件启动
-> 配置模式
-> 扫描 AP
-> 认证 Authentication
-> 关联 Association
-> WPA/WPA2 四次握手
-> DHCP 获取 IP
-> DNS 解析
-> TCP / TLS / MQTT / HTTP
-> 业务数据收发
-> 断线检测和重连
```

## 1. 上电与固件启动

模组上电后，通常会经历：

```text
Power On
-> Reset
-> Boot ROM
-> Bootloader
-> Load Firmware / Application
-> Init RF / Clock / Flash / RAM
-> Start RTOS Task
```

如果是 AT 模组，还会启动：

```text
UART Driver
AT Command Parser
Wi-Fi Manager
TCP/IP Stack
```

主控 MCU 上电后要做：

```text
等待模组 ready
查询固件版本
配置工作模式
配置 Wi-Fi 账号
启动连接流程
```

常见 AT 类命令：

```text
AT
AT+GMR
AT+RST
AT+CWMODE
AT+CWJAP
```

## 2. 扫描 AP

扫描阶段，模组会在 2.4GHz 信道上查找可用 AP。

你要关注：

```text
SSID
BSSID
信道
RSSI
加密方式
```

如果扫描不到 AP，可能原因：

1. SSID 写错。
2. 路由器是 5GHz，模组只支持 2.4GHz。
3. 信号太弱。
4. 天线设计或摆放有问题。
5. 国家区域信道配置不匹配。

面试表达：

> 我会先确认模组能否扫描到目标 SSID，以及 RSSI 是否合理。能扫描到才进入认证和关联；扫描不到时优先排查频段、信道、天线、距离和路由器配置。

## 3. 认证与关联

Wi-Fi 接入 AP 不是一步完成，至少包括：

```text
Authentication
Association
Security Handshake
```

可以粗略理解为：

```text
Authentication：确认能不能和 AP 建立基础关系。
Association：STA 加入 AP 管理的网络。
WPA/WPA2 Handshake：用密码和加密方式协商密钥。
```

常见失败原因：

1. 密码错误。
2. 加密方式不支持。
3. AP 限制设备数量。
4. 信号弱导致握手超时。
5. 路由器黑名单或 MAC 过滤。

面试时不需要完整背 802.11 帧，但要知道：

```text
Wi-Fi connected 不等于拿到 IP；
拿到 IP 不等于业务服务器可达。
```

## 4. DHCP 获取 IP

关联成功后，设备需要 IP 地址。

常见流程：

```text
DHCP Discover
-> DHCP Offer
-> DHCP Request
-> DHCP ACK
```

拿到的信息通常包括：

```text
IP 地址
子网掩码
网关
DNS 服务器
租约时间
```

如果 Wi-Fi 已连接但业务不通，要检查：

```text
是否有 IP
网关是否可达
DNS 是否可用
路由是否正确
```

## 5. DNS、TCP、TLS

连接云端通常不是直接连 IP，而是：

```text
域名 -> DNS 解析 -> IP -> TCP 连接 -> TLS 握手 -> 应用协议
```

排查顺序：

```text
DNS 解析失败：域名、DNS、网络出口。
TCP 失败：IP、端口、防火墙、服务器状态。
TLS 失败：证书、时间、SNI、CA、内存。
应用失败：MQTT/HTTP 鉴权、topic、payload。
```

如果模组内置 TCP/IP 和 TLS，主控侧一般通过命令控制：

```text
建立连接
发送数据
接收异步下行
关闭连接
查询连接状态
```

## 6. MQTT / HTTP / WebSocket

常见应用协议：

```text
MQTT：适合 IoT 设备遥测、状态、命令下发。
HTTP：适合配置、升级、一次性请求。
WebSocket：适合长连接双向数据流。
私有 TCP：适合厂商自定义轻量协议。
```

IoT 模组产品里最常见的是 MQTT：

```text
connect
subscribe
publish
keepalive
reconnect
```

面试表达：

> 我会把 Wi-Fi 连接、IP 获取和应用协议分层看。Wi-Fi 只是接入 AP，DHCP 才拿到 IP，TCP/TLS 才连到服务器，MQTT/HTTP 才是业务协议。排查问题时也按这个层级逐步定位。

## 7. 断线重连

设备联网不是一次成功就结束。

要设计状态机：

```text
INIT
-> READY
-> WIFI_CONNECTING
-> WIFI_CONNECTED
-> IP_READY
-> SERVER_CONNECTING
-> ONLINE
-> RECONNECT_WAIT
-> ERROR
```

断线来源：

```text
AP 断开
DHCP 租约问题
DNS 失败
TCP 被服务器关闭
TLS 失败
MQTT keepalive 超时
UART 通信异常
模组死机
```

重连策略：

```text
短期快速重试
多次失败后退避
必要时重启 socket
再失败重连 Wi-Fi
最后重启模组
```

## 8. 主控侧要记录哪些日志

建议记录：

```text
模组固件版本
当前状态
SSID / BSSID / Channel
RSSI
IP / Gateway / DNS
连接服务器地址
重连次数
发送失败次数
接收字节数
最后错误码
低功耗唤醒原因
```

这些日志比一句“Wi-Fi 断了”有价值得多。

## 面试 30 秒总结

> 我会把 Wi-Fi 模组运行流程拆成硬件启动、Wi-Fi 接入、IP 网络和应用协议四层。设备从上电到联网，会经历固件启动、扫描 AP、认证关联、WPA 握手、DHCP 获取 IP、DNS 解析、TCP/TLS 连接和 MQTT/HTTP 数据收发。排查问题时也按这个层级看，避免把 Wi-Fi connected、got IP 和 server online 混成一个状态。
