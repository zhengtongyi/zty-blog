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

所以面试时不要只说“设备联网成功”，而要拆成：

```text
Wi-Fi connected：已经关联 AP。
IP ready：已经通过 DHCP 或静态配置拿到 IP。
DNS ready：域名可以解析。
transport connected：TCP / UDP 通道可用。
secure connected：TLS 握手完成。
business online：MQTT / HTTP / WebSocket 业务协议真正在线。
```

这也是 Wi-Fi 模组软件开发的重点：把每一层状态、错误码、超时和恢复动作分清楚。

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

对 Wi-Fi 模组产品来说，面试官常问的不是“你会不会实现 TCP/IP 协议栈”，而是：

```text
你是否知道协议栈在模组还是主机？
你是否知道主控通过什么命令或驱动访问网络能力？
你是否能把 Wi-Fi、IP、TCP/TLS、业务协议的状态拆开？
你是否能处理断线、超时、重连、离线缓存和日志诊断？
```

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

如果 DHCP 失败，不应该马上判断“Wi-Fi 模组坏了”。更合理的恢复顺序是：

```text
重新发起 DHCP
检查 AP 地址池
检查静态 IP 配置
必要时断开并重新关联 AP
最后才考虑重启模组
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

如果 DNS 失败，也不应该直接重启 Wi-Fi。可以先做：

```text
重试 DNS
切换备用域名
短期缓存上一次解析结果
检查网关和 DNS 配置
记录失败域名和错误码
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

TCP 相关面试追问通常有：

```text
TCP connect timeout 怎么处理？
服务器主动 close 怎么处理？
send 返回失败是否代表 Wi-Fi 断开？
为什么 TCP 已连接，业务还是可能不在线？
```

回答思路是：

```text
TCP 失败优先重建 socket。
不要立刻重启 Wi-Fi。
连续失败再逐层向下恢复。
发送失败要结合错误码、重试次数、RSSI、重连日志判断。
```

UDP 虽然开销小，但设备侧通常要自己补：

```text
序号
ACK
重传
去重
超时
```

否则丢包后业务层不知道数据是否真的到达。

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

MQTT 的核心不是“能 publish”，而是要把在线状态处理完整：

```text
网络已连接
MQTT connect 成功
订阅 command topic 成功
keepalive 正常
收到服务器 ack
异常断开后能恢复订阅
```

常见异常：

```text
MQTT 鉴权失败
keepalive timeout
服务器踢下线
topic 配置错误
QoS ack 超时
离线期间 telemetry 堆积
```

恢复策略：

```text
keepalive timeout：优先重建 MQTT / TCP。
鉴权失败：不要无限重试，进入配置错误状态。
publish 失败：关键数据进入离线缓存。
订阅失败：重连后重新 subscribe。
长期失败：指数退避，避免频繁打服务器。
```

面试表达：

> MQTT 很适合 IoT，但设备不能只实现 publish。更关键的是 keepalive、订阅恢复、离线缓存、QoS ack、鉴权错误处理和重连退避。

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

HTTP 常见异常：

```text
DNS 失败
TCP connect timeout
TLS 握手失败
HTTP 401 / 403 鉴权失败
HTTP 5xx 服务端异常
上传大文件中途断开
```

设备侧要区分：

```text
401 / 403：通常是 token、证书、权限问题。
5xx：通常是服务器问题，应该退避重试。
timeout：可能是网络弱、DNS、TCP 或服务器慢。
```

HTTP 更适合“请求-响应”业务，不适合一直在线的实时控制。

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

WebSocket 常见设计点：

```text
text frame：JSON 控制消息
binary frame：音频、图片、二进制数据
ping / pong：心跳保活
reconnect：断线重连
session resume：业务状态恢复
backpressure：下游处理不过来时不能无限读写
```

如果 Wi-Fi 模组内置 WebSocket 能力，主控要关注：

```text
模组是否支持 text / binary frame 区分
最大 frame 长度
发送队列是否会阻塞
接收数据如何从 UART/SPI 输出给主控
心跳超时如何通知主控
断线后是否需要重新建 TLS
```

面试表达：

> WebSocket 适合双向实时业务，比如音频流和控制消息。但它对连接状态、心跳、缓冲和背压要求更高。设备侧不能只管 send，还要考虑接收是否及时、下游队列满时如何处理，以及断线后如何恢复 session。

## 不同层失败如何恢复

建议记住这个恢复顺序：

```text
业务协议失败
-> 重建 MQTT / HTTP / WebSocket
-> 重建 TCP / TLS
-> 重新 DNS / DHCP
-> 重新连接 Wi-Fi AP
-> 重启 Wi-Fi 模组
-> 整机重启
```

不要所有问题都直接重启模组。

不同失败的处理方式：

```text
MQTT keepalive timeout：先重建 MQTT / TCP。
HTTP 401 / 403：检查 token、证书、权限，不要无限重试。
DNS 失败：先重试 DNS 或切备用域名。
DHCP 失败：重新 DHCP 或重连 AP。
Wi-Fi disconnect：根据 reason、RSSI、channel 判断。
UART overflow：优先检查主控接收、流控和 AT parser。
```

这样回答会比“断线就重连”更像实际产品开发。

## 面试 30 秒总结

> 模组写内置 TCP/IP，说明主控 MCU 不一定要自己跑完整网络协议栈。主控可以通过 UART/SPI 控制模组完成 DHCP、DNS、TCP/UDP、TLS、MQTT/HTTP/WebSocket。开发时我会把 Wi-Fi 接入、IP 就绪、DNS、TCP/TLS 连接和业务在线分成不同状态，并按失败层级做恢复：业务协议失败先重建协议连接，TCP/TLS 失败再重建 socket，DNS/DHCP 失败再处理 IP 网络，最后才考虑重连 AP 或重启模组。同时要记录 RSSI、错误码、重连次数、keepalive timeout 和离线缓存状态，方便现场定位。
