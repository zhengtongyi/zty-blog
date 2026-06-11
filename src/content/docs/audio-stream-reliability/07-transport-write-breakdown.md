---
title: 07 Transport 写入分层：poll 与 payload write 的阻塞边界
description: 通过 ESP-IDF transport 临时观测补丁拆解 esp_transport_write() 内部耗时，分析 Cloudflare 路径下约 300ms 发送尾延迟主要来自哪里。
---

第 6 章已经验证：

> 把 WebSocket binary PCM frame 从 `1024B` 聚合到 `4096B` 明确有效，但仍不足以让 Cloudflare 路径追上实时 PCM 生产速率。

本章继续下钻 `esp_transport_write()`，目标不是继续调整业务参数，而是回答一个更底层的问题：

> Cloudflare 路径下约 `300ms` 的发送尾延迟，主要花在 WebSocket 层、TLS/TCP write、socket 可写等待，还是服务端接收之后？

本轮结论是：

> **主要瓶颈不是 TLS 加密 CPU，也不是服务端收到数据后的业务处理，而是设备侧写入前后的 socket / 路径可写背压。**

其中最关键的两个观测点是：

- `ws_parent_poll_ms`：WebSocket transport 在写 header/payload 前，等待 parent transport 变为可写。
- `payload_write_ms`：真正把 binary payload 写入 parent transport 时消耗的时间。

这两个指标都不是 WebSocket RTT，也不是“服务器处理耗时”。它们描述的是设备侧发送调用返回前，底层 TCP/TLS/socket 路径能否及时接收这批字节。

## 先理解 `esp_transport_write()` 背后的流程

在业务代码里，`WebSocketTask` 看到的发送接口很简单：

```text
esp_transport_write(ws_transport, data, len, timeout_ms)
```

但这个接口背后不是一次单纯的 `send()`。在当前音频上行链路里，一帧 PCM 从产生到写入公网路径，大致经过：

```text
SRService
-> audio_tx_ringbuf
-> WebSocketTask
-> esp_transport_write(ws_transport, pcm_frame)
   -> WebSocket transport
      -> 生成 WebSocket frame header
      -> 对 client-to-server payload 做 mask
      -> 等待 parent transport 可写
      -> 写 WebSocket header
      -> 写 WebSocket payload
   -> parent transport
      -> ws:// 走 TCP transport
      -> wss:// 走 SSL/TLS transport
         -> TLS record / mbedTLS write
         -> socket send
   -> Wi-Fi / TCP / 公网 / Cloudflare Edge / Tunnel / origin
```

所以，`esp_transport_write()` 的耗时至少可能来自几类位置：

| 环节 | 含义 | 可能变慢的原因 |
|---|---|---|
| WebSocket header 构造 | 生成 opcode、payload length、mask 等 frame header | 通常很轻，不应成为主瓶颈 |
| payload mask | WebSocket client-to-server 必须对 payload 做 mask | 与 payload 大小相关，但本轮实测接近 0ms |
| `ws_parent_poll_ms` | WebSocket 写 header/payload 前，等待 parent transport 可写 | socket 发送缓冲不足、TCP 可写窗口受限、代理路径 drain 速度不足 |
| `header_write_ms` | 把 WebSocket header 写入 parent transport | 小数据写，若很慢通常说明底层已经背压 |
| `payload_write_ms` | 把 PCM payload 写入 parent transport | payload 较大时可能被 TLS/TCP/socket 缓冲与公网路径拖住 |
| parent `poll_ms` | TCP/SSL transport 内部再次等待 socket 可写 | 底层 socket 不可写 |
| parent `write_ms` | TCP `send()` 或 `mbedtls_ssl_write()` 实际写入耗时 | TLS record、socket send、TCP 缓冲、网络路径共同影响 |

## `poll_write` 到底在等什么

先给结论：

> `poll_write` 等待的是**本机 socket/TCP/TLS 发送路径可写**，不是等待服务器应用层收到数据，也不是等待 WebSocket 对端返回 ACK。

在 ESP-IDF v5.5.3 当前 transport 实现里，WebSocket 发送路径大致是：

```text
transport_ws.c::_ws_write()
-> esp_transport_poll_write(ws->parent, timeout_ms)
-> esp_transport_write(ws->parent, websocket_header, ...)
-> esp_transport_write(ws->parent, payload, ...)
```

其中 parent transport 是 TCP 或 SSL/TLS。它们最终都会走到 `transport_ssl.c::base_poll_write()`，核心行为是：

```text
select(sockfd + 1, NULL, &writeset, &errset, timeout)
```

因此 `poll_write` 的三类返回可以理解为：

| 返回 | 含义 | 对发送链路的影响 |
|---|---|---|
| `ret > 0` 且没有 `errset` | socket 当前可写 | 可以继续尝试写 WebSocket header / payload |
| `ret == 0` | 等到 timeout 仍不可写 | 本次发送超时，业务层会看到 send call 变慢或失败 |
| `errset` 或 `ret < 0` | socket 出错 | 连接异常，需要关闭或重连 |

这里的“可写”不是说服务端已经收到这一帧，也不是说这一帧已经穿过 Cloudflare 到达 origin。它只表示：**本机 TCP/IP 栈认为当前 socket 至少可以继续接收一部分待发送字节。**

更具体地说，通常需要同时满足这些条件：

- TCP 连接仍然有效，没有 `SO_ERROR`；
- 本地 lwIP socket send buffer 有可用空间；
- TCP 发送窗口没有被耗尽；
- 对端接收窗口不是长期为 0；
- 拥塞窗口允许继续放入新数据；
- Wi-Fi、公网、Cloudflare Edge/Tunnel、origin 这一整条路径正在把前序数据 drain 掉；
- 对 WSS 来说，TLS 层还能把明文封成 TLS record，并把密文继续交给底层 socket。

如果这些条件已经满足，`select()` 会很快返回，`esp_transport_write()` 基本不需要等待。  
如果这些条件不满足，`select()` 就会一直等到以下事件之一发生：

- 之前发送的数据被 ACK，释放发送窗口；
- 对端更新 receive window；
- 本地 socket send buffer 被底层 TCP 栈消化出空间；
- 网络路径从拥塞或代理背压中恢复一部分；
- 等到 `timeout_ms` 后返回超时；
- socket 出错。

![poll_write 等待条件与发送窗口示意图](/images/audio-link-poll-write-window.svg)

需要注意一个细节：`poll_write` 只说明“现在可以尝试写”，不保证**本次 payload 的全部字节**都会毫无等待地写完。  
所以本轮观测里同时看两个指标：

| 指标 | 解释 |
|---|---|
| `ws_parent_poll_ms` | 写 WebSocket header/payload 之前，等待 parent transport 可写的时间。 |
| `payload_write_ms` | 已经开始写 payload 后，TLS/TCP/socket 接收这批 payload 的耗时。 |

如果 `ws_parent_poll_ms` 高，说明写之前 socket 就不可写。  
如果 `payload_write_ms` 高，说明开始写之后，这批 payload 仍然被 TLS/TCP/socket 缓冲和公网路径拖住。

这也解释了后续为什么压缩数据能降低 `esp_transport_write()` 的等待时间：

```text
每秒待发送字节更少
-> send buffer 被消耗得更慢
-> TCP 发送窗口更不容易被占满
-> 前序数据 ACK/drain 更容易追上生产速度
-> poll_write 更常立即返回
-> payload_write 更少被长时间拖住
```

换句话说，Opus 不是改变了 `poll_write` 的判断逻辑，而是把上行数据率从裸 PCM 的约 `256kbps` 降到约 `20kbps`，让当前公网路径更容易保持“可写”状态。

这也解释了为什么只看业务层的 `ws_send_call_ms` 不够。它只能说明：

```text
WebSocketTask 这一帧 send 调用花了多久才返回
```

但不能区分：

- 是 WebSocket 组帧慢；
- 是 TLS 加密慢；
- 是 socket 一直不可写；
- 还是 payload 写入过程中被下层路径拖住。

更重要的是，`esp_transport_write()` 在当前发送任务里是阻塞式调用。它没有返回之前，`WebSocketTask` 不能继续从 `audio_tx_ringbuf` 取下一帧 PCM。只要这个调用长期慢于 PCM 生产速率，结果就是：

```text
send call 阻塞
-> audio_tx_ringbuf 积压
-> ringbuf 接近满
-> 新生产 PCM 写不进去
-> dropped_bytes / drop_count 增加
```

因此，本章不是为了研究一个孤立 API 的耗时，而是为了判断：

```text
上行 PCM 链路跟不上实时生产速率时，背压到底出现在 send 调用内部的哪一层。
```

## 本轮观测方法

为了避免把业务层统计和 ESP-IDF transport 内部行为混在一起，本轮对本机 ESP-IDF 做了测试专用临时补丁。

补丁只用于本轮测试，测试结束后已经恢复，不进入业务仓库。

### WebSocket transport 观测点

在 ESP-IDF 的 WebSocket write 路径中，一次 binary PCM 发送大致可以拆成：

```text
WebSocketTask
-> esp_transport_write(ws_transport, pcm)
   -> _ws_write()
      -> build websocket header
      -> mask payload
      -> parent_transport->poll_write()
      -> parent_transport->write(header)
      -> parent_transport->write(payload)
```

本轮新增日志前缀：

```text
IDF_WS_WRITE_TRACE
```

记录字段：

```text
seq
opcode
payload_len
header_len
ws_parent_poll_ms
mask_ms
header_write_ms
payload_write_ms
total_ms
ret
```

### Parent transport 观测点

WebSocket 的 parent transport 取决于 URI：

| URI | parent transport |
|---|---|
| `ws://...` | TCP |
| `wss://...` | SSL/TLS |

本轮在 parent write 中新增日志前缀：

```text
IDF_PARENT_WRITE_TRACE
```

记录字段：

```text
seq
kind=ssl|tcp
len
poll_ms
write_ms
total_ms
ret
errno
```

这样可以区分：

- WebSocket 自己等待 parent 可写的时间；
- parent transport 内部再次 `poll_write` 的时间；
- TCP `send()` 或 TLS `mbedtls_ssl_write()` 的实际写入时间。

## 测试条件

本轮不重复完整四象限矩阵，只保留最小定位矩阵：

| 条件 | Frame | 重复 | 目的 |
|---|---:|---:|---|
| LAN WSS | 4096B | 1 | 验证观测补丁没有明显污染健康链路 |
| Cloudflare WSS | 1024B | 2 | 复现小 frame 下高发送尾延迟 |
| Cloudflare WSS | 4096B | 2 | 观察聚合后的耗时分布 |
| Cloudflare WS | 1024B | 2 | 排除 TLS 变量 |
| Cloudflare WS | 4096B | 2 | 对照 WS 与 WSS 的聚合效果 |

统一条件：

| 条件 | 配置 |
|---|---|
| 设备 | ESP32-S3，COM6 |
| Wi-Fi | 同一 AP |
| PCM | `16kHz / 16bit / mono` |
| 运行时间 | 每轮 `10s` |
| Server | metrics-only WebSocket server |
| 业务模块 | 不启用 ASR、Agent、TTS、UI |
| Cloudflare host | `pixel-soul.gpt0417.space` |

证据目录：

```text
cloud_new/tests/record/audio_link_transport_trace_20260611_123027/
```

关键文件：

```text
run_config.json
device_*.log
server_events.jsonl
matrix_results.csv
transport_trace.jsonl
transport_trace.csv
transport_breakdown.csv
verdict.json
summary.md
```

## 总体结果

| 条件 | Frame | 功能通过 | sent/produced 中位数 | sent kbps 中位数 | send P95/KB 中位数 | 最大积压中位数 | 总丢弃 | 判定 |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| LAN WSS | 4096B | 1/1 | 0.993 | 216.8 | 9.25ms | 0ms | 0B | PASS |
| Cloudflare WS | 1024B | 2/2 | 0.286 | 62.3 | 262.5ms | 2016ms | 263168B | DEGRADED |
| Cloudflare WS | 4096B | 1/2 | 0.483 | 105.5 | 81.75ms | 1920ms | 160768B | DEGRADED |
| Cloudflare WSS | 1024B | 1/2 | 0.282 | 60.2 | 274.0ms | 2016ms | 133120B | DEGRADED |
| Cloudflare WSS | 4096B | 2/2 | 0.484 | 105.2 | 115.0ms | 1920ms | 160768B | DEGRADED |

可以先得到三个直接结论：

1. `LAN WSS 4096B` 健康，说明 ESP32-S3 + WSS + 4096B frame 本身不是必然慢。
2. Cloudflare WS 与 WSS 都退化，且退化程度接近，不能简单归因为 TLS 加密 CPU。
3. Cloudflare 4096B 比 1024B 好，但仍只能发出约一半实时 PCM，说明聚合有效但没有消除背压。

## Transport 分层结果

| 条件 | Frame | 层级 | 类型 | 样本数 | total P95 | poll P95 | write P95 | ws payload P95 |
|---|---:|---|---|---:|---:|---:|---:|---:|
| LAN WSS | 4096B | parent | ssl | 163 | 5ms | 0ms | 4ms | N/A |
| LAN WSS | 4096B | ws | ws | 81 | 27ms | 0ms | N/A | 11ms |
| Cloudflare WS | 1024B | parent | tcp | 366 | 2ms | 0ms | 1ms | N/A |
| Cloudflare WS | 1024B | ws | ws | 182 | 246ms | 234ms | N/A | 26ms |
| Cloudflare WSS | 1024B | parent | ssl | 183 | 3ms | 1ms | 2ms | N/A |
| Cloudflare WSS | 1024B | ws | ws | 91 | 257ms | 244ms | N/A | 24ms |
| Cloudflare WS | 4096B | parent | tcp | 184 | 230ms | 0ms | 230ms | N/A |
| Cloudflare WS | 4096B | ws | ws | 91 | 311ms | 286ms | N/A | 270ms |
| Cloudflare WSS | 4096B | parent | ssl | 190 | 246ms | 0ms | 245ms | N/A |
| Cloudflare WSS | 4096B | ws | ws | 94 | 310ms | 282ms | N/A | 299ms |

这里有一个重要分界：

- `1024B` 时，主要慢在 WebSocket 层写入前的 `ws_parent_poll_ms`。
- `4096B` 时，`ws_parent_poll_ms` 仍然高，同时 `payload_write_ms` / parent `write_ms` 也开始变高。

这说明问题不是一个简单的“函数内部某行代码慢”，而是发送路径的可写能力已经跟不上 PCM 生产速率。frame 变大以后，单位 KB 成本下降，但一次实际写入更大的 payload 时，底层也更容易被背压拖住。

## 补充验证：首包快，后续慢

为了进一步确认“慢”不是某个固定首包初始化开销，而是持续发送后窗口耗尽，我又补了两组最小实机验证，只测 `Cloudflare WSS + 4096B`：

### 1) 连续发送基线

连续发送时，binary frame 序列非常典型：

```text
s3:t14/p0/w10
s4:t175/p163/w9
s5:t298/p285/w9
s6:t262/p249/w9
s7:t295/p282/w9
```

也就是说：

- 第 1 个 binary frame 很快，`poll=0ms`；
- 第 2~3 个 binary frame 就开始进入 `163~285ms` 的 `poll_write` 等待；
- 后续多数 frame 都稳定落在 `200~300ms` 的区间。

这一点说明：**首包快不代表链路健康，后续慢才暴露出持续背压。**

### 2) Burst + idle

我加了测试宏，让设备侧每发送 4 个 frame 后主动空闲 1000ms，再继续发送。结果里，**每次 idle 之后的下一帧又重新变快**：

```text
after_idle_first: s7:t15/p0/w10 | s13:t14/p0/w10 | s21:t14/p0/w10
```

这说明：

- `poll_write` 不是永久性卡死；
- 暂停发送后，socket / 路径可写窗口会恢复；
- 也就是背压是“可恢复的”，不是一次连接建立后就完全失能。

但 burst+idle 并没有解决整体吞吐问题：

- `sent/produced = 0.235`
- `dropped_bytes = 147456`
- `tx_ringbuf_depth_ms_max = 1920`

所以它只能证明窗口会恢复，不能证明恢复得足够快。

### 3) Pacing 300ms

再把发送节奏固定为每帧后等待 `300ms`。这组结果更说明问题本质：

- `ws_parent_poll_ms P95 = 0ms`
- `poll_write` 基本消失
- 但 `payload_write_ms P95 = 150ms`
- `sent/produced = 0.401`
- `dropped_bytes = 103424`

即：

```text
当发送节奏主动降到接近路径可承载速度时，
poll 阻塞可以明显下降；
但总体吞吐仍不足以跟上 PCM 生产速率。
```

### 这意味着什么

这组补充验证支持如下判断：

1. **不是单次首包初始化慢**。首包确实快，但后续很快开始背压。
2. **不是“只要等 ACK 就一定能稳定恢复”**。窗口确实会恢复，但恢复速度和 drain 速度不足。
3. **不是服务端业务处理慢**。因为服务端只是 metrics-only 接收+回执。
4. **最贴近的解释仍然是：TCP/socket/Cloudflare 路径的持续可写能力小于 PCM 生产速率。**

## 当前网络链路传输模型

为了避免把现象误解成“WebSocket 调用本身固定慢”，这里先把当前模型写清楚。

本项目的发送链路可以抽象成：

```text
SRService
  -> audio tx ringbuf
  -> WebSocketTask
  -> esp_transport_write()
  -> ESP-IDF WebSocket transport
  -> TLS/TCP/lwIP
  -> Wi-Fi
  -> 公网
  -> Cloudflare Edge
  -> Cloudflare Tunnel / origin
  -> metrics-only server
```

其中 `esp_transport_write()` 背后大致不是一次简单的 `send()`，而是：

```text
WebSocket write
  -> poll parent transport 是否可写
  -> 构造并 mask WebSocket frame
  -> write WebSocket header
  -> write WebSocket payload
  -> parent transport 继续进入 TLS/TCP write
  -> lwIP 尝试把数据放入 TCP send buffer / send queue
```

因此，`ws_send_call_ms` / `ws_parent_poll_ms` / `payload_write_ms` 的本质都是：

```text
设备侧把这次 WebSocket binary frame 提交给下层发送路径所花的时间
```

不是服务端回包 RTT，也不是“服务端处理完了”的时间。

### 用水箱模型理解 1024B 与 4096B

当前设备侧 lwIP 参数是：

```text
CONFIG_LWIP_TCP_MSS=1440
CONFIG_LWIP_TCP_SND_BUF_DEFAULT=5760
CONFIG_LWIP_TCP_WND_DEFAULT=5760
CONFIG_LWIP_TCP_TMR_INTERVAL=250
CONFIG_LWIP_TCP_RTO_TIME=1500
```

也就是 TCP send buffer 约为：

```text
5760B ~= 4 * MSS
```

这不是很大的缓冲。可以把它理解为一个小水箱：

```text
PCM producer:         稳定进水，约 32KB/s
lwIP send buffer:     小水箱，约 5.6KB
Cloudflare path:      出水口，drain 速度受公网、Edge、Tunnel、对端窗口影响
WebSocket frame:      每次往水箱里倒的一桶水
```

`1024B` 的模式更像：

```text
等水箱腾出一次空间 -> 倒 1KB -> 很快又要等下一次空间
```

`4096B` 的模式更像：

```text
等水箱腾出一次空间 -> 尽量倒 4KB -> 同一次等待携带更多 PCM
```

所以 `4096B` 的优势不是“扩大了水箱”，而是更充分利用了一次可写机会，把 `poll_write` / write 调用等固定等待摊到更多字节上。

这也解释了为什么 `4096B` 没有比 `1024B` 慢 4 倍：一次 `esp_transport_write(4096)` 进入下层后，TCP 会按 MSS 分段，`4096B / 1440B ~= 2.8` 个 segment；如果当前 send buffer / send queue 空间足够，它可以作为一次较大的提交完成，而不是每 `1KB` 重新经历一次完整的可写等待。

但如果 Cloudflare 路径持续 drain 速度长期低于 PCM 生产速度，水箱最终仍会满。此时无论是 `1024B` 还是 `4096B`，最终都会表现为：

```text
poll_write 变长
payload_write 变长
tx ringbuf 积压
dropped_bytes 增加
```

### 可写窗口大小取决于什么

这里的“可写窗口”不是单个固定变量，而是多个层级共同决定的结果：

```text
应用层可继续写入的机会
≈ 本地 TCP send buffer 剩余空间
+ TCP send queue / pbuf 可用空间
+ 拥塞窗口 cwnd
+ 对端接收窗口 rwnd
+ Wi-Fi 与公网路径的实际 drain 速度
+ Cloudflare Edge / Tunnel 的代理缓冲和转发节奏
+ TLS/WebSocket 分层写入行为
```

更具体到当前配置，`TCP_SND_BUF=5760B`，通常不会是“只要空出 1 字节就立刻可写”。lwIP 还会受 low-water、send queue、pbuf、select/poll 事件触发等条件影响。按常见 low-water 计算方式估算：

```text
TCP_SNDLOWAT ~= min(max(5760 / 2, 2 * 1440 + 1), 5759)
             ~= 2881B
```

这个数值不是本次日志直接测得，而是基于当前 lwIP 配置的近似解释。它的意义是：socket 可写事件通常需要底层缓冲恢复到一定余量，而不是释放几个字节就立即放行应用层。

### 可写窗口如何释放

更谨慎的描述是：

```text
前面写入的数据被 TCP 对端 ACK
并且 lwIP send buffer / send queue 恢复到 low-water 以上
并且 socket writable event 被触发
```

在当前 Cloudflare 路径里，可以近似理解为：

```text
Cloudflare Edge 收到一部分 TCP segment
  -> 回 ACK / 更新 receive window
  -> ESP32 收到 ACK
  -> lwIP 释放 snd_buf / snd_queue
  -> socket 再次变为 writable
  -> poll_write 返回
```

但这里必须保持边界：本轮没有 TCP 抓包，也没有 Cloudflare Edge 内部指标，所以不能把 `300ms` 简化成“某一个 ACK 慢”。它更像是整条路径的 drain 节奏、窗口释放、代理缓冲和设备侧小 send buffer 共同形成的结果。

## 为什么 `poll_write` 会成为阻塞点

`poll_write` 的作用不是发送数据，而是询问或等待：

```text
当前 socket / parent transport 是否可写？
```

如果它很快返回，说明底层发送缓冲区还有空间，应用层可以继续写。

如果它等待了几百毫秒，通常意味着：

```text
应用层想继续写
但底层 TCP/TLS/socket 暂时无法接收更多数据
```

在本项目里，上行 PCM 是稳定生产的：

```text
16kHz * 16bit * 1ch = 32000B/s
```

也就是每秒约 `32KB`。如果公网链路或代理路径只能稳定消化其中一部分，那么设备侧的 TCP 发送缓冲区会逐渐被填满。缓冲区满或接近满时，再调用 WebSocket write，就会先卡在 `poll_write`。

可以把它理解成：

```text
SR producer:      稳定往外生产 PCM
WebSocketTask:    尝试持续写入 socket
TCP/socket path:  实际 drain 速度不足
结果:             poll_write 等待可写窗口
```

这不是服务端业务逻辑慢的直接证据。因为本轮 metrics-only server 没有 ASR、Agent、TTS，且统计显示：

```text
server_received / sent = 1.0
```

也就是说，只要设备端成功写出的数据，server 都收到了。真正丢失的是设备还没来得及写出的 PCM，它们在 TX ringbuf 积压后被丢弃。

### 1024B 的证据

`1024B` 下，parent write 很快：

| 条件 | parent total P95 | parent write P95 |
|---|---:|---:|
| Cloudflare WS 1024B | 2ms | 1ms |
| Cloudflare WSS 1024B | 3ms | 2ms |

但 WebSocket 层 total P95 很高：

| 条件 | ws total P95 | ws parent poll P95 |
|---|---:|---:|
| Cloudflare WS 1024B | 246ms | 234ms |
| Cloudflare WSS 1024B | 257ms | 244ms |

这说明 1024B 小 frame 下，真正占大头的是：

```text
WebSocket write 前等待 parent transport 可写
```

而不是 header 构造、mask、TLS 加密或 TCP send 本身。

## 为什么 `payload_write` 也会成为阻塞点

`poll_write` 返回“可写”不等于后续 payload write 一定瞬间完成。

原因是：

1. `poll_write` 只能说明当时有一定可写空间，不保证足够容纳完整 payload。
2. WebSocket 会先写 header，再写 payload，header 写完后底层可写空间可能已经变化。
3. `4096B` payload 更大，实际写入时可能跨越 TCP 发送缓冲、TLS record 或 mbedTLS 内部缓冲边界。
4. 如果 Cloudflare Edge / Tunnel / 网络路径整体 drain 速度不足，payload write 也可能边写边等。

因此 `payload_write_ms` 高，更接近表示：

```text
设备已经开始把这帧 PCM 往下写
但底层 transport 没有足够快地接收完整 payload
```

它仍然不是应用层 RTT，也不代表服务端处理慢。它只是说明当前这次写调用在设备侧返回前，被下层发送路径阻塞。

### 4096B 的证据

`4096B` 下，Cloudflare WS/WSS 的 parent write 和 WebSocket payload write 都明显升高：

| 条件 | ws total P95 | ws parent poll P95 | ws payload P95 | parent write P95 |
|---|---:|---:|---:|---:|
| Cloudflare WS 4096B | 311ms | 286ms | 270ms | 230ms |
| Cloudflare WSS 4096B | 310ms | 282ms | 299ms | 245ms |

这组数据说明：

- 聚合后每次调用携带更多数据，所以 `send_ms_per_kb` 明显下降；
- 但单次 write 仍被 Cloudflare 路径拖到约 `300ms`；
- WebSocket 层等待可写和真正写 payload 都出现阻塞；
- WS 与 WSS 的形态接近，因此不能把主要矛盾归结为 TLS 加密。

换句话说，`4096B` 聚合不是让链路变快了，而是让每次被阻塞时携带更多有效 PCM，从而摊薄了每 KB 成本。

## 为什么不是 WebSocket RTT

本轮的 `ws_send_call_ms`、`ws_parent_poll_ms`、`payload_write_ms` 都发生在设备侧一次 `send` 调用返回之前。

它们的含义是：

```text
设备把数据交给底层 transport 所花的时间
```

而不是：

```text
设备发送 -> 服务端收到 -> 服务端响应 -> 设备收到响应
```

真正更接近应用层 RTT 的是第 3 章定义的：

```text
audio_report_rtt_ms = audio_sr 发出到 audio_rr 返回的时间
```

本轮 Cloudflare 链路中，`audio_report_rtt_ms` 也在秒级波动，但它不能替代 transport write 分层。因为 `audio_rr` 是应用层 JSON 回执，会受到排队、事件调度和控制帧发送时机影响；而本章关注的是上行 PCM binary write 为什么在设备侧变慢。

## 为什么不是服务端业务处理慢

本轮使用的是 metrics-only server，不启用：

```text
ASR
Agent
TTS
UI
播放
```

服务端只负责接收 WebSocket binary PCM，并回 `audio_rr`。

关键证据是：

```text
server_received / sent = 1.0
```

也就是：

- 设备成功写出的 binary PCM，服务端都收到；
- 当前 `sent/produced` 低，是因为设备没有把生产出来的 PCM 都成功写出去；
- 丢弃发生在设备侧 TX ringbuf 积压之后，而不是服务端收到后丢弃。

因此，本轮不能证明 Cloudflare origin 后面的业务慢；它指向的是：

```text
ESP32 -> Wi-Fi -> 公网 -> Cloudflare Edge -> Tunnel/origin
```

这条发送路径的持续可写能力不足。

## 对 TLS 的判断

本轮不能说 TLS 完全没有成本，但可以说：

> TLS 不是当前约 `300ms` 尾延迟的主要解释。

原因：

| 对照 | 现象 |
|---|---|
| LAN WSS 4096B | `send P95/KB = 9.25ms`，无丢弃 |
| Cloudflare WS 1024B | `send P95/KB = 262.5ms` |
| Cloudflare WSS 1024B | `send P95/KB = 274.0ms` |
| Cloudflare WS 4096B | `send P95/KB = 81.75ms` |
| Cloudflare WSS 4096B | `send P95/KB = 115.0ms` |

如果 TLS 加密 CPU 是主因，应该看到：

```text
LAN WSS 也明显慢
或 Cloudflare WSS 显著慢于 Cloudflare WS
```

但实际结果是：

- LAN WSS 健康；
- Cloudflare WS 也慢；
- Cloudflare WSS 比 WS 略差，但不是数量级差异。

因此更合理的判断是：

```text
Cloudflare 路径背压是主因，TLS 可能是额外成本，但不是第一瓶颈。
```

## 与第 6 章的关系

第 6 章回答的是：

> 增大 frame 是否有效？

答案是：

```text
有效，但不足。
```

本章回答的是：

> 为什么增大 frame 有效，但仍不足？

答案是：

```text
因为 Cloudflare 路径存在明显 per-write / 可写窗口背压。
4096B 只是减少了 write 次数，并把固定等待摊薄到更多字节上；
它没有提升底层路径的实际 drain 速度。
```

用数据表达就是：

| 条件 | 1024B sent/produced | 4096B sent/produced | 1024B P95/KB | 4096B P95/KB |
|---|---:|---:|---:|---:|
| Cloudflare WS | 0.286 | 0.483 | 262.5ms | 81.75ms |
| Cloudflare WSS | 0.282 | 0.484 | 274.0ms | 115.0ms |

聚合让单位 KB 成本下降，但 `tx_ringbuf_depth_ms_max` 仍接近 `1920ms`，说明发送链路仍长期低于生产速率。

## 当前结论

本轮对原假设的判断：

| 假设 | 结论 | 证据 |
|---|---|---|
| socket / 路径背压成立 | 成立 | Cloudflare WS/WSS 都出现高 `ws_parent_poll_ms`，LAN WSS 正常 |
| WebSocket header/payload split 是主因 | 不作为主因 | header write 不高，1024B 主要卡 poll，4096B payload 也高但更像下层背压结果 |
| TLS 路径是主因 | 不成立 | Cloudflare WS 也慢，LAN WSS 健康 |
| 观测补丁污染测试 | 不成立 | LAN WSS 4096B `sent/produced=0.993`，无丢弃 |
| 服务端业务处理慢 | 不成立 | metrics-only server，且 `server_received/sent=1.0` |
| 首包快、后续慢 | 成立 | Cloudflare 连续发送中首个 binary `poll=0ms`，第 2~3 帧开始进入百毫秒级等待 |
| ACK/窗口恢复参与阻塞 | 方向成立，但不是唯一根因 | burst idle 后首帧恢复为 `poll=0ms`，pacing 后 `poll P95=0ms`；但没有抓包，不能单独归因为某个 ACK 行为 |

最终判断：

```text
Cloudflare path backpressure = PRIMARY
TLS overhead = SECONDARY / not primary in this test
Frame aggregation = PARTIAL mitigation
```

如果用 TCP 语言表达，更谨慎的说法是：

```text
连续 PCM 写入消耗了本地 socket/TCP 发送缓冲和可写窗口；
后续发送需要等待窗口释放、ACK 推进或 Cloudflare/Tunnel 路径继续 drain；
但当前没有 TCP 抓包证据，不能把根因简化成“单个 ACK 慢”。
```

## 下一步

下一轮不建议继续在 `esp_transport_write()` 里无限加日志。当前瓶颈层级已经足够清楚，后续应转向可落地方案对照。

优先级建议：

1. **动态聚合策略**
   - `max_frame_bytes = 4096B`
   - `max_aggregation_wait_ms = 80~120ms`
   - `vad_end_flush`
   - 目标是在不牺牲过多首包延迟的前提下，提高单位 write 的有效负载。
   - 不建议直接采用固定 `300ms` pacing；它能降低 `poll_write`，但会让裸 PCM 发送速率低于生产速率，仍然积压和丢弃。

2. **降码率方案**
   - 测试 Opus / ADPCM / 8k PCM。
   - 如果 Cloudflare 路径稳定可承载吞吐只有约 `100kbps`，裸 `16kHz/16bit/mono PCM` 会长期处于风险区。

3. **路径替代验证**
   - 有公网 origin 后，对比不经过 Cloudflare Tunnel 的直连路径。
   - 当前没有公网服务器，因此这项暂时只能保留为后续验证。

4. **保留观测接口，但移除 SDK 补丁依赖**
   - 业务仓库继续保留 `AudioLinkObserver` 的应用层指标。
   - ESP-IDF transport 内部日志只作为专项定位工具，不应成为长期依赖。

本章的工程价值不是“找到一个立刻改完的参数”，而是把瓶颈从“WebSocket 发送慢”收敛为：

```text
公网 Cloudflare 路径下，设备侧持续发送 PCM 时，
socket 可写窗口与 payload write 都会出现百毫秒级背压；
聚合能摊薄成本，但不能提升底层链路 drain 能力。
```

这为下一步选择“动态聚合”还是“音频压缩/降码率”提供了依据。
