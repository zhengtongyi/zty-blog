---
title: ESP32-S3-RLCD SD 卡读写入门
description: 从 0 开始看懂 Waveshare ESP32-S3-RLCD-4.2 Demo 里如何用 SDMMC 1-bit 模式挂载 FATFS，并读写 SD 卡文件。
---

## 一句话目标

把 SD 卡挂载成 `/sdcard` 目录，然后像在电脑上读写文件一样，用 `fopen()`、`fwrite()`、`fread()` 循环写入并读回 `writeTest.txt`。

## 先懂概念

SD 卡不是普通 GPIO 外设，它需要专门的 SD/MMC 主机控制器通信。ESP-IDF 提供 `SDMMC_HOST_DEFAULT()` 和 `esp_vfs_fat_sdmmc_mount()`，可以把底层 SDMMC 通信、分区识别、FAT 文件系统和 VFS 路径一次接起来。

SDMMC 有多线模式。这个 Demo 使用 `1-bit`，也就是只用 `CLK`、`CMD`、`D0` 三根主要信号线。它比 4-bit 慢，但布线更简单，也更适合先把 Demo 跑通。

FATFS 是嵌入式里常用的 FAT 文件系统实现。VFS 是 ESP-IDF 的虚拟文件系统层。挂载成功后，应用代码不需要每次直接操作 SD 卡扇区，而是可以访问 `/sdcard/writeTest.txt` 这样的路径。

## 硬件/代码入口

事实来源目录：

`D:\Tools\ESP-IDF\ESP32-S3-RLCD-4.2-Demo\ESP32-S3-RLCD-4.2-Demo\02_ESP-IDF\06_SD_Card`

关键入口：

- `main/main.cpp`：`app_main()` 只调用 `UserApp_AppInit()`。
- `components/user_app/user_app.cpp`：创建 `CustomSDPort("/sdcard")`，启动 `Fatfs_LoopTask`。
- `components/port_bsp/sdcard_bsp.h`：定义 SD 卡 BSP 类和默认引脚。
- `components/port_bsp/sdcard_bsp.cpp`：挂载 SD 卡，并封装文件读写。

默认引脚来自 `CustomSDPort` 构造函数：

```cpp
CustomSDPort(const char *SdName, int clk = 38, int cmd = 21, int d0 = 39, int width = 1);
```

也就是说这个 Demo 默认使用：

- `CLK = GPIO38`
- `CMD = GPIO21`
- `D0 = GPIO39`
- `width = 1`
- 挂载点：`/sdcard`

## 运行现象

挂载成功后，`sdmmc_card_print_info(stdout, sdcard_host)` 会打印 SD 卡信息，例如卡类型、容量、速度等。随后任务会每轮写入一行文本，再读出来打印：

```text
rtest:sdcard_writeTest : 1
rtest:sdcard_writeTest : 2
```

数字会持续递增。文件路径是：

```text
/sdcard/writeTest.txt
```

如果 SD 卡没插好、格式不对、引脚不对或卡没有响应，挂载不会得到有效 `sdcard_host`，后续读写会打印 `SD card not initialized` 或 `SD card not ready`。

## 核心流程

```text
app_main()
  -> UserApp_AppInit()
  -> new CustomSDPort("/sdcard")
  -> esp_vfs_fat_sdmmc_mount()
  -> xTaskCreatePinnedToCore(Fatfs_LoopTask)
  -> SDPort_WriteFile("/sdcard/writeTest.txt")
  -> SDPort_ReadFile("/sdcard/writeTest.txt")
  -> printf("rtest:%s")
```

主线只有三件事：挂载卡、写文件、读文件。

## 关键代码讲解

挂载配置在 `CustomSDPort::CustomSDPort()`：

```cpp
mount_config.format_if_mount_failed = false;
mount_config.max_files = 5;
mount_config.allocation_unit_size = 16 * 1024 * 3;
```

`format_if_mount_failed = false` 很重要。它表示挂载失败时不要自动格式化 SD 卡。对初学者来说，这更安全，因为不会因为一次接线或格式问题误清空卡里的文件。

SDMMC 主机和槽位配置：

```cpp
sdmmc_host_t host = SDMMC_HOST_DEFAULT();
sdmmc_slot_config_t slot_config = SDMMC_SLOT_CONFIG_DEFAULT();
slot_config.width = width;
slot_config.clk = (gpio_num_t)clk;
slot_config.cmd = (gpio_num_t)cmd;
slot_config.d0 = (gpio_num_t)d0;
```

这里选择 ESP32-S3 的 SDMMC host，并告诉驱动当前只用 1-bit 数据线。`CLK/CMD/D0` 必须和板子硬件连接一致。

真正把 SD 卡变成 `/sdcard` 目录的是：

```cpp
esp_vfs_fat_sdmmc_mount(SdName_, &host, &slot_config, &mount_config, &sdcard_host);
```

这个函数同时完成 SDMMC 初始化、FATFS 挂载、VFS 注册。成功后，`sdcard_host` 非空，代码会打印卡信息并把 `is_SdcardInitOK` 设为 `1`。

写文件在 `SDPort_WriteFile()`：

```cpp
FILE *f = fopen(path, "wb");
fwrite(data, 1, data_len, f);
fclose(f);
```

`"wb"` 表示以二进制写入方式打开文件。如果文件已存在，会覆盖旧内容。所以 Demo 里每次读回来的通常是最新一行，而不是完整历史。

读文件在 `SDPort_ReadFile()`：先 `fseek()` 到末尾获取文件大小，再回到开头 `fread()`。调用者可以通过 `outLen` 拿到实际读取字节数。Demo 传了 `NULL`，说明它只关心字符串内容，不关心长度。

## 动手改一改

1. 改成追加写入：把 `SDPort_WriteFile()` 的打开模式从 `"wb"` 改为 `"ab"`，观察 `writeTest.txt` 是否累计多行。
2. 改文件名：把 `/sdcard/writeTest.txt` 改成 `/sdcard/log.txt`，确认路径要以挂载点 `/sdcard` 开头。
3. 打印读取长度：调用 `SDPort_ReadFile()` 时传入 `size_t outLen`，读完后打印字节数。
4. 关闭写入测试：注释 `#define sdcard_write_Test`，观察任务只延时不读写。

## 常见坑

- SD 卡未格式化为 FAT：`esp_vfs_fat_sdmmc_mount()` 需要能识别 FAT 文件系统。初学者建议先在电脑上格式化为 FAT32。
- `format_if_mount_failed` 误设为 `true`：这样挂载失败时可能格式化卡。做实验前务必确认卡里没有重要数据。
- 1-bit/4-bit 搞混：Demo 默认 `width = 1`，只配置 `D0`；如果改成 4-bit，还要正确连接并配置更多数据线。
- 引脚不匹配：`CLK=38`、`CMD=21`、`D0=39` 是这个 Demo 的默认值，换板子或飞线时必须重新核对。
- 文件路径漏掉挂载点：应使用 `/sdcard/writeTest.txt`，不是 `writeTest.txt`。
- 读入 buffer 太小：Demo 的 `rtest[45]` 只够读短字符串，读大文件时必须准备更大的 buffer 或分块读取。
- 卡被拔出：代码用 `sdmmc_get_status(sdcard_host)` 检查状态，拔卡后可能出现 `SD card not ready`。

## 和 Pixel Soul 项目的关系

Pixel Soul 如果要保存配置、缓存音频、记录日志或存放表情资源，SD 卡就是一个外部持久化空间。它应该被封装成存储服务，而不是让业务模块到处直接 `fopen("/sdcard/...")`。

推荐边界是：

```text
Config / Cache / Log / Asset
  -> StorageService
  -> SD card BSP
  -> ESP-IDF SDMMC + FATFS + VFS
```

这样 SD 卡不存在时，StorageService 可以统一降级：配置使用默认值，缓存关闭，日志转串口，UI 仍然可以启动。

## 补充阅读

- [ESP-IDF v5.5.3 SDMMC Host Driver - ESP32-S3](https://docs.espressif.com/projects/esp-idf/en/v5.5.3/esp32s3/api-reference/peripherals/sdmmc_host.html)
- [ESP-IDF v5.5.3 FAT Filesystem Support - ESP32-S3](https://docs.espressif.com/projects/esp-idf/en/v5.5.3/esp32s3/api-reference/storage/fatfs.html)
- [ESP-IDF v5.5.3 Virtual Filesystem - ESP32-S3](https://docs.espressif.com/projects/esp-idf/en/v5.5.3/esp32s3/api-reference/storage/vfs.html)
- [ESP-IDF v5.5.3 SD/SDIO/MMC Driver - ESP32-S3](https://docs.espressif.com/projects/esp-idf/en/v5.5.3/esp32s3/api-reference/storage/sdmmc.html)
- [Waveshare ESP32-S3-RLCD-4.2 资料页](https://docs.waveshare.com/ESP32-S3-RLCD-4.2/)
