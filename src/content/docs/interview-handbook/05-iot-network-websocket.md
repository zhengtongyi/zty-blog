---
title: IoT 网络通信：Wi-Fi / TCP / TLS / WebSocket
description: 围绕简历中的 Wi-Fi、TCP、TLS、WebSocket、JSON 控制消息和 binary 音频传输整理面试回答。
---

## 这篇对应简历里的哪句话

```text
熟悉 Wi-Fi、TCP、TLS、WebSocket 等 IoT 通信技术，具备设备端联网、云端通信、断线重连和数据传输开发经验。
实现 WebSocket 通信模块，支持设备与云端之间的 JSON 控制消息和 binary 音频数据传输，并处理连接、断线重连、超时和异常恢复。
```

## 面试官为什么会问

IoT 设备不是连上 Wi-Fi 就算联网成功。面试官会看你是否理解网络分层、TCP 可靠传输、TLS、WebSocket 长连接、心跳、重连和数据通道设计。

## 高频问题

### Q1：Wi-Fi connected、got IP、gateway reachable、session active 有什么区别？

**短答：**

它们是不同层级的状态。Wi-Fi connected 只表示连上 AP；got IP 表示 DHCP 成功；gateway reachable 表示目标服务可达；session active 表示业务会话建立成功。

**展开回答：**

```text
Wi-Fi connected -> 链路层可用
got IP -> 网络层配置完成
DNS/TCP/TLS/WebSocket -> 传输和安全通道可用
session active -> 应用协议可用
```

**结合我的项目：**

我的设备要区分 Wi-Fi、IP、WebSocket、AI Session 状态。不能把所有状态混成一个 `online`，否则出问题时不知道是网络、TLS、WebSocket 还是业务协议失败。

**继续追问：**

如果 Wi-Fi connected 但业务不可用，可能是 DNS、路由、TLS 握手、WebSocket 握手或服务端异常。

### Q2：TCP 为什么可靠？

**短答：**

TCP 通过序号、确认、重传、滑动窗口、拥塞控制和流量控制提供可靠有序字节流。

**展开回答：**

TCP 不是保证网络不丢包，而是在丢包后通过重传恢复。接收方窗口控制发送方速度，拥塞控制避免网络过载。

**结合我的项目：**

WebSocket 跑在 TCP 上。下游 ringbuf 满时，如果设备不继续读 socket，TCP 接收窗口会收缩，最终让服务端发送阻塞，这就是自然背压。

**继续追问：**

TCP 是字节流，没有消息边界；WebSocket 在 TCP 上增加 frame 边界。

### Q3：TLS 解决什么问题？

**短答：**

TLS 提供身份认证、加密传输和完整性保护。

**展开回答：**

TLS 握手会验证证书，协商密钥，然后加密应用数据。代价是握手耗时、内存占用和加解密 CPU 开销。

**结合我的项目：**

公网链路通常使用 WSS，也就是 WebSocket over TLS。设备侧要考虑证书、握手失败、内存占用和超时。

**继续追问：**

如果 LAN WS 正常、Cloudflare WSS 异常，不能直接归因 TLS，要结合发送阻塞、网络路径和服务端行为分层看。

### Q4：WebSocket 和 HTTP 有什么区别？

**短答：**

HTTP 是请求响应模型；WebSocket 通过握手升级成长连接，之后双方都可以主动发送消息。

**展开回答：**

WebSocket 适合实时双向通信，例如控制消息、音频流、状态同步。它支持 text frame 和 binary frame。

**结合我的项目：**

设备和云端需要同时处理 JSON 控制消息和音频数据，WebSocket 比普通 HTTP 请求更适合长会话双向流式通信。

**继续追问：**

WebSocket 建立在 TCP 上，所以仍然受 TCP 阻塞、窗口、拥塞和断线影响。

### Q5：WebSocket text frame 和 binary frame 怎么设计？

**短答：**

控制消息走 text/JSON，音频或二进制大数据走 binary。两者要在模块上分开处理。

**展开回答：**

```text
text frame   -> JSON control message -> Protocol/Session
binary frame -> audio packet/PCM     -> audio ringbuf/decoder
```

JSON 适合可读控制消息，binary 适合高频音频数据。

**结合我的项目：**

我让 Protocol 只负责 JSON 构建解析，WebSocketTask 只负责 frame 收发，Session 负责业务状态。音频数据不塞进 JSON queue。

**继续追问：**

如果 binary 是 Opus packet，要保留 frame 边界；如果是 PCM 字节流，可以按字节流写 ringbuf。

### Q6：断线重连、超时、心跳怎么做？

**短答：**

需要区分连接建立超时、读写超时、心跳超时和业务会话超时。断线后清理当前 session，按退避策略重连。

**展开回答：**

常见策略：

```text
connect timeout
read/write timeout
ping/pong or app heartbeat
network state event
reconnect backoff
session reset
```

**结合我的项目：**

如果 WebSocket 断开，音频链路和会话状态都要收口，不能让播放器、编码器、Session 保留旧状态继续跑。

**继续追问：**

超时不能太短，否则弱网下误断；也不能太长，否则真断线后业务长期卡死。

### Q7：什么是背压？ringbuf 满了为什么可以反压 TCP？

**短答：**

背压是下游处理不过来时，通过阻塞或限速让上游放慢。设备不继续读 socket，TCP 接收窗口会变小，服务端发送会被阻塞。

**展开回答：**

数据链路：

```text
Player 慢 -> PCM ringbuf 满
Decoder 写不进 -> Opus ringbuf 满
WebSocketTask 写不进 -> 不继续读 socket
TCP receive window 收缩 -> server send 阻塞
```

**结合我的项目：**

下行音频突发时，如果设备侧无限读 socket 但队列放不下，就会 drop。更合理的是让下游满时阻塞 WebSocket 接收，用 TCP 自然背压约束服务端。

**继续追问：**

背压要求链路每一层都能阻塞或限速。如果服务端异步无限入队，TCP 背压可能只阻塞发送 task，不会约束上游生产。

### Q8：JSON 控制消息和 binary 音频数据为什么要分开？

**短答：**

因为控制消息小、低频、需要解析；音频数据大、高频、需要连续传输。混在一起会影响实时性和模块边界。

**展开回答：**

如果把音频塞进 JSON，体积会变大，还要 base64 编码，增加 CPU 和带宽。控制消息和音频分通道处理更清晰。

**结合我的项目：**

我的项目里 JSON queue 负责 `session_start`、`output_text`、`turn_done` 等控制消息；audio ringbuf 负责 binary 音频数据。

**继续追问：**

虽然 WebSocket 只有一个 TCP 连接，但 frame 类型可以让应用层区分控制和数据。

### Q9：网络不稳定时怎么定位？

**短答：**

按层定位：Wi-Fi、IP、DNS、TCP、TLS、WebSocket、应用协议、音频数据流。

**展开回答：**

要看：

```text
Wi-Fi disconnect reason
got IP event
DNS resolve
connect/handshake result
read/write timeout
WebSocket close reason
session error
audio drop/rebuffer
```

**结合我的项目：**

我会同时保存设备串口日志和服务端日志，对齐时间线，看断开前是否有写阻塞、读超时、队列满、服务端 close 或协议错误。

**继续追问：**

不要只看设备日志，也要看服务端是否主动断开、是否收到完整音频、是否超时。

## 易错回答

- 把 Wi-Fi connected 当成业务可用。
- 说 TCP 不会丢数据，所以应用不需要处理异常。
- 不知道 TCP 是字节流、WebSocket 才有 frame。
- 所有数据都走 JSON。
- 队列满了直接丢，不考虑背压。

## 最后 30 秒总结

```text
我理解 IoT 网络通信要分层看：Wi-Fi 连接、IP 获取、TCP/TLS/WebSocket 建立和应用 session 都是不同状态。项目里我把 JSON 控制消息和 binary 音频数据分开，WebSocket 负责 frame 搬运，Session 负责协议状态。遇到弱网或播放断续，会结合读写超时、队列深度和 TCP 背压分层定位。
```

