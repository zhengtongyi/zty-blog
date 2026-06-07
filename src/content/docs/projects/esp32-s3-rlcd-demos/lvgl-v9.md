---
title: ESP32-S3-RLCD LVGL v9 示例拆解
description: 对比 LVGL v8 的显示移植方式，读懂 09_LVGL_V9_Test 如何使用 LVGL v9 display API 驱动反射式屏幕。
---

## 一句话定位

`09_LVGL_V9_Test` 演示同一块 ESP32-S3-RLCD 屏幕在 LVGL v9 下的移植方式。业务现象仍是两张图片轮播，重点是理解 v9 的显示注册 API 与 v8 的差异。

## 基础原理

LVGL v9 仍然遵循同一个大原则：

```text
LVGL 管 UI 和绘制
项目代码管屏幕硬件刷新
flush callback 是两者之间的桥
```

变化主要在 API 命名和 display 对象模型。v8 常见写法是 `lv_disp_drv_t`、`lv_disp_draw_buf_t`、`lv_disp_drv_register()`；v9 更强调 `lv_display_t`：

```text
LVGL v8:
  lv_disp_draw_buf_init()
  lv_disp_drv_init()
  lv_disp_drv_register()

LVGL v9:
  lv_display_create()
  lv_display_set_flush_cb()
  lv_display_set_buffers()
```

因此这篇更适合和 [LVGL v8 示例](./lvgl-v8/) 对照阅读。

## 硬件与工程入口

源码阅读入口：

```text
02_ESP-IDF/09_LVGL_V9_Test/main/main.cpp
02_ESP-IDF/09_LVGL_V9_Test/components/app_bsp/lvgl_bsp.cpp
02_ESP-IDF/09_LVGL_V9_Test/components/port_bsp/display_bsp.cpp
02_ESP-IDF/09_LVGL_V9_Test/components/user_app/user_app.cpp
02_ESP-IDF/09_LVGL_V9_Test/components/ui_bsp/generated/
```

关键配置和 v8 基本一致：

| 项目 | 配置 |
| --- | --- |
| 屏幕对象 | `DisplayPort RlcdPort(12, 11, 5, 40, 41, 400, 300)` |
| MOSI | GPIO12 |
| SCK | GPIO11 |
| DC | GPIO5 |
| CS | GPIO40 |
| RST | GPIO41 |
| 分辨率 | `400 x 300` |
| SPI host | `SPI3_HOST` |
| SPI clock | `10 MHz` |
| LVGL 版本 | `^9.4.0` |
| LVGL buffer | 全屏双缓冲，PSRAM |

## 关键流程总图

```text
app_main()
  -> UserApp_AppInit()
  -> RlcdPort.RLCD_Init()
  -> Lvgl_PortInit(400, 300, Lvgl_FlushCallback)
      -> lv_init()
      -> 分配 display buffer
      -> lv_display_create(width, height)
      -> lv_display_set_flush_cb()
      -> lv_display_set_buffers()
      -> 启动 tick timer
      -> 创建 LVGL task
  -> Lvgl_lock(-1)
      -> UserApp_UiInit()
          -> setup_ui()
      -> Lvgl_unlock()
  -> UserApp_TaskInit()
      -> Lvgl_LoopTask()
```

刷新链路：

```text
LVGL v9 display 触发刷新
  -> Lvgl_FlushCallback(lv_display_t *, area, color_map)
      -> RGB565 阈值转黑白
      -> RlcdPort.RLCD_SetPixel()
      -> RlcdPort.RLCD_Display()
      -> lv_display_flush_ready()
```

## 关键方法速查

| 函数/方法 | 所在文件 | 作用 | 初学者需要理解的点 |
| --- | --- | --- | --- |
| `app_main()` | `main/main.cpp` | 串起屏幕、LVGL、UI、任务。 | 与 v8 主流程几乎一致。 |
| `Lvgl_PortInit()` | `components/app_bsp/lvgl_bsp.cpp` | 初始化 LVGL v9 display。 | v9 的重点在 display API。 |
| `lv_display_create()` | LVGL v9 API | 创建显示对象。 | v9 不再沿用 v8 的 `lv_disp_drv_register()` 主写法。 |
| `lv_display_set_flush_cb()` | LVGL v9 API | 注册刷新回调。 | callback 仍然是硬件适配核心。 |
| `lv_display_set_buffers()` | LVGL v9 API | 设置显示缓冲。 | buffer 模式会影响内存和刷新性能。 |
| `Lvgl_FlushCallback()` | `main/main.cpp` | 把 LVGL 像素写到 RLCD。 | 仍然要做 RGB565 到黑白转换。 |
| `lv_display_flush_ready()` | LVGL v9 API | 通知 LVGL 刷新完成。 | v9 名称不同，作用类似 v8。 |
| `setup_ui()` | `components/ui_bsp/generated/` | 创建生成 UI。 | UI 生成代码和显示驱动应分开看。 |
| `Lvgl_LoopTask()` | `components/user_app/user_app.cpp` | 两张图片轮播。 | demo 业务不等于 LVGL porting。 |

## 关键代码讲解

v9 的显示对象创建更直接：

```text
lv_display_create(width, height)
lv_display_set_flush_cb(display, callback)
lv_display_set_buffers(display, buf1, buf2, size, mode)
```

这比 v8 的 `lv_disp_drv_t` 结构体写法更集中。初学迁移时要特别注意：网上很多老教程基于 LVGL v8，复制到 v9 工程会遇到 API 名称不匹配。

flush callback 的业务没有变。它仍然负责：

```text
遍历 LVGL 给出的 area
  -> 读取 color_map
  -> 阈值转黑/白
  -> 写入 RLCD 缓冲
  -> 整屏刷新
  -> 通知 LVGL 完成
```

所以 v9 学习重点不是“UI 轮播”，而是“同一块硬件屏幕在 v9 API 下怎么接入”。

## 实验现象

运行后，屏幕和 v8 demo 类似，显示两张图片并周期切换。若 v8 正常而 v9 不正常，优先检查 LVGL v9 的 display 初始化和 flush ready API 是否使用正确。

## 常见问题

| 现象 | 可能原因 | 排查方式 |
| --- | --- | --- |
| 复制 v8 代码编译失败 | LVGL v9 API 名称和对象模型变化。 | 使用 `lv_display_*` API。 |
| 屏幕不刷新 | flush callback 未注册或未调用 ready。 | 检查 `lv_display_set_flush_cb()` 和 `lv_display_flush_ready()`。 |
| UI 对象创建正常但无显示 | LVGL 层和屏幕层未打通。 | 在 flush callback 加日志确认是否进入。 |
| 黑白效果不理想 | 阈值转换简单。 | 优化图片资源或阈值策略。 |
| 刷新卡顿 | 全屏刷新和 PSRAM buffer 成本较高。 | 减少动画，降低刷新频率。 |

## 工程迁移思路

如果项目从 LVGL v8 升级到 v9，建议先只替换 `LvglPort`：

```text
保持 DisplayPort 不变
保持 AppUI 业务尽量不变
只改 LVGL 初始化、display 注册、flush ready API
```

这样能降低迁移风险。底层屏幕硬件驱动和上层 UI 业务如果边界清晰，LVGL 版本升级就不会牵动整个应用。

## 补充阅读

- [LVGL v9.4 文档](https://docs.lvgl.io/9.4/)
- [LVGL v9 Display Porting](https://docs.lvgl.io/9.4/porting/display.html)
- [ESP-IDF LCD 外设文档](https://docs.espressif.com/projects/esp-idf/zh_CN/v5.5.3/esp32s3/api-reference/peripherals/lcd/index.html)
- [Waveshare ESP32-S3-RLCD-4.2 资料页](https://docs.waveshare.com/ESP32-S3-RLCD-4.2)
