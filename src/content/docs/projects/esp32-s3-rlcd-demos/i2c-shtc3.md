---
title: ESP32-S3-RLCD I2C SHTC3 示例拆解
description: 从 I2C 传感器、SHTC3 唤醒、测量命令、CRC 校验和温湿度换算入手，读懂 05_I2C_SHTC3。
---

## 一句话定位

`05_I2C_SHTC3` 演示通过 I2C 读取 SHTC3 温湿度传感器：初始化 I2C 总线和设备地址后，每秒唤醒传感器、触发测量、读取 6 字节数据并换算温湿度。

## 基础原理

SHTC3 是温湿度传感器，使用 I2C 通信。和 RTC 不同，传感器通常不是一直输出数据，而是遵循命令流程：

```text
唤醒传感器
  -> 发送测量命令
  -> 等待测量完成
  -> 读取温度/湿度原始数据
  -> CRC 校验
  -> 换算成摄氏度和相对湿度
  -> 可选进入睡眠
```

CRC 校验很重要。I2C 读出的数据如果受干扰，CRC 不通过就不应该拿去显示或参与业务判断。

## 硬件与工程入口

源码阅读入口：

```text
02_ESP-IDF/05_I2C_SHTC3/main/main.cpp
02_ESP-IDF/05_I2C_SHTC3/components/user_app/user_app.cpp
02_ESP-IDF/05_I2C_SHTC3/components/port_bsp/i2c_bsp.cpp
02_ESP-IDF/05_I2C_SHTC3/components/port_bsp/i2c_equipment.cpp
```

关键硬件配置：

| 项目 | 配置 |
| --- | --- |
| I2C port | `I2C_NUM_0` |
| SCL | GPIO14 |
| SDA | GPIO13 |
| SHTC3 地址 | `0x70` |
| 设备访问速率 | `400000 Hz` |
| 唤醒命令 | `0x3517` |
| 软复位命令 | `0x805D` |
| 读 ID 命令 | `0xEFC8` |
| 测量命令 | `0x7866` |
| 睡眠命令 | `0xB098` |

## 关键流程总图

```text
全局构造 I2cMasterBus(14, 13, 0)
  -> i2c_new_master_bus()

app_main()
  -> UserApp_AppInit()
      -> new Shtc3Port(I2cbus)
          -> i2c_master_bus_add_device(0x70)
          -> Shtc3_Wakeup()
          -> Shtc3_SoftReset()
          -> Shtc3_GetId()
      -> xTaskCreate(Shtc3_LoopTask)

Shtc3_LoopTask()
  -> Shtc3_ReadTempHumi()
      -> Shtc3_Wakeup()
      -> Shtc3_GetTempAndHumiPolling()
          -> i2c_write_buff(MEAS_T_RH_POLLING)
          -> i2c_read_buff(6 bytes)
          -> Shtc3_CheckCrc()
          -> Shtc3_CalcTemperature()
          -> Shtc3_CalcHumidity()
  -> 每 1000ms 打印一次
```

## 关键方法速查

| 函数/方法 | 所在文件 | 作用 | 初学者需要理解的点 |
| --- | --- | --- | --- |
| `I2cMasterBus` | `components/port_bsp/i2c_bsp.cpp` | 封装 I2C master bus。 | SHTC3 和其他 I2C 设备可以共享总线。 |
| `UserApp_AppInit()` | `components/user_app/user_app.cpp` | 创建 SHTC3 对象并创建读取任务。 | 业务层只关心“周期读温湿度”。 |
| `Shtc3Port` | `components/port_bsp/i2c_equipment.cpp` | 添加 I2C 设备并初始化传感器。 | 这是 SHTC3 的板级封装。 |
| `Shtc3_Wakeup()` | `components/port_bsp/i2c_equipment.cpp` | 唤醒传感器。 | 低功耗传感器读数前常要唤醒。 |
| `Shtc3_SoftReset()` | `components/port_bsp/i2c_equipment.cpp` | 软复位传感器。 | 初始化时清理设备内部状态。 |
| `Shtc3_GetId()` | `components/port_bsp/i2c_equipment.cpp` | 读取传感器 ID。 | 用于确认 I2C 设备可访问。 |
| `Shtc3_ReadTempHumi()` | `components/port_bsp/i2c_equipment.cpp` | 读取温湿度业务入口。 | 上层只需要调用这个函数。 |
| `Shtc3_GetTempAndHumiPolling()` | `components/port_bsp/i2c_equipment.cpp` | 发送测量命令并轮询读取数据。 | 这里是实际测量流程。 |
| `Shtc3_CheckCrc()` | `components/port_bsp/i2c_equipment.cpp` | 校验返回数据。 | 传感器数据不能跳过校验。 |

## 关键代码讲解

总线创建方式和 RTC demo 一致：

```cpp
I2cMasterBus I2cbus(14, 13, 0);
```

创建传感器对象时，构造函数会把 `0x70` 地址设备加入 I2C bus，并执行唤醒、软复位和读 ID：

```text
new Shtc3Port(I2cbus)
  -> add device 0x70
  -> wakeup
  -> soft reset
  -> read id
```

周期读取时，主函数不是直接操作寄存器，而是调用：

```cpp
Shtc3_ReadTempHumi(&temperature, &humidity);
```

内部再完成命令和转换。读取 6 字节数据通常包含：

```text
temperature raw high/low + temperature CRC
humidity raw high/low    + humidity CRC
```

CRC 通过后，才换算成工程里使用的温度和湿度值。

## 实验现象

运行后，串口每秒打印温度和湿度。用手靠近传感器或轻微呼气，湿度读数通常会有变化。

如果 I2C 设备初始化失败，示例可能直接中止。产品代码更建议把温湿度传感器当作可选硬件：初始化失败时显示 `--`，而不是让整个系统不可用。

## 常见问题

| 现象 | 可能原因 | 排查方式 |
| --- | --- | --- |
| 读不到数据 | I2C 地址、SCL/SDA、供电或传感器缺失。 | 确认地址 `0x70`、SCL GPIO14、SDA GPIO13。 |
| 数据偶发异常 | I2C 干扰或传感器未准备好。 | 保留 CRC 校验，不显示失败数据。 |
| 读数变化慢 | 温湿度传感器响应受环境和外壳影响。 | 不要期待像按键一样瞬时变化。 |
| 初始化失败导致程序停 | demo 使用 `ESP_ERROR_CHECK()`。 | 产品代码应降级处理。 |
| 和 RTC 共用 I2C 担心冲突 | I2C 支持一主多从。 | 只要地址不同且总线时序可靠即可。 |

## 工程迁移思路

温湿度能力适合封装成传感器服务：

```text
SensorService
  -> 初始化 SHTC3
  -> 周期采样
  -> CRC 校验
  -> 更新 snapshot: temperature / humidity / valid
  -> 初始化失败时标记 unavailable
```

UI 或业务层只读取 snapshot，不直接操作 I2C。这样可以避免 UI 每秒占用总线，也便于以后替换传感器型号。

## 补充阅读

- [ESP-IDF I2C Driver](https://docs.espressif.com/projects/esp-idf/zh_CN/v5.5.3/esp32s3/api-reference/peripherals/i2c.html)
- [Waveshare ESP32-S3-RLCD-4.2 资料页](https://docs.waveshare.com/ESP32-S3-RLCD-4.2)
