---
title: ESP32-S3-RLCD I2C SHTC3 温湿度入门
description: 从 0 开始看懂 Waveshare ESP32-S3-RLCD-4.2 Demo 里如何通过 I2C 初始化、唤醒并读取 SHTC3 温湿度传感器。
---

## 一句话目标

把 ESP32-S3-RLCD-4.2 板子上的 SHTC3 当成一个 I2C 外设：先建立 I2C 总线，再添加 SHTC3 设备，最后每 1 秒读取一次温度和湿度并打印到串口日志。

## 先懂概念

I2C 是一种两根线通信总线，常见名字是 `SCL` 和 `SDA`。`SCL` 像节拍器，负责时钟；`SDA` 负责传数据。一个 ESP32-S3 可以作为 master，去访问挂在同一组线上的多个 sensor。

SHTC3 是 Sensirion 的数字温湿度传感器。它不是输出模拟电压，而是通过 I2C 收命令、回数据：先唤醒，再测量，再读出原始温度/湿度值，最后用公式换算成人能看懂的摄氏度和相对湿度。

这个 Demo 使用 ESP-IDF 新 I2C master 驱动，核心 API 是 `i2c_new_master_bus()`、`i2c_master_bus_add_device()`、`i2c_master_transmit_receive()`。

## 硬件/代码入口

事实来源目录：

`D:\Tools\ESP-IDF\ESP32-S3-RLCD-4.2-Demo\ESP32-S3-RLCD-4.2-Demo\02_ESP-IDF\05_I2C_SHTC3`

关键入口：

- `main/main.cpp`：`app_main()` 只调用 `UserApp_AppInit()`。
- `components/user_app/user_app.cpp`：创建 I2C 总线和 SHTC3 对象，并启动读取任务。
- `components/port_bsp/i2c_bsp.cpp`：封装 I2C master bus、读、写、写后读。
- `components/port_bsp/i2c_equipment.cpp`：封装 SHTC3 的唤醒、复位、读 ID、读温湿度。
- `main/user_config.h`：写了板子 I2C 引脚：`ESP32_I2C_SDA_PIN GPIO_NUM_13`、`ESP32_I2C_SCL_PIN GPIO_NUM_14`。

Demo 中实际创建总线的代码是 `I2cMasterBus I2cbus(14,13,0);`，也就是 `SCL=14`、`SDA=13`、`I2C port=0`。

## 运行现象

烧录并打开串口后，程序会先打印：

```text
shtc3-example run
```

初始化 SHTC3 时会读取并打印传感器 ID：

```text
ID:xxxx
```

随后 `Shtc3_LoopTask` 每 1 秒读一次温湿度，日志形态类似：

```text
RH:45.20%,Temp:26.80
```

具体数值会随环境变化。如果传感器没有接好、I2C 地址不对、供电异常或 CRC 校验失败，代码会打印 `Wakeup Failure`、`GetId WRITE Failure`、`GetTempAndHumi READ Failure`、`TempCRC Failure` 等错误信息。

## 核心流程

```text
app_main()
  -> UserApp_AppInit()
  -> new Shtc3Port(I2cbus)
  -> Shtc3_Wakeup()
  -> Shtc3_SoftReset()
  -> Shtc3_GetId()
  -> xTaskCreate(Shtc3_LoopTask)
  -> Shtc3_ReadTempHumi()
  -> 打印 RH / Temp
```

这条主线可以这样理解：先把 I2C 路铺好，再确认 SHTC3 能回应，最后进入循环读取。

## 关键代码讲解

I2C 总线初始化在 `I2cMasterBus::I2cMasterBus()`：

```cpp
i2c_bus_config.scl_io_num = (gpio_num_t)scl_pin;
i2c_bus_config.sda_io_num = (gpio_num_t)sda_pin;
i2c_new_master_bus(&i2c_bus_config, &user_i2c_handle);
```

这段代码告诉 ESP32-S3：用哪两个 GPIO 当 I2C 线，并创建一个 master bus 句柄。后面所有传感器通信都通过这个句柄进行。

SHTC3 设备添加在 `Shtc3Port::Shtc3Port()`：

```cpp
dev_cfg.device_address = Shtc3Address;
dev_cfg.scl_speed_hz = 400000;
i2c_master_bus_add_device(I2cMasterBus, &dev_cfg, &I2c_DevShtc3);
```

这里把 SHTC3 作为一个 7-bit 地址设备挂到 I2C 总线上，通信速度设置为 `400000` Hz。

初始化顺序是：

```cpp
Shtc3_Wakeup();
Shtc3_SoftReset();
Shtc3_GetId();
```

SHTC3 支持低功耗休眠，所以读取前要先唤醒；软复位让传感器回到干净状态；读 ID 用来确认设备能正常响应。

读取温湿度由 `Shtc3_ReadTempHumi()` 调用 `Shtc3_GetTempAndHumiPolling()`。后者先发送测量命令，再延时，再读回 6 个字节：温度 2 字节、温度 CRC 1 字节、湿度 2 字节、湿度 CRC 1 字节。CRC 通过后，才用公式换算：

```cpp
T = -45 + 175 * raw / 65536
RH = 100 * raw / 65536
```

Demo 里温度计算还减去了 `SHTC3_PETP_VOL`，这是项目自己的修正量，写文章或移植时不要忽略。

异常/未找到时要降级处理：当前 Demo 的构造函数用了 `ESP_ERROR_CHECK()` 添加设备，严重错误会让程序中止；读取阶段会返回错误码并打印日志。做 Pixel Soul 这类产品代码时，更建议把 SHTC3 视为可选能力：初始化失败就标记为 `sensor_unavailable`，界面显示 `--`，主流程继续跑，而不是因为没有温湿度传感器导致整个设备不可用。

## 动手改一改

1. 把读取间隔从 1 秒改成 2 秒：在 `Shtc3_LoopTask` 里把 `vTaskDelay(pdMS_TO_TICKS(1000))` 改成 `2000`。
2. 观察温湿度变化：用手靠近传感器几秒，湿度和温度通常会有轻微变化。
3. 做一次降级实验：临时让 SHTC3 不可用，观察串口错误日志，再思考 UI 应该显示错误、空值还是上一次有效值。
4. 打印 ID：保留 `Shtc3_GetId()` 的日志，确认每次启动都能读到稳定 ID。

## 常见坑

- `SCL` 和 `SDA` 接反：I2C 设备不会回应，常见表现是写入失败或读取失败。
- 地址不对：SHTC3 使用固定 I2C 地址，代码里的 `Shtc3Address` 必须和驱动定义一致。
- 忘记唤醒：SHTC3 休眠时直接测量可能失败，所以 Demo 在读取前调用 `Shtc3_Wakeup()`。
- CRC 失败：线太长、接触不良、电源不稳都可能导致数据校验失败。
- 把传感器当成必须项：温湿度不是开机必需能力，产品代码应允许它缺失并降级显示。
- 字符编码显示异常：原始 Demo 里的中文注释和 `Temp` 单位符号在某些编辑器里可能乱码，不影响 I2C 逻辑。

## 和 Pixel Soul 项目的关系

Pixel Soul 如果要显示环境信息，SHTC3 可以作为一个很小但很典型的传感器服务：底层只负责 `init/read/status`，上层决定什么时候显示、是否上传、失败时如何降级。

建议边界是：

```text
SensorService
  -> SHTC3 driver
  -> I2C BSP
  -> ESP-IDF I2C master
```

不要让 UI 每秒直接操作 I2C，也不要让 SHTC3 驱动理解 Pixel Soul 的表情、会话或联网状态。这样以后换成别的温湿度传感器，只需要替换驱动层。

## 补充阅读

- [ESP-IDF v5.5.3 I2C Driver - ESP32-S3](https://docs.espressif.com/projects/esp-idf/en/v5.5.3/esp32s3/api-reference/peripherals/i2c.html)
- [ESP-IDF v5.5.3 I2C API Reference - ESP32-S3](https://docs.espressif.com/projects/esp-idf/en/v5.5.3/esp32s3/api-reference/peripherals/i2c.html#api-reference)
- [Waveshare ESP32-S3-RLCD-4.2 资料页](https://docs.waveshare.com/ESP32-S3-RLCD-4.2/)
- [Sensirion SHTC3 产品页](https://sensirion.com/products/catalog/SHTC3)
- [Sensirion SHTC3 Datasheet](https://sensirion.com/media/documents/643F9C8E/63A5A436/Datasheet_SHTC3.pdf)
