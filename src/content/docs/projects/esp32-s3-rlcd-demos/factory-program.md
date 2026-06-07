---
title: ESP32-S3-RLCD-4.2 FactoryProgram 综合测试零基础教程
description: 从 10_FactoryProgram 工程理解 Wi-Fi、BLE、Audio、Display、Sensor、SD 和按键如何被串成一个综合出厂测试程序。
---

## 一句话目标

看懂 `10_FactoryProgram`：它不是生产刷机指南，而是一个把 Wi-Fi、BLE、音频、显示、传感器、SD 卡、按键等能力串起来的综合出厂测试程序。

## 先懂概念

出厂测试程序的目标不是“做一个完整产品功能”，而是快速确认一块板子的关键硬件是否能工作。你可以把它理解成一张硬件体检表：

- 屏幕能不能显示。
- SD 卡能不能读写。
- Wi-Fi 能不能扫描到 AP。
- BLE 能不能扫描到设备。
- 音频 codec 能不能录音、播放、播内置音乐。
- RTC、温湿度、电池 ADC 能不能读到数据。
- BOOT 和 KEY 按键能不能触发不同操作。

所以读这个工程时，不要按“用户产品流程”去读，而要按“系统集成检查流程”去读：先初始化所有硬件能力，再用多个 FreeRTOS 任务分别跑测试项，最后把结果显示到 LVGL 页面上。

## 硬件/代码入口

主入口仍然在 `main/main.cpp`：

```cpp
UserApp_AppInit();
RlcdPort.RLCD_Init();
Lvgl_PortInit(400, 300, Lvgl_FlushCallback);
UserApp_UiInit();
UserApp_TaskInit();
```

和 LVGL v9 示例相比，这个工程用的是 `lvgl/lvgl: ^8.4.0`，所以 flush callback 签名还是 v8 风格：

```cpp
static void Lvgl_FlushCallback(lv_disp_drv_t *drv, const lv_area_t *area, lv_color_t *color_map)
```

主要入口文件：

- `main/main.cpp`：启动顺序和 RLCD flush callback。
- `components/user_app/user_app.cpp`：综合测试主逻辑。
- `components/app_bsp/esp_wifi_bsp.c`：Wi-Fi 初始化和扫描 AP 数量。
- `components/app_bsp/ble_scan_bsp.c`：BLE 扫描并统计设备数量。
- `components/port_bsp/codec_bsp.cpp`：音频 codec 封装。
- `components/port_bsp/sdcard_bsp.cpp`：SD 卡挂载和文件读写。
- `components/port_bsp/i2c_equipment.cpp`：RTC、温湿度等 I2C 设备。
- `components/port_bsp/button_bsp.c`：BOOT、KEY 按键事件。
- `components/ui_bsp/generated/`：生成的 LVGL UI。

## 运行现象

程序启动后会先显示一个简单开场页面，然后切到测试信息页面。界面会陆续更新这些结果：

- 电池百分比。
- RTC 分钟、秒数。
- 温湿度。
- SD 卡测试结果，成功时显示 `passed`，失败时显示 `failed`，无卡时显示 `No Card`。
- BLE 扫描到的设备数量。
- Wi-Fi 扫描到的 AP 数量，超时或失败时显示 `P`。
- 音频状态，例如 `Recording...`、`Rec Done`、`Playing...`、`Play Music`、`Idle`。

按键还会切换不同测试页面，或者触发录音、播放、音乐播放等动作。

## 核心流程

这个综合程序的主干可以压缩成一句话：

初始化硬件能力 -> 加载测试 UI -> 启动多个测试任务 -> 任务把测试结果写回 UI。

展开看就是：

1. `UserApp_AppInit()` 分配音频缓冲区，初始化 SD、ADC、按键、RTC、温湿度、Wi-Fi、codec。
2. `RlcdPort.RLCD_Init()` 初始化 RLCD 屏幕。
3. `Lvgl_PortInit()` 启动 LVGL 显示任务和刷新回调。
4. `UserApp_UiInit()` 调用 `setup_ui(&init_ui)` 创建 generated UI。
5. `UserApp_TaskInit()` 创建显示、SD、Wi-Fi/BLE、按键、音频等任务。
6. 各任务独立测试自己的硬件模块。
7. 测试结果通过 `lv_label_set_text()` 显示到屏幕标签上。

注意这里没有一个“超级 while 循环”把所有硬件挨个测完。它更像一个小型系统集成样板：不同能力由不同任务负责，任务之间用 `EventGroup`、`Queue` 和 UI 标签协作。

## 关键代码讲解

`UserApp_AppInit()` 是硬件能力集合点。它做了这些事：

```cpp
sdcardPort = new CustomSDPort("/sdcard");
Adc_PortInit();
Custom_ButtonInit();
Rtc_Setup(&I2cbus, 0x51);
shtc3port = new Shtc3Port(I2cbus);
espwifi_init();
codecport = new CodecPort(I2cbus, "S3_RLCD_4_2");
```

这段代码告诉你本工程测试了哪些硬件能力：SD 卡、ADC 电池、按键、RTC、SHTC3 温湿度、Wi-Fi、音频 codec。I2C 总线在文件顶部创建：

```cpp
I2cMasterBus I2cbus(14, 13, 0);
```

也就是说，多种外设共享一条 I2C 总线，由不同 BSP 类封装具体设备。

SD 卡测试在 `Lvgl_SDcardTask()`：

```cpp
sdcardPort->SDPort_WriteFile("/sdcard/sdcard.txt", str_write, strlen(str_write));
sdcardPort->SDPort_ReadFile("/sdcard/sdcard.txt", (uint8_t *)str_read, NULL);
```

它写入 `waveshare.com`，再读回来比较。如果一致，界面显示 `passed`。这是典型的出厂测试思路：不解释文件系统全部原理，只验证“能挂载、能写、能读、数据一致”。

Wi-Fi 和 BLE 放在同一个任务 `Lvgl_WfifBleScanTask()` 里。它先等待 Wi-Fi 扫描完成：

```cpp
xEventGroupWaitBits(wifi_even_, 0x02, pdTRUE, pdTRUE, pdMS_TO_TICKS(30000));
```

然后释放 Wi-Fi：

```cpp
espwifi_deinit();
```

再初始化 BLE 并扫描：

```cpp
ble_scan_prepare();
ble_stack_init();
ble_scan_start();
```

这说明工程在系统资源上做了取舍：先用 Wi-Fi 扫 AP，结束后释放 Wi-Fi，再跑 BLE 扫描。初学者读到这里要关注“资源生命周期”，不要只看单个 API。

音频逻辑由 `Codec_LoopTask()` 管理。它等待 `CodecGroups` 里的事件位：

```cpp
xEventGroupWaitBits(CodecGroups, (0x01 | 0x02 | 0x04), pdTRUE, pdFALSE, pdMS_TO_TICKS(8 * 1000));
```

不同事件对应不同动作：

- `0x01`：录音到 `audio_ptr`。
- `0x02`：播放刚才录到的数据。
- `0x04`：播放工程内嵌的 `canon.pcm`。

按键任务负责把用户操作变成这些事件。`BOOT_LoopTask()` 和 `KEY_LoopTask()` 读取不同按键事件组，再决定是切换页面，还是设置 `CodecGroups` 的录音/播放位。

显示刷新仍然走 RLCD flush callback。LVGL 给一片颜色数据，工程用阈值转成黑白：

```cpp
uint8_t color = (*buffer < 0x7fff) ? ColorBlack : ColorWhite;
```

所以这里的显示测试不是彩屏测试，而是验证 LVGL UI 能通过 RLCD 驱动显示在反射式黑白屏上。

## 动手改一改

第一个安全实验：改开机后欢迎页面停留时间。

在 `Lvgl_Cont1Task()` 中有两处：

```cpp
vTaskDelay(pdMS_TO_TICKS(1500));
```

改成 `3000`，开场文字停留更久；改成 `500`，切换更快。

第二个实验：改 SD 卡测试字符串。

把：

```cpp
const char *str_write = "waveshare.com";
```

改成更短的字符串，比如 `"sd ok"`。如果仍显示 `passed`，说明写入和读取链路没问题。

第三个实验：改 Wi-Fi 默认 SSID。

`esp_wifi_bsp.c` 里有：

```cpp
.ssid = "PDCN",
.password = "1234567890",
```

这个测试主要依赖扫描 AP 数量，不是产品联网流程。你可以改成自己环境里的 SSID 和密码，但不要把它理解成正式配网方案。

第四个实验：观察按键到音频的链路。

不要急着改 codec 底层，先在 `BOOT_LoopTask()` 和 `KEY_LoopTask()` 里看事件位如何进入 `CodecGroups`。这能帮你理解“按键事件 -> 音频动作”的集成方式。

## 常见坑

- 这不是生产刷机指南。不要从这篇文章理解量产烧录、工站流程、校准流程或序列号写入。
- 工程里 Wi-Fi、BLE、Audio、Display、Sensor、SD、按键都放在一起，复杂是正常的。读它时先抓任务边界，不要从底层驱动文件开始读。
- FactoryProgram 使用 LVGL v8，不是 LVGL v9。它和 `09_LVGL_V9_Test` 在 flush callback 类型上不同。
- Wi-Fi 和 BLE 会竞争系统资源。示例先 `espwifi_deinit()`，再初始化 BLE，这是重要事实。
- 部分中文字符串在源码显示为乱码，文章不要照抄这些乱码。界面状态可以按英文标签理解，例如 `Recording...`、`Play Done`、`Idle`。
- SD 卡测试依赖实际插卡和文件系统挂载。没有卡时显示 `No Card` 不是程序崩溃。
- 音频录放使用 PSRAM 中的 `audio_ptr` 大缓冲区，内存不足会导致断言失败。
- generated UI 文件可以帮助查标签名，但不适合作为初学者主要修改点。

## 和 Pixel Soul 项目的关系

Pixel Soul 最终也会是一个系统集成项目：屏幕显示、音频输入输出、按键或触摸、网络、传感器、电源状态，都要一起工作。FactoryProgram 的价值就在于展示“多模块如何被串起来”。

可以从这个工程借鉴三点：

- 用清楚的 BSP 边界包住硬件能力，例如 `CodecPort`、`CustomSDPort`、`Shtc3Port`。
- 上层任务只表达业务动作，例如扫描、显示结果、录音、播放，不把寄存器细节散落在业务流程里。
- 跨任务协作用 `EventGroup` 或 `Queue`，例如按键任务设置音频事件，BLE 扫描把 MAC 放进队列。

但 Pixel Soul 不能直接照搬 FactoryProgram 的页面和任务组织。FactoryProgram 是“硬件体检”，Pixel Soul 是“长期运行的产品应用”。前者追求覆盖硬件测试项，后者更需要稳定的主状态机、低功耗策略和清晰的用户体验。

## 补充阅读

- [ESP-IDF v5.5.3 Wi-Fi 编程指南](https://docs.espressif.com/projects/esp-idf/zh_CN/v5.5.3/esp32s3/api-guides/wifi.html)
- [ESP-IDF v5.5.3 Bluetooth API Reference](https://docs.espressif.com/projects/esp-idf/zh_CN/v5.5.3/esp32s3/api-reference/bluetooth/index.html)
- [ESP-IDF v5.5.3 LCD 文档](https://docs.espressif.com/projects/esp-idf/zh_CN/v5.5.3/esp32s3/api-reference/peripherals/lcd/index.html)
- [ESP-IDF v5.5.3 SD/SDIO/MMC 驱动](https://docs.espressif.com/projects/esp-idf/zh_CN/v5.5.3/esp32s3/api-reference/peripherals/sdmmc_host.html)
- [LVGL v8 官方文档](https://docs.lvgl.io/8.4/)
- [LVGL v9 官方文档](https://docs.lvgl.io/9.4/)
- [Waveshare ESP32-S3-RLCD-4.2 资料](https://docs.waveshare.com/ESP32-S3-RLCD-4.2/)
