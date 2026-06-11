---
title: 05 四象限对照基线：Cloudflare 退化边界与下一步决策
description: 基于 LAN WS、LAN WSS、Cloudflare WS、Cloudflare WSS 四象限实机矩阵，分析音频上行链路瓶颈边界，并给出后续单变量优化顺序。
---

## 一句话结论

本轮四象限测试把第 4 章的“Cloudflare WSS 退化”进一步收敛为：

> 当前瓶颈不在 SR 生产侧，也不能简单归因为设备侧 TLS；退化主要出现在设备经 Cloudflare 公网/代理链路持续发送 PCM 的路径上。

关键证据是：

- `LAN WS`：3/3 通过，`ws_send_call_ms P95 = 3ms`，无丢弃。
- `LAN WSS`：2/3 通过，1 轮轻微超阈值但无丢弃，`ws_send_call_ms P95 = 6ms`。
- `Cloudflare WS`：3/3 性能失败，`sent/produced` 中位数约 `36.7%`。
- `Cloudflare WSS`：3/3 性能失败，`sent/produced` 中位数约 `26.8%`。

因此，下一步不应该直接把公网 URI 永久改成 `ws://`，也不应该直接断言“TLS 是根因”。更合理的路线是继续拆分：

```text
Cloudflare Edge / Tunnel
公网路径
设备端 WebSocket/TCP 写入行为
TLS record 与 write 阻塞
binary frame 聚合粒度
```

## 测试条件

本轮矩阵固定了设备、server、PCM、ringbuf、frame 和运行时长：

| 条件 | 说明 |
|---|---|
| 设备 | 同一台 ESP32-S3，COM6 |
| Wi-Fi | 同一 AP |
| 音频 | `PCM S16LE / 16kHz / 16bit / mono` |
| 理论生产速率 | 约 `32KB/s` |
| binary frame | 固定 `1024B` |
| TX ringbuf | `64KiB` |
| 每轮时长 | `15s` |
| 重复次数 | 每组 3 轮 |
| server | 同一 metrics-only WebSocket server |
| 非测试模块 | 不启用 UI、ASR、Agent、TTS、播放 |

四组 URI：

| 条件 | URI | 目的 |
|---|---|---|
| LAN WS | `ws://192.168.1.6:8769` | 基础健康基准 |
| LAN WSS | `wss://192.168.1.6:8770` | 单独观察设备侧 TLS 成本 |
| Cloudflare WS | `ws://pixel-soul.gpt0417.space` | 排除 TLS 变量，观察 Cloudflare 公网链路 |
| Cloudflare WSS | `wss://pixel-soul.gpt0417.space` | 当前生产形态近似路径 |

证据归档目录：

```text
cloud_new/tests/record/audio_link_matrix_20260611_091609/
```

其中包含：

```text
run_config.json
device_*.log
server_events.jsonl
matrix_results.csv
verdict.json
summary.md
```

## 总体结果

| 条件 | 通过轮次 | sent/produced 中位数 | server/sent | send P95 中位数 | 最大积压中位数 | 总丢弃 | 判定 |
|---|---:|---:|---:|---:|---:|---:|---|
| LAN WS | 3/3 | 100.5% | 100.0% | 3ms | 32ms | 0B | PASS |
| LAN WSS | 2/3 | 100.5% | 100.0% | 6ms | 64ms | 0B | DEGRADED* |
| Cloudflare WS | 0/3 | 36.7% | 100.0% | 301ms | 2016ms | 600064B | DEGRADED |
| Cloudflare WSS | 0/3 | 26.8% | 100.0% | 303ms | 2016ms | 721920B | DEGRADED |

`LAN WSS` 的 `DEGRADED*` 不是功能失败，也不是持续退化：其中 1 轮出现 `tx_ringbuf_depth_ms_max = 320ms`，略高于健康阈值 `300ms`，但没有丢弃，`sent/produced` 和 server 接收都正常。这个现象更适合记录为 TLS 路径存在偶发尖峰，而不是“LAN WSS 不可用”。

## 单轮数据

| 条件 | 轮次 | sent/produced | send avg | send P95 | send max | max depth | dropped | app RTT 范围 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| LAN WS | 1 | 100.5% | 2ms | 3ms | 68ms | 32ms | 0B | 36-98ms |
| LAN WS | 2 | 100.3% | 2ms | 3ms | 11ms | 32ms | 0B | 34-105ms |
| LAN WS | 3 | 100.5% | 2ms | 3ms | 121ms | 64ms | 0B | 34-124ms |
| LAN WSS | 1 | 100.5% | 5ms | 7ms | 390ms | 320ms | 0B | 55-528ms |
| LAN WSS | 2 | 100.5% | 4ms | 6ms | 9ms | 64ms | 0B | 35-154ms |
| LAN WSS | 3 | 100.5% | 4ms | 6ms | 27ms | 64ms | 0B | 39-184ms |
| Cloudflare WS | 1 | 36.7% | 91ms | 300ms | 331ms | 2016ms | 202752B | 586-1413ms |
| Cloudflare WS | 2 | 35.8% | 97ms | 303ms | 307ms | 2016ms | 205824B | 679-1391ms |
| Cloudflare WS | 3 | 38.2% | 90ms | 301ms | 308ms | 2016ms | 191488B | 755-1581ms |
| Cloudflare WSS | 1 | 26.8% | 100ms | 303ms | 320ms | 2016ms | 236544B | 1263-1703ms |
| Cloudflare WSS | 2 | 27.1% | 119ms | 303ms | 333ms | 2016ms | 240640B | 1272-1835ms |
| Cloudflare WSS | 3 | 25.5% | 129ms | 299ms | 811ms | 2016ms | 244736B | 1197-1891ms |

注意：`sent/produced` 大于 100% 是统计截点造成的轻微偏差，主要来自 producer/consumer 快照和 in-flight chunk 的时间差。它不影响“LAN 无丢弃、Cloudflare 严重积压”的判断。

## 结论 1：SR 生产侧不是当前瓶颈

四组测试中，设备侧 `produced_bytes` 都稳定在约 `410KB / 15s`：

```text
LAN WS:          407552 - 411648 B
LAN WSS:         413696 B
Cloudflare WS:   410624 - 417792 B
Cloudflare WSS:  409600 - 415744 B
```

这说明本轮问题不是：

- 麦克风/I2S 没有稳定采集；
- ESP-SR AFE 输出异常；
- `SRService` 生产速率不足；
- 测试 runner 没有真正产出 PCM。

真正的差异出现在 `SRService -> TX ringbuf -> WebSocketTask -> network` 之后。

## 结论 2：LAN WS/WSS 证明本地链路基本健康

`LAN WS` 的表现非常稳定：

```text
send P95: 3ms
max depth median: 32ms
dropped_bytes: 0
server_received/sent: 100%
```

`LAN WSS` 虽然有一轮出现 `send max = 390ms`、`max depth = 320ms`，但整体仍然满足实时音频上行：

```text
send P95 median: 6ms
dropped_bytes: 0
server_received/sent: 100%
```

这说明在局域网内：

- `WebSocketTask` 消费 ringbuf 的速度足够；
- `esp_transport_write()` 不会长期阻塞；
- 自定义 CA 的 LAN WSS 路径可用；
- ESP32-S3 上启用 TLS 并不必然导致 32KB/s PCM 上行失败。

因此，“所有 WSS 都慢”这个假设被本轮数据否定。

## 结论 3：Cloudflare WS 也慢，TLS 不是唯一根因

如果问题主要来自设备侧 TLS，那么预期结果应接近：

```text
Cloudflare WS 正常
Cloudflare WSS 慢
```

但实际结果是：

```text
Cloudflare WS:  sent/produced ≈ 36.7%, send P95 ≈ 301ms
Cloudflare WSS: sent/produced ≈ 26.8%, send P95 ≈ 303ms
```

这说明即使去掉设备到 Cloudflare Edge 的 TLS，公网 Cloudflare 路径仍然无法跟上 32KB/s 的持续 PCM 生产速率。

WSS 比 WS 更差，说明 TLS 可能仍有额外成本；但“Cloudflare WS 也失败”已经足够说明：

> 不能把根因直接写成 TLS。

更稳妥的描述是：

```text
Cloudflare 公网/代理路径下，设备侧 send 调用受到持续背压；
TLS 可能放大退化，但不是本轮唯一变量。
```

## 结论 4：server 没有“少收”，瓶颈在发送前后

四组的 `server_received/sent` 都约等于 `100%`。

这意味着一旦 `WebSocketTask` 认为一段 binary PCM 已经成功写出，metrics server 基本都能收到。当前看到的主要问题不是 server 随机丢包，也不是 WebSocket/TCP 把已经写成功的数据丢掉。

真正的问题是：

```text
esp_transport_write() 调用太慢
-> WebSocketTask 消费 ringbuf 速度低于 SR 生产速度
-> TX ringbuf 持续积压
-> ringbuf 饱和后 SR 新产生的 PCM 被丢弃
```

`Cloudflare WS/WSS` 的 `tx_ringbuf_depth_ms_max` 都到达 `2016ms`，已经远超健康阈值 `300ms`，也超过性能失败阈值 `800ms`。

## 结论 5：应用层 RTT 是拥塞指标，不是网络 RTT

`audio_report_rtt_ms` 的变化很有价值，但不能被解释为底层 TCP RTT。

本轮范围如下：

```text
LAN WS:          34-124ms
LAN WSS:         35-528ms
Cloudflare WS:   586-1581ms
Cloudflare WSS:  1197-1891ms
```

它的定义是：

```text
audio_sr 发出
-> server 收到并回 audio_rr
-> 设备收到 audio_rr
```

因为 `audio_sr` 和 binary PCM 共用同一个 WebSocket 发送路径，所以当 binary write 被持续阻塞时，`audio_sr` 也会被延迟。它反映的是应用层报告链路的整体及时性，包含：

- 本地发送队列等待；
- WebSocket/TLS/TCP 写入阻塞；
- Cloudflare/公网路径；
- server 收到报告后回包；
- 下行 JSON 到达设备。

所以它不能回答“公网 RTT 是多少”，但可以回答：

> 在当前拥塞状态下，设备侧观测报告多久才能被云端看到并返回。

这对实时音频仍然有意义，因为如果报告 RTT 已经升到 1-2 秒，说明控制面也受到了音频上行拥塞影响。

## 本轮能排除什么

可以相对明确排除：

1. **SR 生产异常**：四组 produced 近似一致。
2. **LAN WebSocket 架构不可用**：LAN WS 3/3 PASS。
3. **设备侧 TLS 必然不可用**：LAN WSS 基本健康。
4. **server 接收端随机少收**：server/sent 约 100%。
5. **单纯 TCP 可靠性就足够保证实时性**：Cloudflare 组没有丢“已发送成功”的数据，但实时音频仍然大量丢弃在发送前的 ringbuf。

## 本轮还不能证明什么

还不能证明：

1. Cloudflare Tunnel 是唯一根因。
2. Cloudflare Edge 是唯一根因。
3. 直接公网 WSS origin 一定正常。
4. `TCP_NODELAY` 一定能解决问题。
5. 4KB/8KB frame 聚合一定能解决问题。
6. ESP-IDF WebSocket transport 的 header/payload write 拆分就是根因。
7. 当前链路存在 TCP 重传、拥塞窗口收缩或 delayed ACK。

本轮指标只能把问题收敛到：

```text
设备经 Cloudflare 公网/代理路径持续发送 binary PCM 时，发送调用受到持续背压。
```

## 对第 4 章结论的修正

第 4 章只有 `LAN WS` 与 `Cloudflare WSS` 对照，因此当时只能说：

```text
瓶颈在设备侧 WebSocket/TLS 公网发送路径。
```

第 5 章四象限矩阵补充后，应修正为：

```text
瓶颈在设备经 Cloudflare 公网/代理路径发送 PCM 的链路上；
设备侧 TLS 不是唯一解释，Cloudflare WS 同样表现出明显背压。
```

这个修正很重要。它避免了过早做错误优化，例如只盯着 mbedTLS 参数、证书校验或 TLS record，而忽略 Cloudflare Tunnel、公网路径和代理转发行为。

## 当前工程决策

### 1. 不把生产公网 URI 改成 `ws://`

虽然 `Cloudflare WS` 比 `Cloudflare WSS` 略好，但它仍然严重不合格：

```text
sent/produced ≈ 36.7%
dropped_bytes = 600064B / 3 rounds
```

因此改成 `ws://` 既不能解决性能问题，又会丢失传输加密，不应作为生产方案。

### 2. 保留 LAN WSS 作为健康基准

LAN WSS 可以用于后续回归：

```text
如果 LAN WSS 也开始丢弃，优先查设备 TLS/固件改动。
如果 LAN WSS 正常而 Cloudflare 异常，优先查公网/代理/聚合策略。
```

### 3. 下一轮先测“直接公网 origin”

为了拆分 Cloudflare Tunnel，需要增加一组：

```text
Direct Public WSS -> metrics-only server
```

如果直接公网 WSS 正常，而 Cloudflare WSS 慢，重点转向 Cloudflare Edge/Tunnel。

如果直接公网 WSS 也慢，重点转向公网 RTT、TCP 小包、设备端 transport write 行为和聚合策略。

### 4. frame 聚合要作为单变量测试

本轮已经固定 `1024B` frame，因此下一轮可以比较：

```text
1024B
4096B
8192B
```

但必须保持：

- 同一 server；
- 同一 Wi-Fi；
- 同一运行时长；
- 同一 Cloudflare/Direct 路径；
- 同一统计口径。

否则无法判断改善来自 frame 聚合，还是来自网络状态变化。

### 5. 暂不引入自动控制

`AudioLinkObserver` 目前只做观测，不参与发包控制，这是正确的。原因是当前还没有足够证据决定：

- 是增大 frame；
- 是启用 `TCP_NODELAY`；
- 是改变 TLS write；
- 是绕过 Cloudflare Tunnel；
- 是增加本地压缩/Opus；
- 还是按拥塞状态主动停止上行。

过早做控制闭环，容易把问题“藏起来”，而不是定位清楚。

## 下一章建议

下一章应该进入真正的单变量优化，但顺序要克制：

1. **Direct Public WSS 对照**：先拆 Cloudflare Tunnel。
2. **1KB/4KB/8KB frame 聚合**：看小帧/系统调用/代理转发是否是主要因素。
3. **transport write 分段观测**：拆 WebSocket header、payload、TLS write 的耗时。
4. **TCP_NODELAY 对照**：在 frame 固定后再测，避免变量混杂。
5. **弱网/高 RTT 模拟**：验证 ringbuf 阈值、报告 RTT 和丢弃策略是否能提前预警。

本轮最重要的收获不是“Cloudflare 慢”，而是形成了一套可复现的诊断方法：

```text
固定生产速率
固定 frame
固定 server
固定运行时间
多路径对照
用 produced/sent/received/drop/depth/send-call/rr-rtt 同时判定
```

这比单纯说“WebSocket 发音频不稳定”更接近真实工程问题，也更有利于后续优化和面试表达。
