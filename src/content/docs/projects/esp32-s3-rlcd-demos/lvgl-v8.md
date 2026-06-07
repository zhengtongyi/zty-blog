---
title: ESP32-S3-RLCD LVGL v8 示例拆解
description: 从 LVGL 显示移植、draw buffer、flush callback、RLCD 黑白转换和图片切换任务入手，读懂 08_LVGL_V8_Test。
---

## 一句话定位

`08_LVGL_V8_Test` 演示如何把 LVGL v8 移植到 ESP32-S3-RLCD-4.2 的反射式黑白屏上，并通过一个任务每 1.5 秒切换两张图片。

## 基础原理

LVGL 是嵌入式 GUI 库。它负责 UI 对象、布局、事件和绘制，但它不知道具体屏幕怎么接线。因此移植 LVGL 时最关键的是显示端口：

```text
LVGL 计算需要刷新的区域和像素
  -> 调用 flush callback
  -> 项目代码把像素写到屏幕驱动
  -> 写完后调用 lv_disp_flush_ready()
```

本板是反射式黑白屏，而 LVGL 通常以 RGB565 等彩色格式组织像素。demo 的 flush callback 会把 LVGL 彩色像素按阈值转换成黑或白，再写入 RLCD 缓冲并刷新。

## 硬件与工程入口

源码阅读入口：

```text
02_ESP-IDF/08_LVGL_V8_Test/main/main.cpp
02_ESP-IDF/08_LVGL_V8_Test/components/app_bsp/lvgl_bsp.cpp
02_ESP-IDF/08_LVGL_V8_Test/components/port_bsp/display_bsp.cpp
02_ESP-IDF/08_LVGL_V8_Test/components/user_app/user_app.cpp
02_ESP-IDF/08_LVGL_V8_Test/components/ui_bsp/generated/
```

关键硬件配置：

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
| LVGL 版本 | `^8.4.0` |
| LVGL buffer | 全屏双缓冲，PSRAM |
| LVGL task | `LVGL`，stack `8 * 1024`，priority `5`，core `0` |

## 关键流程总图

```text
app_main()
  -> UserApp_AppInit()
  -> RlcdPort.RLCD_Init()
  -> Lvgl_PortInit(400, 300, Lvgl_FlushCallback)
      -> lv_init()
      -> 分配 draw buffer
      -> lv_disp_draw_buf_init()
      -> lv_disp_drv_init()
      -> 注册 flush_cb
      -> lv_disp_drv_register()
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
LVGL 需要刷新
  -> Lvgl_FlushCallback()
      -> 遍历 area 像素
      -> RGB565 阈值判断黑/白
      -> RlcdPort.RLCD_SetPixel()
      -> RlcdPort.RLCD_Display()
      -> lv_disp_flush_ready()
```

## 关键方法速查

| 函数/方法 | 所在文件 | 作用 | 初学者需要理解的点 |
| --- | --- | --- | --- |
| `app_main()` | `main/main.cpp` | 串起 RLCD、LVGL、UI、任务。 | 显示初始化顺序很重要。 |
| `RlcdPort.RLCD_Init()` | `components/port_bsp/display_bsp.cpp` | 初始化反射式屏幕。 | 这是硬件屏幕驱动入口。 |
| `Lvgl_PortInit()` | `components/app_bsp/lvgl_bsp.cpp` | 初始化 LVGL v8 显示端口。 | LVGL 移植核心在这里。 |
| `lv_init()` | LVGL API | 初始化 LVGL 内核。 | 所有 LVGL API 前先调用。 |
| `lv_disp_draw_buf_init()` | LVGL v8 API | 初始化显示绘制缓冲。 | v8 使用 draw buffer + disp drv。 |
| `lv_disp_drv_init()` | LVGL v8 API | 初始化显示驱动结构体。 | flush callback 注册到这里。 |
| `Lvgl_FlushCallback()` | `main/main.cpp` | 把 LVGL 像素刷新到 RLCD。 | 彩色像素转黑白是重点。 |
| `lv_disp_flush_ready()` | LVGL v8 API | 告诉 LVGL 本次刷新完成。 | 不调用会导致 LVGL 等待。 |
| `setup_ui()` | `components/ui_bsp/generated/` | 创建 SquareLine/生成 UI。 | generated UI 不建议手改太多。 |
| `Lvgl_LoopTask()` | `components/user_app/user_app.cpp` | 定时切换两张图片。 | 这是 demo 业务，不是 LVGL 移植本体。 |

## 关键代码讲解

LVGL v8 移植的核心是三件事：

```text
初始化 LVGL
  -> 提供 draw buffer
  -> 提供 flush callback
```

`Lvgl_PortInit()` 会分配显示缓冲并注册驱动。由于屏幕为 `400 x 300`，全屏 buffer 体积不小，所以 demo 使用 PSRAM。

`Lvgl_FlushCallback()` 是硬件和 LVGL 的桥。LVGL 传入区域和像素，callback 负责把像素写到屏幕。因为 RLCD 是黑白显示，demo 使用阈值：

```cpp
uint8_t color = (*buffer < 0x7fff) ? ColorBlack : ColorWhite;
```

这不是彩屏刷新，而是“把 RGB565 压成黑/白”。写完区域后，调用：

```cpp
RlcdPort.RLCD_Display();
lv_disp_flush_ready(drv);
```

`UserApp_UiInit()` 调用生成 UI：

```cpp
setup_ui(&init_ui);
```

然后 `Lvgl_LoopTask()` 只做一个很简单的动作：每 1.5 秒切换两张图片的隐藏状态。

## 实验现象

烧录运行后，屏幕显示一张图片，并每 1.5 秒在两张图片之间切换。若屏幕不刷新，优先排查 `flush callback` 是否被调用、SPI/RLCD 初始化是否成功、`lv_disp_flush_ready()` 是否执行。

## 常见问题

| 现象 | 可能原因 | 排查方式 |
| --- | --- | --- |
| 屏幕空白 | RLCD 未初始化或 flush 未执行。 | 确认 `RlcdPort.RLCD_Init()` 和 `Lvgl_PortInit()` 顺序。 |
| LVGL 卡住 | flush 后没有调用 `lv_disp_flush_ready()`。 | 检查 callback 结尾。 |
| 图片黑白效果不理想 | 阈值转换过于简单。 | 调整 `0x7fff` 阈值或提前处理图片。 |
| 改 UI 后无变化 | 修改了 generated 以外的文件或未重新生成。 | 找到 `setup_ui()` 创建的对象。 |
| 刷新慢 | RLCD 整屏刷新代价较高。 | 减少高频动画和大面积刷新。 |

## 工程迁移思路

迁移到真实 UI 时，建议把显示系统分成三层：

```text
DisplayPort
  -> 负责屏幕硬件初始化和像素刷新

LvglPort
  -> 负责 LVGL 初始化、buffer、tick、flush、锁

AppUI
  -> 负责页面、状态、图标和交互
```

不要让业务逻辑直接操作 `RLCD_SetPixel()`，也不要让显示驱动理解业务状态。这样 UI 迭代和底层屏幕适配才不会互相缠在一起。

## 补充阅读

- [LVGL v8.4 文档](https://docs.lvgl.io/8.4/)
- [LVGL v8 Display Porting](https://docs.lvgl.io/8.4/porting/display.html)
- [ESP-IDF LCD 外设文档](https://docs.espressif.com/projects/esp-idf/zh_CN/v5.5.3/esp32s3/api-reference/peripherals/lcd/index.html)
- [Waveshare ESP32-S3-RLCD-4.2 资料页](https://docs.waveshare.com/ESP32-S3-RLCD-4.2)
