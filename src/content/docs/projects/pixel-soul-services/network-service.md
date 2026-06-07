---
title: Pixel Soul NetworkService 复习笔记
description: 复习 NetworkService 的 Wi-Fi 自动连接、AP 配网、Captive Portal、NVS 凭据和异步任务模型。
---

## 一句话定位

NetworkService 负责把 Wi-Fi STA、AP 配网、NVS 凭据存储、Captive Portal 和 DNS 引导封装成一个异步网络 Service，让 AppCore 通过命令和 snapshot 管理网络状态。

## 基础原理

NetworkService 的核心是“命令异步化 + 状态 snapshot”。上层调用 `network_service_start_async()`、`network_service_connect()`、`network_service_start_provisioning()` 等接口时，通常只是把命令投递到队列；真正的 Wi-Fi 连接、AP/Portal/DNS 启停由 `network_service` 后台任务串行处理。

它还同时接收 Wi-Fi event 和 IP event。命令任务负责执行意图，事件回调负责反映真实连接状态，例如 `IP_EVENT_STA_GOT_IP` 后才能认为已连接并拿到 IP。

## 主流程

启动流程：

```text
network_service_init()
  -> 创建 snapshot mutex
  -> 创建 command queue
  -> 初始化 NVS / storage / netif / event loop / Wi-Fi
  -> 注册 Wi-Fi event 和 IP event
  -> snapshot = INIT

network_service_start_async()
  -> 创建 network_service task
  -> 投递 NETWORK_CMD_START
  -> 立即返回
```

自动连接流程：

```text
NETWORK_CMD_START
  -> handle_start()
  -> 检查 NVS 是否有已保存 Wi-Fi 凭据
  -> 有凭据：加载 ssid/password 并尝试连接
  -> 无凭据：进入 CONFIG_REQUIRED / PROVISIONING
```

配网流程：

```text
start provisioning
  -> 启动 AP netif
  -> 配置 AP SSID/password/channel/max_conn
  -> 启动 captive DNS
  -> 启动 HTTP portal
  -> snapshot = PROVISIONING
  -> 用户提交 ssid/password
  -> network_service_connect()
  -> NETWORK_CMD_CONNECT
  -> STA 连接成功后保存凭据
```

状态读取流程：

```text
AppCore / UI
  -> network_service_get_snapshot()
  -> 读取 status / sta_ssid / sta_ip / ap_ssid / portal_url / reason
```

## 为什么这样设计

第一，Wi-Fi 连接是耗时操作，不能阻塞 AppCore 启动和 UI 刷新。public API 异步投递命令，能让上层马上返回，再通过 callback 或 snapshot 感知结果。

第二，Wi-Fi、AP、Portal、DNS 之间有顺序和互斥关系。统一放进 `network_service_task` 串行处理，可以减少“正在配网时又连接”“连接中又 reset credentials”这类竞态。

第三，配网是网络能力，不是页面能力。UI 只需要展示 AP SSID、portal URL、连接状态；AP、HTTP server、DNS 劫持和 NVS 凭据都留在 NetworkService 内部。

第四，凭据保存与连接成功绑定。新凭据只有在连接成功后才保存，避免把旧的可用凭据直接覆盖成错误配置。

## 当前项目实现

当前公开 API 包括：

```c
esp_err_t network_service_init(network_service_update_cb_t update_cb, void *ctx);
esp_err_t network_service_start_async(void);
void network_service_stop(void);
esp_err_t network_service_start_provisioning(void);
esp_err_t network_service_stop_provisioning(void);
esp_err_t network_service_reset_credentials(void);
esp_err_t network_service_connect(const char *ssid, const char *password);
const network_snapshot_t *network_service_get_snapshot(void);
bool network_service_is_connected(void);
```

`network_snapshot_t` 包含：

```text
status
wifi_connected / has_ip / provisioning_active
sta_ssid / sta_ip
ap_ssid / ap_ip / portal_url
reason
```

状态枚举包括 `INIT`、`CONNECTING`、`CONNECTED`、`DISCONNECTED`、`PROVISIONING`、`CONFIG_REQUIRED`、`ERROR`。`network_service_is_connected()` 的判断条件是 `wifi_connected == true && has_ip == true`，这比只看 Wi-Fi 关联更准确，因为云端 AI 和 SNTP 都需要 IP 层可用。

内部 helper 分工是：

- `network_storage.*` 封装 NVS Wi-Fi 凭据读取、保存、清除。
- `network_portal.*` 封装 HTTP 配网页面和提交接口。
- `network_dns.*` 提供 captive DNS，把用户访问引导到设备 AP IP。
- `network_types.c` 提供状态枚举转字符串。

## 关键边界/踩坑

- `network_service_start_async()` 返回 `ESP_OK` 只代表启动任务和投递命令成功，不代表已经联网。
- `network_service_connect()` 返回成功通常也只是命令投递成功；最终状态要看 snapshot 或 callback。
- `network_service_get_snapshot()` 当前返回内部静态 snapshot 指针，调用方应该只读，不要修改，也不要长期保存后假定不变。
- `CONNECTED` 应同时满足 Wi-Fi 已关联和已拿到 IP，只看 Wi-Fi event 不够。
- 配网 AP/Portal/DNS 是 NetworkService 私有能力，App/UI 不应绕过 Service 直接调用。
- 日志和 UI 不应打印 Wi-Fi password。
- 断线后的自动重连策略需要结合当前代码和产品要求继续确认，复习时不要把未确认策略说成已经完整实现。

## 面试问答

**问：NetworkService 为什么用队列和后台任务？**

答：Wi-Fi 连接、AP 切换、Portal 启停都可能耗时，而且它们之间有顺序约束。队列能让 public API 快速返回，后台任务串行执行命令，减少并发切换导致的状态混乱。

**问：首次启动没有 Wi-Fi 凭据时会发生什么？**

答：启动命令会发现 NVS 中没有凭据，状态进入 `CONFIG_REQUIRED`，随后启动 AP 配网、DNS 和 HTTP Portal。用户连接设备 AP 后提交 SSID/password，再由 NetworkService 尝试 STA 连接。

**问：为什么拿到 IP 才算 connected？**

答：只关联 Wi-Fi 还不能保证设备能访问局域网或互联网。AI WebSocket、SNTP 校时等能力都依赖 IP 层，所以 `network_service_is_connected()` 同时检查 `wifi_connected` 和 `has_ip`。

**问：配网页面提交密码后，什么时候保存凭据？**

答：应该在连接成功后保存。这样可以避免用户输错密码时覆盖已有可用配置，也让重启自动连接更可靠。

**问：网络连上后如何联动其他服务？**

答：AppCore 可以在 NetworkService 状态变为 `CONNECTED` 后通知 TimeService 调用 `time_service_on_network_connected()`，也可以允许 AIService activate。NetworkService 本身不直接做 SNTP 或云端 AI 连接。

## 复习检查表

- [ ] 能解释 public API 异步返回和最终联网结果的区别。
- [ ] 能画出 `START -> saved credentials -> CONNECTED/PROVISIONING` 流程。
- [ ] 能说清 AP 配网由 AP、DNS、HTTP Portal 三部分组成。
- [ ] 能解释 `network_snapshot_t` 每个关键字段的用途。
- [ ] 能说明为什么 `has_ip` 是 connected 的必要条件。
- [ ] 能说出 NetworkService 不负责 SNTP、AI cloud 和页面渲染。
- [ ] 能指出 snapshot 返回内部指针这个当前实现边界。
