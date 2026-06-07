---
title: ESP32-S3-RLCD Wi-Fi AP 示例拆解
description: 从 AP 模式、网络接口、事件回调和关键 ESP-IDF API 入手，读懂 01_WIFI_AP 如何让开发板创建热点。
---

## 一句话定位

`01_WIFI_AP` 演示的是 SoftAP：让 ESP32-S3 自己创建一个 Wi-Fi 热点，手机或电脑可以连接到这个热点。它只验证“开发板能作为 AP 被连接”，不提供互联网转发能力。

## 基础原理

Wi-Fi 中常见两个角色：

| 角色 | 含义 | 例子 |
| --- | --- | --- |
| AP | Access Point，提供热点的一方。 | 家用路由器、手机热点、ESP32 SoftAP。 |
| STA | Station，连接热点的一方。 | 手机、电脑、连接路由器的 ESP32。 |

本示例让 ESP32-S3 进入 `WIFI_MODE_AP`。AP 模式至少需要配置 SSID、密码、信道、认证方式和最大连接数。设备连接或断开时，ESP-IDF 会通过事件系统回调应用代码。

还要理解两个 ESP-IDF 基础组件：

- `esp_netif`：把 Wi-Fi 接口接入 TCP/IP 网络栈。
- `esp_event`：分发 Wi-Fi 和 IP 事件，例如 station 连接、断开、拿到 IP。

## 硬件与工程入口

本 demo 只依赖 ESP32-S3 的 2.4 GHz Wi-Fi 和串口日志，不依赖屏幕、音频、SD 卡等外设。

源码阅读入口：

```text
02_ESP-IDF/01_WIFI_AP/main/softap_example_main.c
02_ESP-IDF/01_WIFI_AP/main/Kconfig.projbuild
```

核心配置在 C 文件宏中：

```c
#define EXAMPLE_ESP_WIFI_SSID "waveshare_esp32"
#define EXAMPLE_ESP_WIFI_PASS "wav123456"
#define EXAMPLE_ESP_WIFI_CHANNEL 1
#define EXAMPLE_MAX_STA_CONN 4
```

`Kconfig.projbuild` 也提供了 menuconfig 项，但当前示例主文件使用的是硬编码宏。阅读时以 `softap_example_main.c` 为准。

## 关键流程总图

```text
app_main()
  -> nvs_flash_init()
  -> wifi_init_softap()
      -> esp_netif_init()
      -> esp_event_loop_create_default()
      -> esp_netif_create_default_wifi_ap()
      -> esp_wifi_init()
      -> esp_event_handler_instance_register(WIFI_EVENT, ...)
      -> esp_event_handler_instance_register(IP_EVENT, ...)
      -> esp_wifi_set_mode(WIFI_MODE_AP)
      -> esp_wifi_set_config(WIFI_IF_AP, &wifi_config)
      -> esp_wifi_start()
  -> 等待 Wi-Fi/IP 事件回调
```

事件流：

```text
WIFI_EVENT_AP_STACONNECTED
  -> 保存 station MAC

IP_EVENT_AP_STAIPASSIGNED
  -> 打印 station MAC 和 IP

WIFI_EVENT_AP_STADISCONNECTED
  -> 打印 disconnect
```

## 关键方法速查

| 函数/方法 | 所在文件 | 作用 | 初学者需要理解的点 |
| --- | --- | --- | --- |
| `app_main()` | `main/softap_example_main.c` | ESP-IDF 应用入口。 | Wi-Fi 启动前先初始化 NVS。 |
| `nvs_flash_init()` | ESP-IDF NVS API | 初始化非易失存储。 | Wi-Fi 驱动会使用 NVS 保存系统参数。 |
| `wifi_init_softap()` | `main/softap_example_main.c` | 初始化并启动 SoftAP。 | AP 主流程集中在这个函数里。 |
| `esp_netif_create_default_wifi_ap()` | ESP-IDF netif API | 创建默认 AP 网络接口。 | Wi-Fi 硬件要接入 TCP/IP 栈才能分配 IP。 |
| `esp_event_handler_instance_register()` | ESP-IDF event API | 注册 Wi-Fi/IP 事件回调。 | Wi-Fi 是异步系统，连接状态靠事件通知。 |
| `esp_wifi_set_mode(WIFI_MODE_AP)` | ESP-IDF Wi-Fi API | 设置 AP 模式。 | 模式必须先明确，后续配置才知道作用在哪个接口。 |
| `esp_wifi_set_config(WIFI_IF_AP, ...)` | ESP-IDF Wi-Fi API | 写入 AP 参数。 | SSID、密码、信道、最大连接数都在这里生效。 |
| `esp_wifi_start()` | ESP-IDF Wi-Fi API | 启动 Wi-Fi 驱动。 | 这一步后热点才真正开始广播。 |
| `wifi_event_handler()` | `main/softap_example_main.c` | 处理连接、断开、IP 分配事件。 | 事件回调里只做轻量处理和日志输出。 |

## 关键代码讲解

`app_main()` 的第一步是初始化 NVS：

```c
esp_err_t ret = nvs_flash_init();
```

如果 NVS 空间不足或版本变化，示例会擦除 NVS 后重新初始化。这个处理来自 ESP-IDF 官方 Wi-Fi 示例的常见写法，适合 demo，产品中通常要更谨慎，因为擦除 NVS 可能丢配置。

`wifi_init_softap()` 先准备网络栈：

```c
esp_netif_init();
esp_event_loop_create_default();
esp_netif_create_default_wifi_ap();
```

这三句可以理解为“初始化 TCP/IP 网络能力、建立事件中心、创建 AP 网卡”。

然后初始化 Wi-Fi 驱动：

```c
wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
esp_wifi_init(&cfg);
```

`WIFI_INIT_CONFIG_DEFAULT()` 给出一套默认驱动配置，初学阶段不要急着改它。真正需要改的是 `wifi_config_t`：

```c
wifi_config_t wifi_config = {
    .ap = {
        .ssid = EXAMPLE_ESP_WIFI_SSID,
        .password = EXAMPLE_ESP_WIFI_PASS,
        .channel = EXAMPLE_ESP_WIFI_CHANNEL,
        .max_connection = EXAMPLE_MAX_STA_CONN,
        .authmode = WIFI_AUTH_WPA2_PSK,
    },
};
```

最后三句让配置生效：

```c
esp_wifi_set_mode(WIFI_MODE_AP);
esp_wifi_set_config(WIFI_IF_AP, &wifi_config);
esp_wifi_start();
```

顺序很重要：先选 AP 模式，再写 AP 配置，最后启动 Wi-Fi。

## 实验现象

烧录运行后，串口会打印 AP 初始化完成。手机或电脑搜索 Wi-Fi，可以看到：

```text
waveshare_esp32
```

连接密码：

```text
wav123456
```

设备连接、拿到 IP、断开时，串口会出现相应日志。连接上但无法访问互联网是正常现象，因为这个 demo 没有实现 NAT 或路由转发。

## 常见问题

| 现象 | 可能原因 | 排查方式 |
| --- | --- | --- |
| 搜不到热点 | 程序未运行、Wi-Fi 未启动、开发板复位中。 | 查看串口是否有 `wifi_init_softap finished`。 |
| 密码连不上 | 密码输错或密码长度不符合 WPA/WPA2 要求。 | 保持至少 8 个字符。 |
| 连接后无互联网 | demo 只创建局域网热点。 | 这是预期现象，不是故障。 |
| 拿不到 IP 日志 | 手机可能自动切回有网 Wi-Fi。 | 关闭手机“无互联网自动切换”或重新连接热点。 |
| 修改 Kconfig 不生效 | 主文件使用硬编码宏。 | 修改 `softap_example_main.c` 中的 `EXAMPLE_*` 宏。 |

## 工程迁移思路

SoftAP 常用于“首次配网”：设备还不知道家庭路由器信息时，先创建一个临时热点，让手机连接后提交 SSID 和密码。产品中通常会形成这样的流程：

```text
无网络配置
  -> 开启 SoftAP
  -> 手机连接设备热点
  -> Web/HTTP/蓝牙写入家庭 Wi-Fi
  -> 保存到 NVS
  -> 停止 AP
  -> 切换 STA 连接路由器
```

因此 AP 模式更像入口，不是长期运行的联网方式。迁移时建议把 `wifi_init_softap()` 封装成网络服务的一种模式，而不是让页面或业务代码直接调用 `esp_wifi_*`。

## 补充阅读

- [ESP-IDF Wi-Fi 编程指南](https://docs.espressif.com/projects/esp-idf/zh_CN/v5.5.3/esp32s3/api-guides/wifi.html)
- [ESP-IDF Wi-Fi API 参考](https://docs.espressif.com/projects/esp-idf/zh_CN/v5.5.3/esp32s3/api-reference/network/esp_wifi.html)
- [Waveshare ESP32-S3-RLCD-4.2 资料页](https://docs.waveshare.com/ESP32-S3-RLCD-4.2)
