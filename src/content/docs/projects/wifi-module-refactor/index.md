---
title: Wi-Fi 模块重构与优化
description: 围绕 ESP32 Wi-Fi 连接、断线重连、省电策略和语音/音频业务联动，整理后续 NetworkService 重构的设计依据。
---

这个专栏用于沉淀 Wi-Fi 模块重构前的业务理解。

重点不是罗列 ESP-IDF API，而是回答几个工程问题：

```text
什么时候才算真正联网成功？
Wi-Fi connected 和 got IP 有什么区别？
断线后应该由谁重连？
语音交互、音频流、桌面时钟应该采用同一种 Wi-Fi 策略吗？
NetworkService 应该暴露哪些状态给 App 和 Session？
```

## 当前文章

| 文章 | 重点 |
|---|---|
| [01 ESP32 Wi-Fi 建连与事件模型](./01-esp32-wifi-connection-event-model/) | 从扫描、认证、关联、WPA2、DHCP 到 ESP32 事件，建立正确的联网状态模型。 |
| [02 ESP32 Wi-Fi 断线重连与业务策略](./02-esp32-wifi-reconnect-power-strategy/) | 从 reason code、重连收口、省电模式和语音业务场景，推导 NetworkService 的重构边界。 |

## 一句话定位

`NetworkService` 应该是设备侧网络能力的 owner：

```text
它负责 Wi-Fi 驱动初始化、STA/AP 状态、IP 获取、断线重连、网络可用性 snapshot 和业务可观测事件。
```

它不应该负责：

```text
不直接创建 AI Session。
不直接操作 WebSocket 业务协议。
不理解 ASR/TTS/Agent。
不把 Wi-Fi connected 误判成业务 online。
```

## 重构目标

后续如果重构设备侧 Wi-Fi / NetworkService，可以按这个边界收口：

```text
Driver / ESP-IDF Wi-Fi events
  -> NetworkService
      -> network snapshot
      -> connection events
      -> reconnect policy
      -> power mode policy hook
  -> App / Session / Gateway probe
```

核心原则：

1. **状态分层**：`STA_CONNECTED`、`GOT_IP`、`GATEWAY_REACHABLE`、`SESSION_ACTIVE` 必须分开。
2. **事件转 snapshot**：底层事件可以很多，但上层读取稳定 snapshot。
3. **重连策略可解释**：不同 reason code 不一定同样处理。
4. **业务不直接操作 Wi-Fi driver**：App/Session 只消费 NetworkService 的状态和事件。
5. **省电策略服从业务场景**：语音/音频场景优先低延迟，桌面时钟可以优先低功耗。

