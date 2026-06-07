---
title: ESP32-S3-RLCD-4.2 LVGL v9 示例零基础教程
description: 从 09_LVGL_V9_Test 工程理解 LVGL v9 如何把生成的 UI 画到 ESP32-S3-RLCD-4.2 反射式屏幕上。
---

## 一句话目标

看懂 `09_LVGL_V9_Test`：ESP32-S3 初始化 RLCD 屏幕，启动 LVGL v9，把生成的 UI 画出来，并每 1.5 秒切换两张图片。

## 先懂概念

这个例子里有三层东西：

- `RLCD` 是实际屏幕。它不是常见的 RGB LCD 刷整块彩色显存，而是通过 `DisplayPort` 把像素整理成屏幕控制器需要的黑白数据，再用 SPI 发出去。
- `LVGL` 是 UI 引擎。你创建按钮、图片、标签，LVGL 负责算出哪些像素该显示什么颜色。
- `flush callback` 是两者之间的桥。LVGL 算好一块区域后，会调用你注册的刷新函数；你的刷新函数再把颜色转成 RLCD 能显示的数据。

如果你用过 LVGL v8，再看 v9 要注意理解方式的变化：v8 示例常围绕 `lv_disp_drv_t`、`lv_disp_draw_buf_t`、`lv_disp_drv_register()` 展开；v9 更强调 `lv_display_t` 这个显示对象，常见入口变成 `lv_display_create()`、`lv_display_set_flush_cb()`、`lv_display_set_buffers()`。所以读 v9 代码时，先找 display 对象，而不是先找旧版 driver 结构体。

## 硬件/代码入口

硬件入口在 `main/main.cpp`：

```cpp
DisplayPort RlcdPort(12, 11, 5, 40, 41, LCD_WIDTH, LCD_HEIGHT);
```

这行把 RLCD 用到的 SPI 和控制引脚交给 `DisplayPort`。从构造函数可以看到，它会初始化 SPI bus、创建 `esp_lcd_panel_io_spi`，并准备屏幕缓冲区。

代码主入口是 `app_main()`：

```cpp
UserApp_AppInit();
RlcdPort.RLCD_Init();
Lvgl_PortInit(400, 300, Lvgl_FlushCallback);
UserApp_UiInit();
UserApp_TaskInit();
```

项目结构可以先看这几个位置：

- `main/main.cpp`：系统启动主线。
- `components/port_bsp/display_bsp.cpp`：RLCD 初始化、写像素、整屏发送。
- `components/app_bsp/lvgl_bsp.cpp`：LVGL v9 初始化、tick 定时器、LVGL 任务。
- `components/user_app/user_app.cpp`：加载 UI，并循环切换图片。
- `components/ui_bsp/generated/`：由 UI 工具生成的界面代码。
- `components/ui_bsp/generated/images/`：生成的图片资源。

## 运行现象

程序启动后，RLCD 被清成白底，然后 LVGL 加载生成界面。`Lvgl_LoopTask` 会让 `screen_img_1` 和 `screen_img_2` 轮流显示：

```cpp
lv_obj_clear_flag(init_ui.screen_img_1, LV_OBJ_FLAG_HIDDEN);
lv_obj_add_flag(init_ui.screen_img_2, LV_OBJ_FLAG_HIDDEN);
```

每次切换后延时 1500 ms，所以你会看到屏幕上的两张图片交替出现。

## 核心流程

这篇先抓业务主干，不钻进每个寄存器：

1. 创建 `RlcdPort`，保存屏幕引脚、分辨率和 SPI 配置。
2. `UserApp_AppInit()` 预留应用初始化。
3. `RlcdPort.RLCD_Init()` 复位并配置 RLCD 控制器。
4. `Lvgl_PortInit(400, 300, Lvgl_FlushCallback)` 初始化 LVGL v9 显示对象、双缓冲和 tick。
5. `UserApp_UiInit()` 调用 `setup_ui(&init_ui)` 加载 generated UI。
6. `UserApp_TaskInit()` 创建任务，轮流隐藏/显示两张图片。
7. LVGL 定时调用 `lv_timer_handler()`，需要刷新时进入 `Lvgl_FlushCallback()`。
8. flush callback 把 LVGL 的 RGB565 像素转成黑/白像素，写入 RLCD 缓冲区，再 `RLCD_Display()` 发到屏幕。

## 关键代码讲解

`Lvgl_PortInit()` 是 LVGL v9 的关键入口：

```cpp
lv_display_t *disp = lv_display_create(width, height);
lv_display_set_flush_cb(disp, flush_cb);
lv_display_set_buffers(disp, buffer_1, buffer_2, buffer_size, LV_DISPLAY_RENDER_MODE_FULL);
```

这三行告诉 LVGL：屏幕大小是 `400 x 300`，刷新时调用 `flush_cb`，绘图缓冲区使用 PSRAM 里的双缓冲。示例使用 `LV_DISPLAY_RENDER_MODE_FULL`，意思是按完整显示区域渲染，初学时比局部复杂优化更容易理解。

LVGL 本身需要时间基准，所以工程创建了一个 `esp_timer`，周期性执行：

```cpp
lv_tick_inc(LVGL_TICK_PERIOD_MS);
```

同时还创建 `Lvgl_port_task`，循环调用：

```cpp
task_delay_ms = lv_timer_handler();
```

你可以把 `lv_timer_handler()` 理解成 LVGL 的心跳：处理动画、定时器、对象状态变化，并在需要时触发刷新。

最值得细看的桥接代码是 `Lvgl_FlushCallback()`：

```cpp
uint8_t color = (*buffer < 0x7fff) ? ColorBlack : ColorWhite;
RlcdPort.RLCD_SetPixel(x, y, color);
```

LVGL 给的是 RGB565 颜色，RLCD 示例最终只显示黑白，所以这里用一个阈值把颜色压成黑或白。遍历完 LVGL 要刷新的区域后，调用：

```cpp
RlcdPort.RLCD_Display();
lv_disp_flush_ready(drv);
```

第一句把 RLCD 缓冲区发出去，第二句告诉 LVGL“这次刷新完成了”。如果忘了 `lv_disp_flush_ready()`，LVGL 会以为显示还在忙，后续刷新可能卡住。

生成 UI 在 `components/ui_bsp/generated/`。这里的 `setup_ui()`、`setup_scr_screen()`、`screen_img_1`、`screen_img_2` 都是生成代码里的对象。初学者不要一开始就手改 generated 文件，先在 `user_app.cpp` 里调用这些对象做小实验。

图片文件名里有 `RGB565A8`，例如 `_2_RGB565A8_400x300.c`。这表示图片数据面向 LVGL 的 RGB565 颜色格式，并带 8-bit alpha 信息。RGB565 用 16 bit 存一个像素颜色，适合嵌入式屏幕；A8 是透明度通道。即使最后 RLCD 示例把颜色压成黑白，图片在 LVGL 层仍按这种资源格式被声明和使用。

## 动手改一改

最安全的第一个实验：改图片切换速度。

在 `components/user_app/user_app.cpp` 找到两处：

```cpp
vTaskDelay(pdMS_TO_TICKS(1500));
```

把 `1500` 改成 `500`，图片会更快切换；改成 `3000`，图片会更慢切换。

第二个实验：只显示其中一张图。保留 `screen_img_1` 的 clear flag，把 `screen_img_2` 一直 hidden。这样你能确认 UI 对象的隐藏/显示是怎么控制画面的。

第三个实验：调整黑白阈值。`0x7fff` 越大，更多颜色会被判成黑；越小，更多颜色会被判成白。这个实验能帮助你理解彩色 UI 到黑白 RLCD 的转换损失。

## 常见坑

- 看 LVGL v9 文档时别照搬 v8 初始化代码。这个工程的主线是 `lv_display_create()`，不是旧版 `lv_disp_drv_register()`。
- flush callback 里必须调用 `lv_disp_flush_ready()`。这是 LVGL 刷新协议的一部分。
- UI 对象操作要加锁。工程在初始化 UI 时使用 `Lvgl_lock(-1)` 和 `Lvgl_unlock()`，避免 LVGL 任务同时操作对象。
- 图片资源大，缓冲区放在 PSRAM。`heap_caps_malloc(..., MALLOC_CAP_SPIRAM)` 失败时通常和 PSRAM 配置、内存大小有关。
- RLCD 是黑白显示效果，不要期待 RGB565 图片按彩色显示。示例代码明确把颜色压成 `ColorBlack` 或 `ColorWhite`。
- generated UI 可以读，但不建议作为初学者的主要修改入口。先改 `user_app.cpp`，更容易回退和理解。

## 和 Pixel Soul 项目的关系

Pixel Soul 如果要在小屏幕上显示表情、状态、动画或菜单，也会遇到同一个主问题：上层 UI 负责“要显示什么”，底层屏幕驱动负责“怎么把像素送到硬件”。这个 LVGL v9 示例正好展示了这条边界。

你可以把它当成 Pixel Soul 显示链路的最小模型：

- Pixel Soul 的状态机决定当前表情或页面。
- LVGL 或其它 UI 层把状态变成图片、文字、控件。
- display flush 把 UI 像素转成目标屏幕格式。
- RLCD 驱动只负责初始化、写像素、发送缓冲区。

这样分层后，后续即使从 RLCD 换成别的屏，也尽量只改显示适配层，不要把业务状态散落到屏幕驱动里。

## 补充阅读

- [LVGL v9 官方文档](https://docs.lvgl.io/9.4/)
- [LVGL v9 Display /刷新机制](https://docs.lvgl.io/9.4/porting/display.html)
- [Espressif esp_lvgl_port 组件](https://components.espressif.com/components/espressif/esp_lvgl_port)
- [ESP-IDF v5.5.3 LCD 文档](https://docs.espressif.com/projects/esp-idf/zh_CN/v5.5.3/esp32s3/api-reference/peripherals/lcd/index.html)
- [Waveshare ESP32-S3-RLCD-4.2 资料](https://docs.waveshare.com/ESP32-S3-RLCD-4.2/)
