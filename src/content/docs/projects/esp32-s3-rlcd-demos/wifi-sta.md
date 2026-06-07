---
title: ESP32-S3-RLCD-4.2 Wi-Fi STA 零基础教程
description: 从 Waveshare ESP32-S3-RLCD-4.2 的 ESP-IDF Wi-Fi STA 示例出发，让开发板连接到已有路由器并打印 IP 地址。
---

## 一句话目标

让 ESP32-S3-RLCD-4.2 像手机一样连接已有 Wi-Fi，连接成功后在串口打印开发板拿到的 IP 地址。

## 先懂概念

STA 是 Station 的缩写，可以先理解成“客户端设备”。你的手机、电脑、平板连接家里路由器时，它们就是 STA。

STA 模式和 AP 模式刚好相反：

- AP 模式：ESP32-S3 自己创建热点，别人来连它。
- STA 模式：ESP32-S3 去连接已有热点，比如家里的路由器。

这个示例要完成的事情很清楚：

```text
启动程序
-> 初始化用户应用
-> 初始化 Wi-Fi STA
-> 连接指定路由器
-> 拿到 IP 后打印出来
```

如果连上了路由器，说明开发板已经进入局域网。后续做天气、时间同步、HTTP 请求、MQTT、AI 服务通信，都要先经过这一步。

## 硬件/代码入口

硬件使用 Waveshare ESP32-S3-RLCD-4.2。本篇只用到开发板的 ESP32-S3 Wi-Fi 能力和 Type-C 串口。

事实来源目录：

```text
D:\Tools\ESP-IDF\ESP32-S3-RLCD-4.2-Demo\ESP32-S3-RLCD-4.2-Demo\02_ESP-IDF\02_WIFI_STA
```

这个 STA 示例拆成了三层：

```text
main\main.c
components\user_app\user_app.c
components\esp_wifi_bsp\esp_wifi_bsp.c
```

入口非常短：

```c
void app_main(void)
{
    user_top_init();
}
```

`user_top_init()` 打印启动信息，然后调用 `espwifi_Init()`。真正的 Wi-Fi 初始化和连接逻辑都在 `esp_wifi_bsp.c`。

示例里默认连接的 Wi-Fi 是：

```c
.ssid = "K2P",
.password = "1234567890",
```

运行前通常需要把这里改成你自己的 2.4 GHz Wi-Fi 名称和密码。

## 运行现象

烧录并运行后，串口会先打印：

```text
wifi-example run
```

当 Wi-Fi 启动后，事件回调收到 `WIFI_EVENT_STA_START`，程序会调用 `esp_wifi_connect()` 开始连接路由器。

如果连接成功并拿到 IP，串口会打印类似：

```text
IP: 192.168.1.23
```

如果连接断开，串口会打印：

```text
disconnected
```

这个示例只打印断开信息，没有自动重连逻辑。初学阶段这反而更容易看懂：先把“启动、连接、拿 IP”这条主线跑通。

## 核心流程

这份 STA 示例的主流程是：

```text
app_main
-> user_top_init
-> 打印启动信息
-> espwifi_Init
-> 初始化 NVS / esp_netif / event loop
-> 创建默认 STA 网络接口
-> 初始化 Wi-Fi 驱动
-> 注册 Wi-Fi/IP 事件
-> 写入路由器 SSID 和密码
-> 设置为 STA 模式
-> 启动 Wi-Fi
-> 收到 STA_START 后连接路由器
-> 收到 GOT_IP 后打印 IP
```

先记住一句话：STA 示例的核心不是“创建热点”，而是“连接热点并拿到 IP”。

## 关键代码讲解

`main\main.c` 只做一件事：调用 `user_top_init()`。这让入口很干净，读者能马上知道应用从用户层开始。

`components\user_app\user_app.c` 也很短：

```c
printf("wifi-example run \n");
espwifi_Init();
```

它表达的是业务入口：程序启动后，进入 Wi-Fi 初始化。

`components\esp_wifi_bsp\esp_wifi_bsp.c` 是核心。`espwifi_Init()` 先准备基础设施：

```c
nvs_flash_init();
esp_netif_init();
esp_event_loop_create_default();
esp_netif_create_default_wifi_sta();
```

这里的 `esp_netif_create_default_wifi_sta()` 很关键，它创建的是 STA 网络接口，表示这块板子要作为“连接别人热点的客户端”。

接着初始化 Wi-Fi 驱动：

```c
wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
esp_wifi_init(&cfg);
```

然后注册事件处理函数 `event_handler()`。它处理三个事件：

- `WIFI_EVENT_STA_START`：Wi-Fi STA 启动，开始调用 `esp_wifi_connect()`。
- `IP_EVENT_STA_GOT_IP`：拿到 IP，打印 IP 地址。
- `WIFI_EVENT_STA_DISCONNECTED`：连接断开，打印 `disconnected`。

Wi-Fi 名称和密码写在 `wifi_config_t`：

```c
wifi_config_t wifi_config = {
    .sta = {
        .ssid = "K2P",
        .password = "1234567890",
    },
};
```

最后三步让 STA 配置生效：

```c
esp_wifi_set_mode(WIFI_MODE_STA);
esp_wifi_set_config(WIFI_IF_STA, &wifi_config);
esp_wifi_start();
```

这三句可以按顺序读：设置成 STA 模式，写入 STA 配置，启动 Wi-Fi。

## 动手改一改

第一步，改成你自己的 Wi-Fi。

打开：

```text
components\esp_wifi_bsp\esp_wifi_bsp.c
```

找到：

```c
.ssid = "K2P",
.password = "1234567890",
```

改成你的路由器信息，例如：

```c
.ssid = "my_home_wifi",
.password = "my_password",
```

第二步，只连接 2.4 GHz Wi-Fi。ESP32-S3 连接普通 2.4 GHz Wi-Fi；如果你的路由器有 5 GHz 专用名称，不要填 5 GHz 那个。

第三步，观察串口 IP。只要看到 `IP: ...`，就说明板子已经接入局域网。后续可以把这个 IP 用在 HTTP server、MQTT 或局域网调试中。

进阶小改动：在断开事件里重新连接。

当前示例断开后只打印：

```c
printf("disconnected\n");
```

你可以在理解主流程后，再考虑在这个分支里调用 `esp_wifi_connect()`。但初学阶段建议先不要急着加自动重连，先确认基础连接稳定。

## 常见坑

1. 一直打印 `disconnected`：SSID 或密码可能填错，先用手机确认这个 Wi-Fi 能正常连接。
2. 连不上 5 GHz Wi-Fi：ESP32-S3 使用 2.4 GHz Wi-Fi，请填写 2.4 GHz 网络名。
3. 看不到 `IP: ...`：说明还没拿到路由器分配的 IP，检查路由器 DHCP 是否开启。
4. 中文 Wi-Fi 名称失败：初学阶段建议先用英文和数字组成的 SSID，排除编码和输入法问题。
5. 改了代码但现象没变：确认重新编译、烧录，并且串口连接的是刚烧录的那块板。
6. 示例没有自动重连：这是事实来源代码的当前行为，不是你的板子坏了。

## 和 Pixel Soul 项目的关系

Pixel Soul 如果要联网获取时间、天气、远程配置、图片资源或 AI 服务，就必须有 STA 模式。AP 模式负责“第一次让用户找到设备”，STA 模式负责“设备真正接入家庭网络”。

在 Pixel Soul 里，一个常见网络主线会是：

```text
读取已保存 Wi-Fi 配置
-> 有配置：进入 STA 模式连接路由器
-> 连接成功：启动业务服务
-> 无配置或连接失败：进入 AP 配网模式
```

这篇 STA 示例就是其中“有配置后连接路由器”的最小可运行版本。等它稳定后，才适合继续接 HTTP、MQTT、SNTP 或云端接口。

## 补充阅读

- [ESP-IDF v5.5.3 ESP32-S3 Wi-Fi Driver Guide](https://docs.espressif.com/projects/esp-idf/en/v5.5.3/esp32s3/api-guides/wifi.html)
- [ESP-IDF v5.5.3 ESP32-S3 Wi-Fi API Reference](https://docs.espressif.com/projects/esp-idf/en/v5.5.3/esp32s3/api-reference/network/esp_wifi.html)
- [Waveshare ESP32-S3-RLCD-4.2 资料页](https://docs.waveshare.com/ESP32-S3-RLCD-4.2/)
