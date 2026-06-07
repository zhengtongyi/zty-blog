---
title: ESP32-S3-RLCD Wi-Fi STA 示例拆解
description: 从 STA 模式、连接事件、IP 获取和关键 ESP-IDF API 入手，读懂 02_WIFI_STA 如何连接路由器。
---

## 一句话定位

`02_WIFI_STA` 演示的是 Station 模式：开发板作为 Wi-Fi 客户端连接外部路由器，拿到 IP 后就具备访问局域网或互联网的基础条件。

## 基础原理

STA 是 Station 的缩写。手机、电脑、开发板连接家用路由器时，都是 STA。STA 流程和 AP 流程最大的区别是：

| 模式 | 谁创建网络 | 谁连接网络 |
| --- | --- | --- |
| AP | ESP32-S3 创建热点。 | 手机/电脑连接 ESP32-S3。 |
| STA | 路由器创建热点。 | ESP32-S3 连接路由器。 |

STA 连接不是一个同步函数马上完成，而是一串异步事件：

```text
Wi-Fi driver started
  -> connect to AP
  -> authentication/association
  -> DHCP gets IP
  -> application receives IP_EVENT_STA_GOT_IP
```

因此判断“联网成功”不能只看 `esp_wifi_start()` 是否返回成功，还要看是否收到 `IP_EVENT_STA_GOT_IP`。

## 硬件与工程入口

本 demo 使用 ESP32-S3 的 2.4 GHz Wi-Fi。ESP32-S3 不支持连接普通 5 GHz Wi-Fi，请选择路由器的 2.4 GHz SSID。

源码阅读入口：

```text
02_ESP-IDF/02_WIFI_STA/main/main.c
02_ESP-IDF/02_WIFI_STA/components/user_app/user_app.c
02_ESP-IDF/02_WIFI_STA/components/esp_wifi_bsp/esp_wifi_bsp.c
```

当前源码中目标路由器信息硬编码在 `esp_wifi_bsp.c`：

```c
.ssid = "K2P",
.password = "1234567890",
```

公开阅读时把它理解为示例占位值，实际实验需要改成可用的 2.4 GHz Wi-Fi。

## 关键流程总图

```text
app_main()
  -> user_top_init()
      -> espwifi_Init()
          -> nvs_flash_init()
          -> esp_netif_init()
          -> esp_event_loop_create_default()
          -> esp_netif_create_default_wifi_sta()
          -> esp_wifi_init()
          -> esp_event_handler_instance_register(WIFI_EVENT, ...)
          -> esp_event_handler_instance_register(IP_EVENT, ...)
          -> esp_wifi_set_mode(WIFI_MODE_STA)
          -> esp_wifi_set_config(WIFI_IF_STA, &wifi_config)
          -> esp_wifi_start()
```

事件流：

```text
WIFI_EVENT_STA_START
  -> esp_wifi_connect()

IP_EVENT_STA_GOT_IP
  -> 打印 IP 地址

WIFI_EVENT_STA_DISCONNECTED
  -> 打印 disconnected
```

## 关键方法速查

| 函数/方法 | 所在文件 | 作用 | 初学者需要理解的点 |
| --- | --- | --- | --- |
| `app_main()` | `main/main.c` | ESP-IDF 应用入口。 | 入口很薄，只把控制权交给用户应用层。 |
| `user_top_init()` | `components/user_app/user_app.c` | 打印启动日志并调用 Wi-Fi BSP。 | demo 把业务入口和 Wi-Fi 封装拆开。 |
| `espwifi_Init()` | `components/esp_wifi_bsp/esp_wifi_bsp.c` | 初始化 STA 网络并启动 Wi-Fi。 | STA 主流程集中在这里。 |
| `esp_netif_create_default_wifi_sta()` | ESP-IDF netif API | 创建默认 STA 网络接口。 | 连接路由器后需要这个接口承载 IP。 |
| `esp_wifi_set_mode(WIFI_MODE_STA)` | ESP-IDF Wi-Fi API | 设置 STA 模式。 | STA 模式表示“连接别人”。 |
| `esp_wifi_set_config(WIFI_IF_STA, ...)` | ESP-IDF Wi-Fi API | 写入目标 SSID 和密码。 | 这里决定开发板要连哪个 AP。 |
| `esp_wifi_start()` | ESP-IDF Wi-Fi API | 启动 Wi-Fi 驱动。 | 启动后会触发 `WIFI_EVENT_STA_START`。 |
| `esp_wifi_connect()` | ESP-IDF Wi-Fi API | 开始连接目标 AP。 | 示例在 `WIFI_EVENT_STA_START` 事件里调用它。 |
| `event_handler()` | `components/esp_wifi_bsp/esp_wifi_bsp.c` | 处理启动、拿 IP、断开事件。 | 真正联网成功以 `IP_EVENT_STA_GOT_IP` 为准。 |

## 关键代码讲解

`app_main()` 只调用：

```c
user_top_init();
```

这是一种常见 demo 分层：`main/` 保持很薄，具体功能放到 `components/user_app/` 和 BSP 组件里。

`espwifi_Init()` 先初始化基础设施：

```c
nvs_flash_init();
esp_netif_init();
esp_event_loop_create_default();
esp_netif_create_default_wifi_sta();
```

然后初始化 Wi-Fi 驱动并注册事件：

```c
wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
esp_wifi_init(&cfg);
esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &event_handler, NULL, &Instance_WIFI_IP);
esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &event_handler, NULL, &Instance_WIFI_IP);
```

STA 配置写入 `wifi_config_t`：

```c
wifi_config_t wifi_config = {
    .sta = {
        .ssid = "K2P",
        .password = "1234567890",
    },
};
```

最后设置 STA 模式并启动：

```c
esp_wifi_set_mode(WIFI_MODE_STA);
esp_wifi_set_config(WIFI_IF_STA, &wifi_config);
esp_wifi_start();
```

启动后，`event_handler()` 收到 `WIFI_EVENT_STA_START`，才调用：

```c
esp_wifi_connect();
```

这点很关键：`esp_wifi_start()` 只是启动 Wi-Fi 子系统，`esp_wifi_connect()` 才是开始连接目标 AP。

## 实验现象

烧录运行后，串口先打印：

```text
wifi-example run
```

如果 SSID 和密码正确，并且路由器是 2.4 GHz 网络，成功后串口会打印类似：

```text
IP: 192.168.1.123
```

如果断开，会打印：

```text
disconnected
```

当前示例只打印断开事件，没有自动重连逻辑。

## 常见问题

| 现象 | 可能原因 | 排查方式 |
| --- | --- | --- |
| 一直没有 IP | SSID/密码错误、路由器不可达、填了 5 GHz 网络。 | 先确认 2.4 GHz SSID 和密码。 |
| 打印 `disconnected` | AP 拒绝、信号弱、密码错。 | 靠近路由器，重新确认密码。 |
| `esp_wifi_start()` 成功但没联网 | Wi-Fi 驱动启动不等于 DHCP 成功。 | 以 `IP_EVENT_STA_GOT_IP` 为成功标志。 |
| 断开后不自动恢复 | 示例没有重连分支。 | 产品代码通常在断开事件中延迟调用 `esp_wifi_connect()`。 |
| 修改后仍连旧 Wi-Fi | 固件未重新烧录或改错文件。 | 确认修改的是 `esp_wifi_bsp.c` 中的 `wifi_config_t`。 |

## 工程迁移思路

真实工程中，STA 模式通常是联网服务的核心。AP 模式负责首次配网，STA 模式负责长期连接云端、获取时间、下载资源或上报数据。

更完整的网络服务会额外处理：

```text
读取 NVS 中保存的 Wi-Fi 配置
  -> 启动 STA
  -> 等待 got_ip
  -> 向上层发布 network_ready
  -> 断线后退避重连
  -> 多次失败后进入配网或错误状态
```

因此迁移时不要让业务页面直接依赖 `event_handler()`，更推荐把 Wi-Fi 事件转成稳定的网络状态，例如 `DISCONNECTED / CONNECTING / GOT_IP / ERROR`。

## 补充阅读

- [ESP-IDF Wi-Fi 编程指南](https://docs.espressif.com/projects/esp-idf/zh_CN/v5.5.3/esp32s3/api-guides/wifi.html)
- [ESP-IDF Wi-Fi API 参考](https://docs.espressif.com/projects/esp-idf/zh_CN/v5.5.3/esp32s3/api-reference/network/esp_wifi.html)
- [Waveshare ESP32-S3-RLCD-4.2 资料页](https://docs.waveshare.com/ESP32-S3-RLCD-4.2)
