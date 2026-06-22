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

对用户来说，断线问题通常表现为：

```text
设备离线
App 控制无响应
数据上传延迟
状态显示不准
语音 / 音频 / 实时控制卡顿
设备频繁重启
电池耗电变快
售后现场难复现
```

所以断线重连不是简单地“失败后再连一次”，而是一个完整的可靠性设计问题。

### 7.1 先把在线状态拆清楚

不要只维护一个 `connected=true/false`。

建议至少拆成：

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

每个状态代表的含义不同：

```text
WIFI_CONNECTED：已经关联 AP，但不一定有 IP。
IP_READY：已经拿到 IP，但不一定能连服务器。
SERVER_CONNECTING：正在建立 TCP/TLS/MQTT。
ONLINE：业务链路可用，可以收发数据。
RECONNECT_WAIT：失败后等待下一次重连。
ERROR：进入需要更强恢复动作的异常状态。
```

这样设计的好处是：

```text
问题能分层定位。
UI / App 可以显示更准确状态。
重连动作可以按失败层级选择。
日志能解释为什么离线。
```

### 7.2 断线来源要分层

断线来源至少分成 6 类。

第一类：Wi-Fi 接入层问题。

```text
AP 断电或重启
SSID 不存在
密码错误
RSSI 过低
2.4GHz 信道干扰
AP 拒绝关联
路由器限制接入数量
```

用户感知：

```text
设备长期离线。
靠近路由器又恢复。
换路由器后异常。
```

开发策略：

```text
记录 disconnect reason。
记录 RSSI、BSSID、channel。
多次失败后降低扫描频率，避免耗电。
必要时进入配网模式或提示用户检查 Wi-Fi。
```

第二类：IP 网络层问题。

```text
DHCP 获取 IP 失败
DHCP 租约续租失败
网关不可达
DNS 不可用
局域网可用但外网不可用
```

用户感知：

```text
设备显示已连 Wi-Fi，但云端离线。
局域网工具能看到设备，App 远程控制失败。
```

开发策略：

```text
区分 Wi-Fi connected 和 got IP。
DNS 失败时不要重启整个模组，先重试 DNS 或换备用域名/IP。
记录 IP、gateway、DNS。
必要时释放并重新 DHCP。
```

第三类：服务器连接层问题。

```text
TCP connect timeout
服务器拒绝连接
服务器主动 close
TLS 握手失败
证书过期
设备时间错误
```

用户感知：

```text
设备本地联网正常，但云端不在线。
一批设备在同一时间异常。
```

开发策略：

```text
TCP/TLS/MQTT 失败优先重建 socket。
不要立刻重连 Wi-Fi。
TLS 失败要记录证书、时间、错误码。
多次失败后指数退避，避免打爆服务器。
```

第四类：应用协议层问题。

```text
MQTT keepalive 超时
MQTT 鉴权失败
topic 配置错误
HTTP 返回 401/403/500
WebSocket ping/pong 超时
私有协议心跳超时
```

用户感知：

```text
设备偶发离线。
命令下发失败。
数据上传有延迟或重复。
```

开发策略：

```text
给应用协议单独做 keepalive。
上报失败要进入本地缓存，而不是丢数据。
鉴权失败不要无限重试，要进入配置错误状态。
记录业务错误码和服务器返回码。
```

第五类：主控和模组接口问题。

```text
UART 波特率不匹配
UART ringbuf overflow
AT 响应丢失
AT 异步事件和命令响应混淆
RTS/CTS 流控没接好
SPI / SDIO 传输错误
```

用户感知：

```text
设备不定时假离线。
模组实际在线，但主控认为异常。
发送大数据时更容易出问题。
```

开发策略：

```text
UART 接收使用 ringbuf。
AT Parser 区分响应、事件和数据。
发送命令要有互斥、超时和清理。
记录 rx_overflow、parse_error、cmd_timeout。
数据量大时使用硬件流控或提高接口带宽。
```

第六类：模组自身或供电问题。

```text
模组固件异常
内存泄漏
看门狗复位
供电瞬降
RF 初始化失败
Flash 参数损坏
低功耗唤醒后状态不一致
```

用户感知：

```text
设备随机重启。
离线后必须断电才能恢复。
低电量时更容易掉线。
```

开发策略：

```text
记录 reset reason。
记录模组 ready 时间。
对关键参数做校验和默认恢复。
必要时主控通过 reset pin 硬复位模组。
上报模组重启次数和最后错误原因。
```

### 7.3 重连动作要分级

不要所有异常都 `AT+RST` 或整机重启。

推荐从轻到重：

```text
1. 重发当前业务数据
2. 重建应用协议连接，例如 MQTT reconnect
3. 重建 TCP/TLS socket
4. 重新 DNS / DHCP
5. 重新连接 Wi-Fi AP
6. 软件重启 Wi-Fi 模组
7. 主控拉 reset pin 硬复位模组
8. 整机重启，作为最后兜底
```

这样做可以减少：

```text
用户等待时间
无意义的 Wi-Fi 扫描
电池消耗
服务器重连风暴
现场误判
```

### 7.4 重试节奏要控制

常见策略：

```text
首次失败：立即重试 1~3 次。
连续失败：指数退避，例如 1s、2s、5s、10s、30s、60s。
长期失败：进入低频重试或离线模式。
用户触发：按键 / App / 配网操作可以立即重试。
```

不要写成：

```text
while (!connected) {
    reconnect();
}
```

这样会导致：

```text
功耗暴涨。
日志刷屏。
服务器被频繁连接。
主控其他任务被拖慢。
用户体验更差。
```

### 7.5 数据不能随便丢

联网设备经常遇到：

```text
采集正常，但网络离线。
用户操作已经发生，但云端暂时不可达。
```

要根据数据类型决定策略：

```text
实时控制命令：过期就丢弃，避免恢复后执行旧命令。
传感器遥测：可缓存，恢复后补传。
报警事件：必须缓存并尽快补传。
日志文件：可按容量保留最近 N 条。
状态快照：只保留最新值即可。
```

面试时可以这样说：

> 我不会把所有数据都简单缓存或简单丢弃，而是按业务类型区分。报警事件和关键遥测需要离线缓存，实时控制命令要考虑过期，状态类数据可以只保留最新快照。

### 7.6 用户体验上要有明确反馈

设备离线时，用户最怕“不知道发生了什么”。

可以设计：

```text
LED 快慢闪表示配网 / 离线 / 在线。
App 显示最后在线时间。
本地按键触发重新配网。
长时间离线进入低功耗等待。
恢复联网后主动上报状态。
```

如果是工业设备，可以提供：

```text
最近错误码
最近一次成功上报时间
离线时长
重连次数
RSSI
固件版本
```

这些信息能明显降低售后排查成本。

### 7.7 面试表达

可以这样讲：

> 我会把断线重连设计成分层状态机，而不是一个简单 reconnect 函数。先区分 Wi-Fi 接入、IP、DNS、TCP/TLS、MQTT/HTTP、主控接口和模组自身问题，再按失败层级选择恢复动作。比如 MQTT keepalive 超时优先重连 MQTT，TCP 失败重建 socket，DHCP 失败才重新获取 IP，多次 Wi-Fi 失败再重连 AP 或重启模组。重试节奏要做退避，关键数据要离线缓存，并记录 RSSI、错误码、重连次数和最后在线时间，方便用户感知和售后定位。

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
