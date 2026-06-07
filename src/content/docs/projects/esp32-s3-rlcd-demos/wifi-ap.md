---
title: ESP32-S3-RLCD-4.2 Wi-Fi AP 零基础教程
description: 从 Waveshare ESP32-S3-RLCD-4.2 的 ESP-IDF Wi-Fi AP 示例出发，让开发板变成一个可连接的无线热点。
---

## 一句话目标

把 ESP32-S3-RLCD-4.2 开发板变成一个 Wi-Fi 热点，手机或电脑可以搜到 `waveshare_esp32` 并连接它。

## 先懂概念

AP 是 Access Point 的缩写，可以先理解成“热点”。平时家里的路由器就是一个 AP：手机连接路由器，路由器给手机分配 IP 地址。

这个示例里，ESP32-S3 不去连接别人，而是自己创建热点。它负责三件事：

1. 让 Wi-Fi 芯片进入 AP 模式。
2. 设置热点名称、密码、信道和最大连接数。
3. 有设备连上或断开时，通过事件回调打印信息。

这里还会出现两个 ESP-IDF 基础组件：

- `esp_netif`：负责网络接口，可以理解成“把 Wi-Fi 接到 TCP/IP 网络栈上”。
- `esp_event`：负责事件通知，比如“有设备连接了”“有设备拿到 IP 了”。

## 硬件/代码入口

硬件使用 Waveshare ESP32-S3-RLCD-4.2。它基于 ESP32-S3，支持 2.4 GHz Wi-Fi 和 BLE，并带有 4.2 英寸反射式屏幕、麦克风、扬声器、温湿度传感器等外设。本篇只用到 Wi-Fi 和 Type-C 串口下载/日志。

事实来源目录：

```text
D:\Tools\ESP-IDF\ESP32-S3-RLCD-4.2-Demo\ESP32-S3-RLCD-4.2-Demo\02_ESP-IDF\01_WIFI_AP
```

主要代码入口：

```text
main\softap_example_main.c
```

这个示例的核心配置直接写在 C 文件里：

```c
#define EXAMPLE_ESP_WIFI_SSID "waveshare_esp32"
#define EXAMPLE_ESP_WIFI_PASS "wav123456"
#define EXAMPLE_ESP_WIFI_CHANNEL 1
#define EXAMPLE_MAX_STA_CONN 4
```

## 运行现象

烧录并运行后，串口日志会提示 AP 初始化完成，里面能看到热点名称、密码和信道。

你可以用手机或电脑搜索 Wi-Fi，找到：

```text
waveshare_esp32
```

连接密码是：

```text
wav123456
```

当设备连上、拿到 IP 或断开时，串口会继续打印相关信息。示例里在设备拿到 IP 后会打印连接设备的 MAC 地址和 IP 地址；断开时会打印 `disconnect`。

## 核心流程

这份 AP 示例的业务主干很短：

```text
app_main
-> 初始化 NVS
-> wifi_init_softap
-> 创建 AP 网络接口
-> 注册 Wi-Fi/IP 事件
-> 设置热点参数
-> 启动 Wi-Fi AP
-> 等待设备连接事件
```

零基础先记住这条线就够了：先准备存储和网络栈，再配置热点，最后启动 Wi-Fi。

## 关键代码讲解

`app_main()` 是 ESP-IDF 程序的入口。它先调用 `nvs_flash_init()`，因为 Wi-Fi 驱动会用到 NVS 保存一些系统配置。示例也处理了 NVS 空间不足或版本变化的情况：如果初始化失败，就擦除后重新初始化。

真正启动热点的是 `wifi_init_softap()`。它的步骤很典型：

```c
esp_netif_init();
esp_event_loop_create_default();
esp_netif_create_default_wifi_ap();
```

这三句是在准备网络能力：初始化网络接口，创建默认事件循环，再创建默认 Wi-Fi AP 接口。

然后用默认配置初始化 Wi-Fi 驱动：

```c
wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
esp_wifi_init(&cfg);
```

接着注册事件处理函数 `wifi_event_handler()`。这个函数会处理三类现象：

- `WIFI_EVENT_AP_STACONNECTED`：有设备连接到热点。
- `WIFI_EVENT_AP_STADISCONNECTED`：有设备断开。
- `IP_EVENT_AP_STAIPASSIGNED`：连接设备拿到了 IP 地址。

热点参数放在 `wifi_config_t` 里。这个示例使用 `WIFI_AUTH_WPA2_PSK`，也就是常见的 WPA2 密码认证；`max_connection` 设置为 4，表示最多允许 4 个 station 设备连接。

最后三步是 AP 模式真正生效的地方：

```c
esp_wifi_set_mode(WIFI_MODE_AP);
esp_wifi_set_config(WIFI_IF_AP, &wifi_config);
esp_wifi_start();
```

可以按字面理解：设置模式、写入配置、启动 Wi-Fi。

## 动手改一改

最适合初学者的改动是改热点名称和密码。

在 `main\softap_example_main.c` 里找到：

```c
#define EXAMPLE_ESP_WIFI_SSID "waveshare_esp32"
#define EXAMPLE_ESP_WIFI_PASS "wav123456"
```

可以改成自己的名称和密码，例如：

```c
#define EXAMPLE_ESP_WIFI_SSID "my_esp32_ap"
#define EXAMPLE_ESP_WIFI_PASS "12345678"
```

注意：WPA/WPA2 密码通常至少需要 8 个字符。改完后重新编译、烧录，再用手机搜索新的热点名。

还可以改最大连接数：

```c
#define EXAMPLE_MAX_STA_CONN 4
```

初学阶段建议先保持 1 到 4，不要一上来调很大。连接数越多，占用资源越多。

## 常见坑

1. 手机搜不到热点：确认程序已经烧录并运行，串口里应该能看到 `wifi_init_softap finished`。
2. 密码连不上：确认密码至少 8 位，并且手机输入的是你重新烧录后的新密码。
3. 只连上但不能上网：这是正常现象。本示例只是让 ESP32-S3 创建局域网热点，没有把热点桥接到互联网。
4. 串口没有 IP 打印：先确认手机真的连上了热点，有些手机会因为“无互联网连接”自动切回原来的 Wi-Fi。
5. 改了 `Kconfig.projbuild` 但没生效：这个 AP 示例的 SSID 和密码实际直接写在 `softap_example_main.c` 的宏里，不是从 Kconfig 宏读取。

## 和 Pixel Soul 项目的关系

Pixel Soul 这类桌面 AIoT 项目通常需要“首次配网”能力。AP 模式很适合做第一步：设备刚开机还不知道家里 Wi-Fi 时，先自己开一个热点，手机连上后把家庭 Wi-Fi 名称和密码发给设备。

这篇 AP 示例可以作为 Pixel Soul 配网模式的最小原型：

```text
未配置网络
-> 开启 ESP32-S3 热点
-> 手机连接设备热点
-> 输入家庭 Wi-Fi 信息
-> 设备保存配置并切换到 STA 模式
```

也就是说，AP 模式不是最终联网方式，而是“让用户先找到设备”的入口。

## 补充阅读

- [ESP-IDF v5.5.3 ESP32-S3 Wi-Fi Driver Guide](https://docs.espressif.com/projects/esp-idf/en/v5.5.3/esp32s3/api-guides/wifi.html)
- [ESP-IDF v5.5.3 ESP32-S3 Wi-Fi API Reference](https://docs.espressif.com/projects/esp-idf/en/v5.5.3/esp32s3/api-reference/network/esp_wifi.html)
- [Waveshare ESP32-S3-RLCD-4.2 资料页](https://docs.waveshare.com/ESP32-S3-RLCD-4.2/)
