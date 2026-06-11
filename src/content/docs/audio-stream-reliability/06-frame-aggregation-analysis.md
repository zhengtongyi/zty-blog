---
title: 06 Frame 聚合单变量实验：有效，但不足以消除背压
description: 固定 Cloudflare 路径和 PCM 生产条件，对比 1024B、2048B、4096B WebSocket binary frame，分析聚合为何改善吞吐、每帧固定开销来自哪里，以及为什么 4096B 仍未解决发送积压。
---

第 5 章确认了一个边界：

> LAN WS/WSS 基本健康，Cloudflare WS/WSS 均出现持续发送背压，因此不能把问题简单归因为设备侧 TLS。

本章继续控制变量，只调整设备每次发送的 WebSocket binary PCM 大小，回答：

> 当前 Cloudflare 链路是否存在明显的每帧或每次发送固定成本？增大 frame 能否让发送速率追上 PCM 生产速率？

本轮结论是：

> **聚合明确有效，但只改善了单位数据的发送效率，没有消除 Cloudflare 路径上的持续背压。**

`4096B` 相比 `1024B` 显著降低了单位 KB 的发送调用耗时，并提升了实际吞吐；但设备仍只能发出约一半的实时 PCM，TX ringbuf 仍接近满载，因此不能把聚合作为问题已经解决的证据。

## 测试目标与假设

本轮验证三个可证伪假设。

### H1：小 frame 固定开销是主要瓶颈

如果成立，增大 frame 后应出现：

- `sent/produced` 明显提高；
- 每秒 `send` 调用次数减少；
- `send_ms_per_kb` 明显降低；
- TX ringbuf 积压和 PCM 丢弃明显下降。

### H2：Cloudflare 路径存在 per-message 或 per-write 背压

如果成立：

- 单次 `esp_transport_write()` 的尾延迟可能仍在相近区间；
- 但一次调用携带更多 PCM 后，单位 KB 成本应明显下降；
- `4096B` 应比 `1024B` 获得更高吞吐。

### H3：问题与 frame 大小关系不大

如果成立：

- `1024B / 2048B / 4096B` 的 `sent/produced` 接近；
- 单位 KB 发送成本没有明显下降；
- ringbuf 和丢弃量基本不变。

## 测试条件

测试继续使用最小链路：

```text
SR PCM producer
-> audio_tx_ringbuf
-> WebSocketTask
-> Cloudflare WS/WSS
-> metrics-only server
-> audio_sr/audio_rr
```

不启用 ASR、Agent、TTS 和 UI，避免把云端业务处理时间混入上行 PCM 发送结果。

统一条件：

| 条件 | 配置 |
|---|---|
| 设备 | 同一台 ESP32-S3 |
| 网络 | 同一 Wi-Fi AP |
| PCM | 16kHz / 16bit / mono |
| 运行时间 | 每轮 15 秒 |
| TX ringbuf | 64KiB |
| Frame | 1024B / 2048B / 4096B |
| Cloudflare | WS 与 WSS 各 3 轮，交错执行 |
| LAN sanity | LAN WSS 1024B / 4096B 各 1 轮 |
| Server | 同一个 metrics-only server |

本轮没有测试 `8192B`，因为当前 `WebSocketTask` 的单帧缓冲上限是：

```c
#define WEBSOCKET_TASK_AUDIO_BUFFER_SIZE 4096U
```

没有为了实验扩大生产代码的默认发送缓冲。

## 指标口径

除第 5 章已有指标外，本轮增加了归一化指标：

| 指标 | 含义 |
|---|---|
| `produced_kbps` | SR 实际 PCM 生产速率 |
| `sent_kbps` | 设备实际成功提交给 WebSocket transport 的速率 |
| `sent/produced` | 发送端能否追上生产端 |
| `send_ms_per_kb_p95` | 单次发送 P95 除以平均每帧 KB 数 |
| `server_received/sent` | 成功发送的数据是否到达 server |
| `first_binary_delay_ms` | server 从收到 `session_start` 到收到首个 binary frame 的时间 |

必须再次强调：

```text
ws_send_call_ms != TCP RTT
ws_send_call_ms != WebSocket 应答 RTT
```

它只是设备本地调用 `esp_transport_write()` 到调用返回的耗时。

## 实测结果

证据 run：

```text
audio_link_frame_matrix_20260611_104322
```

### Cloudflare 主测试

| 路径 | Frame | 有效轮次 | sent/produced 中位数 | sent 中位数 | send P95 | send P95/KB | 最大积压中位数 | 总丢弃 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Cloudflare WS | 1024B | 3/3 | 35.8% | 78.4kbps | 299ms | 299.0ms/KB | 2016ms | 632832B |
| Cloudflare WS | 2048B | 2/3 | 32.9% | 71.7kbps | 313.5ms | 156.8ms/KB | 1984ms | 424960B |
| Cloudflare WS | 4096B | 3/3 | 48.0% | 105.7kbps | 337ms | 84.3ms/KB | 1920ms | 452608B |
| Cloudflare WSS | 1024B | 3/3 | 27.0% | 58.7kbps | 302ms | 302.0ms/KB | 2016ms | 710656B |
| Cloudflare WSS | 2048B | 2/3 | 47.9% | 104.8kbps | 305ms | 152.5ms/KB | 1984ms | 304128B |
| Cloudflare WSS | 4096B | 3/3 | 50.4% | 110.9kbps | 316ms | 79.0ms/KB | 1920ms | 436224B |

实际 `produced_kbps` 中位数约为 `218-220kbps`，约 `27.3-27.5KB/s`。这是本轮实测生产速率；理论上的连续 16kHz/16bit/mono PCM 码率为 `256kbps`，两者不能混写。

### LAN sanity

| 路径 | Frame | sent/produced | sent | send P95 | send P95/KB | 最大积压 | 丢弃 |
|---|---:|---:|---:|---:|---:|---:|---:|
| LAN WSS | 1024B | 100.2% | 219.1kbps | 7ms | 7.0ms/KB | 32ms | 0B |
| LAN WSS | 4096B | 100.0% | 220.4kbps | 18ms | 4.5ms/KB | 0ms | 0B |

LAN WSS 两组都能跟上生产速率，说明：

- 固件生产、ringbuf 和发送主流程仍可用；
- ESP32 做 TLS 加密并不会天然产生约 `300ms` 的单帧尾延迟；
- Cloudflare 组的退化不能仅用“ESP32 算力不足以跑 TLS”解释。

### 无效样本

两轮 `2048B` 测试没有进入有效性能阶段：

- Cloudflare WSS 第 2 轮；
- Cloudflare WS 第 3 轮。

日志均表现为 WebSocket Upgrade 响应读取失败，随后 session timeout：

```text
transport_ws: Error read response for Upgrade header
websocket_task: connect failed
```

它们属于连接级失败，不是 PCM 发送性能样本，已从延迟、积压和吞吐中位数中排除。因此 `2048B` 的统计置信度低于 `1024B/4096B`，本章主要用 `1024B` 与 `4096B` 判断聚合趋势。

## 聚合为什么有效

### 1. 单次发送的尾延迟没有随 payload 线性增长

Cloudflare WSS：

```text
1024B send P95 = 302ms
2048B send P95 = 305ms
4096B send P95 = 316ms
```

payload 从 `1KB` 增加到 `4KB`，单次 P95 只增加了约 `14ms`，并没有接近增长 4 倍。

因此，当前发送耗时中存在较大的非 payload 线性部分：

```text
send_time ~= fixed_wait_or_call_cost + payload_dependent_cost
```

把更多 PCM 放进同一次发送调用，可以摊薄前面的固定等待或固定调用成本。

### 2. 单位 KB 成本显著下降

Cloudflare WSS：

```text
1024B: 302.0ms/KB
4096B: 79.0ms/KB
降低约 73.8%
```

Cloudflare WS：

```text
1024B: 299.0ms/KB
4096B: 84.3ms/KB
降低约 71.8%
```

这比 WebSocket header 少几个字节带来的收益大得多，说明真正改善的是：

- 每次 transport 调用携带的数据量；
- 每 KB 需要经历的发送调用次数；
- 每 KB 需要经历的发送循环和代理 message 处理次数。

### 3. 每秒 WebSocket message 数减少

按本轮约 `27.5KB/s` 的 PCM 生产速率估算：

```text
1024B: 约 27.5 frame/s
2048B: 约 13.8 frame/s
4096B: 约 6.9 frame/s
```

从 `1024B` 增加到 `4096B` 后，每秒需要创建和发送的 WebSocket binary message 数降到约四分之一。

### 4. 当前任务循环每轮最多发送 4 帧

当前 `WebSocketTask` 主循环是：

```text
发送 JSON queue
-> 最多发送 4 个 audio frame
-> 接收一次 WebSocket frame
-> 下一轮
```

所以每轮最多搬运：

```text
1024B frame: 4KB PCM
4096B frame: 16KB PCM
```

frame 增大后，每传输相同 PCM 所需经历的任务循环、ringbuf 读取和接收轮询次数都减少了。

这一点属于当前设备实现的放大因素，不能全部归因于 Cloudflare。

### 5. 已成功发送的数据基本都到达 server

各有效组：

```text
server_received/sent ~= 100%
```

这说明聚合改善的重点不是修复“网络把已发送数据随机丢失”，而是提高设备从 ringbuf 向 transport 提交 PCM 的速度。

## 每帧固定开销来自哪里

这里的“固定开销”不是单一费用，而是一次 WebSocket frame 从设备到 server 需要重复经过的一组动作。

### 设备任务与 ringbuf

每帧都会发生：

- 检查 ringbuf 水位；
- 从 ringbuf 复制到发送缓冲；
- 调用 `websocket_send_binary()`；
- 更新发送统计；
- 每最多 4 帧后进入一次接收检查。

这些操作中，ringbuf 复制随 payload 增长，但函数调用、状态判断和循环切换包含每帧固定部分。

### WebSocket 封装

ESP-IDF WebSocket transport 对一次 binary frame 会：

1. `poll_write(parent)`；
2. 构造 WebSocket header；
3. 对客户端 payload 执行 mask；
4. 单独写 header；
5. 再单独写 payload。

对 `1024B / 2048B / 4096B` 客户端 binary frame，WebSocket header 通常约为：

```text
2B base header
+ 2B extended payload length
+ 4B masking key
= 8B
```

header 字节占比并不大：

| Payload | 约 8B header 占比 |
|---:|---:|
| 1024B | 0.78% |
| 2048B | 0.39% |
| 4096B | 0.20% |

所以本轮收益不能主要解释为“少发送了几个 header 字节”。更重要的是减少了：

- WebSocket frame 构造次数；
- header write 次数；
- payload write 次数；
- `poll_write()` 和 transport 调用次数。

客户端 mask 是对整个 payload 执行 XOR，属于随 payload 增长的 CPU 开销，不是纯固定成本。

### TLS/WSS

WSS 下，底层还要经过：

- TLS record 组装；
- 加密和认证；
- mbedTLS 缓冲与状态处理；
- TLS record header、认证标签等附加数据；
- 将密文写入 TCP。

由于 WebSocket header 和 payload 在当前实现中是两次 parent write，它们可能触发独立的 TLS 处理；是否最终合并为同一 TLS record，需要更底层的观测才能确认。

TLS 加密计算通常随 payload 增长，但 TLS API 调用、record 处理和底层 write 也有每次调用成本。

现有证据不支持把 `300ms` 主要归因于加密计算：

```text
LAN WSS 1024B send P95 = 7ms
LAN WSS 4096B send P95 = 18ms
```

如果 ESP32 单纯完成一次 TLS 加密就需要约 `300ms`，LAN WSS 也应该表现出相近延迟。

### TCP/IP 与 Wi-Fi

一次 WebSocket frame 进入 TCP 后，还可能发生：

- 等待 socket send buffer 可写；
- TCP 分段；
- ACK、重传和拥塞控制；
- Wi-Fi MAC 成帧、确认和链路层重传；
- lwIP buffer 分配、复制和锁操作。

`4096B` WebSocket payload 通常不会等于一个 TCP segment，而会按 MSS 和当前 TCP 状态继续分段。

因此：

```text
一个 WebSocket frame != 一个 TCP packet
一次 send 返回 != 对端应用已经处理
```

### Cloudflare Edge、Tunnel 与 server

每个 WebSocket message 还会经过：

- Cloudflare Edge 接收和解析；
- Edge 到 Tunnel 连接之间的转发；
- `cloudflared` 用户态处理；
- Tunnel 封装、多路复用和缓冲；
- origin Python `websockets` message 解析与任务调度。

这些环节可能存在 per-message 成本或缓冲策略，但当前设备指标无法把它们逐层分离。因此目前只能说：

> 实测结果与“Cloudflare 路径存在明显 per-message/per-write 成本或背压”一致，但尚不能证明具体耗时发生在 Edge、Tunnel、TCP 还是设备 socket 可写等待。

## 1024B 与 4096B 的传输模型差异

`4096B` 比 `1024B` 有效，并不是因为 `esp_transport_write()` 自动扩大了 TCP 发送缓冲，也不是因为公网链路本身突然变快。

更贴近当前数据的模型是：

```text
ESP32 lwIP send buffer = 小水箱，容量有限
Cloudflare 路径 drain = 出水口，持续流出速度有限
PCM producer = 稳定进水，约 32KB/s
WebSocket frame = 每次向水箱提交数据的桶
```

`1024B` 时：

```text
等待一次可写窗口恢复 -> 只提交 1KB PCM -> 很快再次等待
```

`4096B` 时：

```text
等待一次可写窗口恢复 -> 尽量提交 4KB PCM -> 等待次数减少
```

所以聚合真正改善的是：

```text
一次阻塞等待对应的有效 PCM 字节数变多
```

而不是：

```text
底层链路 drain 速度变快
TCP send buffer 变大
Cloudflare RTT 变短
```

换成工程语言：

- `1024B` 更容易把时间消耗在频繁的 `poll_write()` / write 调用上；
- `4096B` 单次调用也会阻塞，但一次阻塞可以带走更多有效音频；
- 因此 `send_ms_per_kb` 明显下降，`sent/produced` 提升；
- 但如果路径长期只能消化约 `10~14KB/s`，而 PCM 生产约 `32KB/s`，聚合仍然无法根治积压。

这也解释了一个看起来反直觉的现象：`4096B` 没有比 `1024B` 慢 4 倍。

原因是 `esp_transport_write(4096)` 不是每写 `1KB` 就重新等待一次完整链路恢复。应用层一次提交 `4096B` 后，TLS / TCP / lwIP 会尽量把数据塞进发送缓冲和 send queue，后续再由 TCP 按 MSS 分段发送。只要当时可写空间足够，`4096B` 可以作为一次更大的提交完成；如果空间不足，才会表现为 `payload_write_ms` 升高。

所以当前更合理的抽象是：

```text
1024B 等的是“多次可写机会”
4096B 等的是“一次可写机会里尽量提交更多数据”
```

但这只是部分缓解。它减少的是提交次数和单位 KB 等待成本，不会改变底层公网路径的持续承载能力。

## 为什么 4096B 仍然不够

虽然聚合改善明显，但 Cloudflare WSS `4096B` 仍然只有：

```text
sent/produced ~= 50.4%
sent ~= 110.9kbps
produced ~= 219.6kbps
tx_ringbuf_depth_ms_max ~= 1920ms
dropped_bytes = 436224B / 3 rounds
```

也就是：

```text
长期发送服务率仍然只有生产速率的一半左右
```

只要：

```text
sent_bytes/s < produced_bytes/s
```

任何有限 ringbuf 最终都会填满。增大 ringbuf 只能延后丢弃，不能恢复实时性。

聚合还带来一个不可忽略的实时性代价：

```text
4096B / 32000B/s ~= 128ms
```

如果发送端机械地等待凑满 `4096B`，会额外引入约 `128ms` 的聚合等待。实际测试生产速率略低时，等待还会更长。

因此不能简单采用：

```text
等 ringbuf 满 4096B 再发送
```

更不能等到 `vad_end` 才上传整段语音，否则流式 ASR 会退化成录完再传。

## 当前结论

本轮对三个假设的判断：

| 假设 | 结论 | 证据 |
|---|---|---|
| H1 小 frame 固定开销是主要瓶颈 | 部分成立 | `send P95/KB` 降低约 72%-74%，吞吐提高 |
| H2 Cloudflare 路径存在 per-message/per-write 背压 | 与证据一致，未完成分层归因 | 单次 P95 约 300ms，payload 增长后单位 KB 成本下降 |
| H3 frame 大小关系不大 | 否定 | 4096B 相比 1024B 有明确改善 |

最终判定：

```text
Frame aggregation = PARTIAL
```

即：

- 聚合是有效优化方向；
- 当前 `4096B` 固定 frame 不是完整解决方案；
- 不应继续通过无限增大 ringbuf 掩盖问题；
- 暂不直接把固定 `4096B` 写入生产策略；
- 应先定位 `esp_transport_write()` 的约 `300ms` 尾延迟花在哪里。

## 下一步

下一轮优先增加 transport 分层观测：

```text
ws_parent_poll_ms
ws_header_write_ms
ws_payload_write_ms
ssl_poll_ms
ssl_write_ms / tcp_send_ms
```

需要回答：

1. 慢在等待 parent transport 可写，还是实际写 payload？
2. WebSocket header 和 payload 两次 write 是否都发生明显等待？
3. WS 与 WSS 的主要差异是 TLS 加密、TLS write，还是共同的 TCP/socket 背压？
4. 单次约 `300ms` 是否具有固定周期特征？

只有确认这一层后，才适合继续比较：

- `TCP_NODELAY`；
- TLS record/write 行为；
- 更大的测试 frame；
- “最大 frame + 最大等待时间 + VAD end flush”的动态聚合策略；
- 或使用 Opus 降低源数据率。

动态聚合若进入生产设计，至少需要同时约束：

```text
max_frame_bytes
max_aggregation_wait_ms
vad_end_flush
backlog_health_threshold
```

而不是只设一个“等满 4096B”的静态规则。
