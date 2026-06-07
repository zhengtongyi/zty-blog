---
title: ESP32-S3-RLCD SD Card 示例拆解
description: 从 SDMMC、FATFS、挂载点和文件读写入手，读懂 06_SD_Card 如何挂载 SD 卡并读写文件。
---

## 一句话定位

`06_SD_Card` 演示通过 SDMMC 1-bit 模式挂载 SD 卡到 `/sdcard`，再用标准 C 文件 API 写入和读取测试文件。

## 基础原理

SD 卡在 ESP-IDF 中通常分两层理解：

```text
SDMMC host/slot
  -> 负责和 SD 卡硬件通信

FATFS/VFS
  -> 把 SD 卡挂载成路径
  -> 让应用用 fopen/fread/fwrite 读写文件
```

`esp_vfs_fat_sdmmc_mount()` 是一个高层便捷函数：它帮应用初始化 SDMMC、挂载 FAT 文件系统，并把挂载点注册到 VFS。挂载成功后，应用就可以像在普通文件系统里一样使用 `/sdcard/xxx.txt`。

## 硬件与工程入口

源码阅读入口：

```text
02_ESP-IDF/06_SD_Card/main/main.cpp
02_ESP-IDF/06_SD_Card/components/user_app/user_app.cpp
02_ESP-IDF/06_SD_Card/components/port_bsp/sdcard_bsp.cpp
02_ESP-IDF/06_SD_Card/components/port_bsp/sdcard_bsp.h
```

关键硬件配置：

| 项目 | 配置 |
| --- | --- |
| SD 模式 | SDMMC 1-bit |
| CLK | GPIO38 |
| CMD | GPIO21 |
| D0 | GPIO39 |
| 挂载点 | `/sdcard` |
| 测试文件 | `/sdcard/writeTest.txt` |
| `max_files` | `5` |
| `format_if_mount_failed` | `false` |

## 关键流程总图

```text
app_main()
  -> UserApp_AppInit()
      -> new CustomSDPort("/sdcard")
          -> SDMMC_HOST_DEFAULT()
          -> SDMMC_SLOT_CONFIG_DEFAULT()
          -> 配置 CLK/CMD/D0 和 width=1
          -> esp_vfs_fat_sdmmc_mount()
          -> sdmmc_card_print_info()
      -> xTaskCreatePinnedToCore(Fatfs_LoopTask, core 0)

Fatfs_LoopTask()
  -> SDPort_WriteFile("/sdcard/writeTest.txt")
      -> fopen("wb")
      -> fwrite()
      -> fclose()
  -> SDPort_ReadFile("/sdcard/writeTest.txt")
      -> fopen("rb")
      -> fread()
      -> fclose()
  -> printf()
```

## 关键方法速查

| 函数/方法 | 所在文件 | 作用 | 初学者需要理解的点 |
| --- | --- | --- | --- |
| `app_main()` | `main/main.cpp` | ESP-IDF 应用入口。 | 只调用用户应用初始化。 |
| `UserApp_AppInit()` | `components/user_app/user_app.cpp` | 创建 SD 卡对象并启动文件测试任务。 | 应用层只表达“读写文件”。 |
| `CustomSDPort` | `components/port_bsp/sdcard_bsp.cpp` | 配置 SDMMC 并挂载 FATFS。 | 板级引脚和挂载细节集中在这里。 |
| `SDMMC_HOST_DEFAULT()` | ESP-IDF SDMMC API | 创建默认 host 配置。 | host 表示 ESP32-S3 侧控制器。 |
| `SDMMC_SLOT_CONFIG_DEFAULT()` | ESP-IDF SDMMC API | 创建默认 slot 配置。 | slot 表示 SD 卡接口资源。 |
| `esp_vfs_fat_sdmmc_mount()` | ESP-IDF FATFS API | 挂载 SD 卡文件系统。 | 成功后才有 `/sdcard` 路径。 |
| `SDPort_WriteFile()` | `components/port_bsp/sdcard_bsp.cpp` | 写入二进制文件。 | 内部使用标准 C `fopen/fwrite`。 |
| `SDPort_ReadFile()` | `components/port_bsp/sdcard_bsp.cpp` | 读取文件内容。 | 读取前会检查卡状态。 |
| `Fatfs_LoopTask()` | `components/user_app/user_app.cpp` | 周期写入并读回测试内容。 | 用于验证挂载和读写链路。 |

## 关键代码讲解

构造 SD 端口时，demo 先准备 host 和 slot：

```cpp
sdmmc_host_t host = SDMMC_HOST_DEFAULT();
sdmmc_slot_config_t slot_config = SDMMC_SLOT_CONFIG_DEFAULT();
```

然后将总线宽度限制为 1-bit，并设置板级引脚：

```text
CLK -> GPIO38
CMD -> GPIO21
D0  -> GPIO39
width = 1
```

挂载由一个高层 API 完成：

```cpp
esp_vfs_fat_sdmmc_mount(...);
```

它成功后，`/sdcard` 才成为可用路径。应用层的写文件函数就可以使用：

```cpp
fopen(path, "wb");
fwrite(data, 1, len, file);
```

读文件则使用：

```cpp
fopen(path, "rb");
fread(buffer, 1, size, file);
```

这说明 ESP-IDF 的 VFS 已经把底层 SD 卡抽象成了类 POSIX 文件系统接口。

## 实验现象

插入可用 SD 卡后，串口会打印 SD 卡信息，并周期写入和读取测试文件。读回内容会通过 `printf()` 输出。

如果未插卡或文件系统无法挂载，挂载函数会返回错误。因为 `format_if_mount_failed=false`，demo 不会自动格式化 SD 卡。

## 常见问题

| 现象 | 可能原因 | 排查方式 |
| --- | --- | --- |
| 挂载失败 | 未插卡、卡损坏、文件系统不兼容、引脚不匹配。 | 先用电脑确认 SD 卡可读，建议 FAT32。 |
| 没有 `/sdcard` 路径 | 挂载失败。 | 只有 `esp_vfs_fat_sdmmc_mount()` 成功后路径才存在。 |
| 文件读写失败 | 卡状态异常或路径错误。 | 确认使用 `/sdcard/...` 前缀。 |
| 希望失败时自动格式化 | 当前配置关闭自动格式化。 | 修改 `format_if_mount_failed` 前要确认不会误删数据。 |
| 长期写日志卡顿 | SD 卡写入延迟不稳定。 | 产品代码应加缓存和异步写入策略。 |

## 工程迁移思路

产品中建议把 SD 卡封装成存储服务：

```text
SdService
  -> init/mount
  -> get_status
  -> read/write/list
  -> unmount
  -> 错误降级和限频日志
```

业务层不应该到处直接写 `/sdcard/...`。统一封装后，可以集中处理“无卡、满卡、写失败、卸载、路径规范、并发访问”等问题。

## 补充阅读

- [ESP-IDF SD/SDIO/MMC Driver](https://docs.espressif.com/projects/esp-idf/zh_CN/v5.5.3/esp32s3/api-reference/peripherals/sdmmc_host.html)
- [ESP-IDF FATFS](https://docs.espressif.com/projects/esp-idf/zh_CN/v5.5.3/esp32s3/api-reference/storage/fatfs.html)
- [Waveshare ESP32-S3-RLCD-4.2 资料页](https://docs.waveshare.com/ESP32-S3-RLCD-4.2)
