---
title: ESP32-S3-RLCD-4.2 LVGL v8 零基础教程
description: 从 LVGL、display flush、RLCD、SquareLine 生成 UI、图片资源和事件开始，读懂 Waveshare ESP32-S3-RLCD-4.2 LVGL v8 示例。
---

## 一句话目标

把 `08_LVGL_V8_Test` 跑起来，并看懂“LVGL 画界面 -> flush 回调转成 RLCD 黑白像素 -> 屏幕刷新”的显示流程。

## 先懂概念

零基础可以先把这个 demo 分成三层：

- LVGL：负责“画什么”。比如创建屏幕、图片、标签、按钮、样式、动画。
- 显示驱动：负责“怎么把 LVGL 的像素送到屏幕”。在这个 demo 里就是 `Lvgl_FlushCallback()` 和 `DisplayPort`。
- RLCD：真正的 4.2 英寸反射式屏幕。它不像普通彩色 LCD 那样显示 RGB 彩色画面，这个示例会把 LVGL 的颜色转成黑白像素再刷新。

`display flush` 是理解 LVGL 移植的关键。LVGL 不知道你的屏幕怎么接线，也不知道要发哪些 SPI 命令。它只会在需要刷新时调用你注册的 `flush_cb`，把一块区域的像素交给你。你在 `flush_cb` 里把这些像素写进屏幕，写完后告诉 LVGL：“这次刷新完成了。”

`SquareLine/generated UI` 指的是用图形化工具生成的 UI 代码。这个 demo 的 `components/ui_bsp/generated` 里有 `setup_scr_screen.c`、`gui_guider.c`、图片资源和事件文件，整体风格明显是生成式 UI 工程。

## 硬件/代码入口

示例工程在：

```text
D:\Tools\ESP-IDF\ESP32-S3-RLCD-4.2-Demo\ESP32-S3-RLCD-4.2-Demo\02_ESP-IDF\08_LVGL_V8_Test
```

最重要的入口文件：

- `main/main.cpp`：应用入口，初始化应用、RLCD、LVGL 和 UI。
- `components/app_bsp/lvgl_bsp.cpp`：LVGL 移植层，创建 draw buffer、注册 display driver、启动 LVGL tick 和 handler 任务。
- `components/port_bsp/display_bsp.cpp`：RLCD 底层驱动，负责 SPI、复位、初始化命令、像素缓存和整屏发送。
- `components/user_app/user_app.cpp`：业务层任务，每 1.5 秒切换两张图片。
- `components/ui_bsp/generated/setup_scr_screen.c`：生成的界面，创建 400x300 屏幕和两张图片。
- `components/ui_bsp/generated/events_init.c`：生成的事件入口，本 demo 里是空的。

屏幕初始化在 `main/main.cpp`：

```cpp
DisplayPort RlcdPort(12,11,5,40,41,LCD_WIDTH,LCD_HEIGHT);
```

这几个参数是显示相关引脚和分辨率入口。后面 `RlcdPort.RLCD_Init()` 会真正初始化 RLCD。

## 运行现象

烧录后，RLCD 会显示一张 400x300 图片。随后程序每隔约 1.5 秒在两张图片之间切换：

- `screen_img_1` 使用 `_ein_alpha_400x300`。
- `screen_img_2` 使用 `_2_alpha_400x300`。

这两张图片都在：

```text
components/ui_bsp/generated/images
```

你看到的“动画”其实不是复杂动画，而是任务不断切换两个 LVGL 图片对象的隐藏状态：

```cpp
lv_obj_clear_flag(..., LV_OBJ_FLAG_HIDDEN);
lv_obj_add_flag(..., LV_OBJ_FLAG_HIDDEN);
```

## 核心流程

这篇先抓主干，不陷入每条屏幕命令：

```text
app_main
-> UserApp_AppInit
-> RlcdPort.RLCD_Init
-> Lvgl_PortInit(400, 300, Lvgl_FlushCallback)
-> UserApp_UiInit
-> setup_ui
-> setup_scr_screen
-> UserApp_TaskInit
-> Lvgl_LoopTask 每 1.5 秒切换图片
```

显示刷新主线是：

```text
LVGL 产生颜色像素
-> 调用 Lvgl_FlushCallback
-> 把 LVGL 颜色转成 ColorBlack / ColorWhite
-> RlcdPort.RLCD_SetPixel 写入 RLCD 缓存
-> RlcdPort.RLCD_Display 发送到屏幕
-> lv_disp_flush_ready 通知 LVGL 完成
```

这个流程就是 LVGL 移植的核心。你以后换屏幕、换驱动，大概率也是改 flush 和底层 display port。

## 关键代码讲解

`app_main()` 是整篇文章最重要的代码：

```cpp
RlcdPort.RLCD_Init();
Lvgl_PortInit(400,300,Lvgl_FlushCallback);
UserApp_UiInit();
UserApp_TaskInit();
```

它把硬件、LVGL 和业务任务按顺序接起来。先有屏幕，再有 LVGL，再创建 UI，最后跑业务任务。

`Lvgl_PortInit()` 做 LVGL 移植准备：

```cpp
lv_init();
lv_disp_draw_buf_init(...);
lv_disp_drv_init(&disp_drv);
disp_drv.flush_cb = flush_cb;
lv_disp_drv_register(&disp_drv);
```

这段的意思是：先初始化 LVGL，再准备绘图缓冲区，然后告诉 LVGL 屏幕分辨率和刷新函数。demo 里还设置了 `disp_drv.full_refresh = 1`，表示按整屏方式刷新，更适合先把流程跑通。

`Lvgl_FlushCallback()` 是 LVGL 到 RLCD 的桥：

```cpp
uint8_t color = (*buffer < 0x7fff) ? ColorBlack : ColorWhite;
RlcdPort.RLCD_SetPixel(x, y, color);
RlcdPort.RLCD_Display();
lv_disp_flush_ready(drv);
```

这段很适合零基础理解：LVGL 给的是颜色值，RLCD 最终要的是黑白像素，所以这里用一个阈值把颜色分成黑和白。

`DisplayPort` 负责真正和屏幕说话：

- 构造函数里初始化 SPI 总线和屏幕 IO。
- `RLCD_Init()` 发送一串屏幕初始化命令。
- `RLCD_SetPixel()` 修改内存里的显示缓存。
- `RLCD_Display()` 把缓存发给屏幕。

生成 UI 在 `setup_scr_screen.c`：

```cpp
ui->screen = lv_obj_create(NULL);
lv_obj_set_size(ui->screen, 400, 300);
ui->screen_img_1 = lv_img_create(ui->screen);
ui->screen_img_2 = lv_img_create(ui->screen);
```

这说明它创建了一个 400x300 的屏幕，并放了两张铺满屏幕的图片。第二张图片一开始被加上 `LV_OBJ_FLAG_HIDDEN`，所以刚启动只看到第一张。

`events_init.c` 目前没有业务事件：

```cpp
void events_init(lv_ui *ui)
{

}
```

这意味着当前 demo 的切图不是靠点击事件触发，而是 `Lvgl_LoopTask()` 定时切换。

## 动手改一改

1. 改切图速度  
   在 `Lvgl_LoopTask()` 里把 `1500` 改成 `500` 或 `3000`，观察图片切换变快或变慢。

2. 改默认显示图片  
   在 `setup_scr_screen.c` 里，`screen_img_2` 初始带有 `LV_OBJ_FLAG_HIDDEN`。你可以反过来隐藏 `screen_img_1`，让第二张图先显示。

3. 替换图片资源  
   图片资源在 `generated/images` 下，文件名里有 `400x300`。替换图片时要注意尺寸和 LVGL 图片格式，否则可能编译失败或显示异常。

4. 加一个点击事件  
   当前 `events_init.c` 是空的。想练习事件，可以给图片对象添加点击回调，例如点击后切换隐藏状态。刚开始不要同时改生成 UI、图片格式和事件逻辑，先只加一个最小事件。

5. 改黑白阈值  
   `Lvgl_FlushCallback()` 里用 `0x7fff` 判断黑白。你可以改成更高或更低的阈值，观察图片黑白分布变化。

## 常见坑

- 屏幕没有变化：先确认 `Lvgl_FlushCallback()` 最后调用了 `lv_disp_flush_ready(drv)`，否则 LVGL 会认为刷新还没结束。
- 图片显示成黑白：这是当前 RLCD 示例的预期结果，flush 回调主动把颜色转成 `ColorBlack` 或 `ColorWhite`。
- 替换图片后编译失败：LVGL 图片资源不是普通 JPG/PNG 直接丢进去就能用，demo 使用的是生成后的 `.c` 图片资源。
- 事件没反应：当前 `events_init.c` 是空的，示例本身没有注册点击业务。图片虽然设置了 `LV_OBJ_FLAG_CLICKABLE`，但没有事件回调就不会执行动作。
- UI 更新线程不安全：demo 提供了 `Lvgl_lock()` 和 `Lvgl_unlock()`。跨任务改 LVGL 对象时，应尽量在锁保护下操作。
- 刷新慢：RLCD 是反射式屏幕，显示特性和普通 TFT 不一样。demo 还使用整屏刷新，适合演示，但不适合追求高帧率动画。

## 和 Pixel Soul 项目的关系

Pixel Soul 如果要在 ESP32-S3-RLCD-4.2 上显示角色表情、状态、提示文字或交互界面，这个 LVGL v8 demo 就是 UI 起点。

它验证了四个关键能力：

- LVGL 能在板子上正常跑。
- RLCD flush 能把 LVGL 画面转成屏幕可显示的黑白像素。
- 图片资源能被编进固件并显示。
- 业务任务能控制 UI 对象状态。

后续做 Pixel Soul 时，可以把这里的“两张图切换”扩展成：

```text
空闲表情 -> 聆听表情 -> 思考表情 -> 说话表情 -> 错误提示
```

也就是说，别急着先做复杂页面。先把角色状态和 UI 状态对应起来，主流程会更清楚。

## 补充阅读

- [LVGL v8 Display porting 文档](https://docs.lvgl.io/8.3/porting/display.html)
- [LVGL v8 Events 文档](https://docs.lvgl.io/8.3/overview/event.html)
- [LVGL v8 Images 文档](https://docs.lvgl.io/8.3/widgets/core/img.html)
- [ESP-IDF v5.5.3 GPIO 文档](https://docs.espressif.com/projects/esp-idf/en/v5.5.3/esp32s3/api-reference/peripherals/gpio.html)
- [ESP-IDF v5.5.3 I2S 文档](https://docs.espressif.com/projects/esp-idf/en/v5.5.3/esp32s3/api-reference/peripherals/i2s.html)
- [Waveshare ESP32-S3-RLCD-4.2 官方资料](https://docs.waveshare.com/ESP32-S3-RLCD-4.2/)
