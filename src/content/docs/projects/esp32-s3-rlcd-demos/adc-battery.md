---
title: "ESP32-S3-RLCD-4.2：用 ADC 读取电池电压"
description: "面向零基础初学者，理解 Waveshare ESP32-S3-RLCD-4.2 官方 ADC demo 如何把 ADC 原始值换算成电池电压和电量百分比。"
---

## 一句话目标

跑通 `03_ADC_Test`，看懂它如何每秒读取一次电池 ADC，并把 `raw -> calibration mV -> divider ratio -> battery voltage -> percent` 串起来。

## 先懂概念

ADC 是 Analog to Digital Converter，中文常叫“模数转换器”。它做的事情很朴素：把一个模拟电压变成一个数字。

ESP32-S3 的 ADC 直接读到的是 `raw` 原始值。`raw` 不是电压，只是 ADC 的数字结果，所以 demo 接着做校准，把 `raw` 转成芯片引脚上看到的毫伏值，也就是 calibration mV。

电池电压通常比 ESP32-S3 ADC 引脚能承受的电压高，开发板会用电阻分压把电池电压缩小后送进 ADC。这个 demo 里用 `* 3` 还原电池电压，意思是：ADC 引脚看到的电压约等于电池电压的三分之一。

最后，demo 用一个简单线性公式把电池电压换成百分比：低于 `3.0V` 当作 `0%`，高于 `4.12V` 当作 `100%`，中间按比例换算。

## 硬件/代码入口

事实来源目录：

`D:\Tools\ESP-IDF\ESP32-S3-RLCD-4.2-Demo\ESP32-S3-RLCD-4.2-Demo\02_ESP-IDF\03_ADC_Test`

你最该看的 3 个入口：

- `main/main.cpp`：`app_main()` 只调用 `UserApp_AppInit()`。
- `components/user_app/user_app.cpp`：初始化 ADC，并创建循环任务。
- `components/port_bsp/adc_bsp.cpp`：真正配置 ADC、读取 raw、换算电压和百分比。

demo 使用的是 `ADC_UNIT_1`、`ADC_CHANNEL_3`，配置为 `ADC_BITWIDTH_12` 和 `ADC_ATTEN_DB_12`。

## 运行现象

烧录运行后，串口先打印：

```text
adc-example run
```

之后每秒打印一次类似内容：

```text
Adc Value:1234,Batt Voltage:3.700000
```

`Adc Value` 是 ADC 原始值，`Batt Voltage` 是 demo 换算后的电池电压，单位是 V。

## 核心流程

核心流程可以直接读成一句话：

```text
app_main -> UserApp_AppInit -> Adc_PortInit -> Adc_LoopTask -> Adc_GetBatteryVoltage
```

更细一点：

1. `UserApp_AppInit()` 打印启动信息。
2. `Adc_PortInit()` 建立 ADC 校准句柄和 oneshot 读取句柄。
3. `Adc_PortInit()` 配置 `ADC_CHANNEL_3`。
4. `Adc_LoopTask()` 每秒调用 `Adc_GetBatteryVoltage(&data)`。
5. `Adc_GetBatteryVoltage()` 读取 raw，校准成 mV，再乘以分压倍率 `3` 得到电池电压。
6. 如果需要百分比，`Adc_GetBatteryLevel()` 再把电压映射到 `0~100`。

## 关键代码讲解

先看初始化。demo 在 `Adc_PortInit()` 里创建校准方案：

```cpp
adc_cali_create_scheme_curve_fitting(...)
```

这一步的作用是准备“raw 转 mV”的校准工具。没有这一步，你只能拿到 ADC 原始数字，很难直接当成真实电压使用。

然后创建 oneshot ADC：

```cpp
adc_oneshot_new_unit(...)
adc_oneshot_config_channel(...)
```

oneshot 的意思是“需要的时候读一次”。这个 demo 每秒读一次电池，不需要连续高速采样，所以 oneshot 很合适。

读取时，demo 先拿 raw：

```cpp
adc_oneshot_read(...)
```

再把 raw 转成引脚电压的 mV：

```cpp
adc_cali_raw_to_voltage(...)
```

最后是最关键的换算链路：

```cpp
vol = 0.001 * tage * 3;
```

这里 `tage` 是校准后的 mV。`0.001` 把 mV 变成 V，`* 3` 是把 ADC 引脚上的分压电压还原成电池电压。

百分比在 `Adc_GetBatteryLevel()` 里：

```text
< 3.0V  -> 0%
> 4.12V -> 100%
中间    -> (vol - 3.0) / 1.12 * 100
```

注意：这个官方 demo 只读取电池电压和估算电量百分比，没有读取充电状态。也就是说，它不能告诉你“正在充电 / 已充满 / 未充电”，只能根据电压推测大概电量。

## 动手改一改

先做最小改动，适合零基础练手：

1. 把 `Adc_LoopTask()` 里的延时从 `1000ms` 改成 `2000ms`，观察串口是不是 2 秒打印一次。
2. 在日志里加上 `Adc_GetBatteryLevel()` 的结果，显示电量百分比。
3. 修改 `3.0` 和 `4.12` 两个阈值，观察百分比变化，但不要把它当成真实电池曲线。

建议一次只改一个地方。能跑起来、能解释现象，比一次改很多更重要。

## 常见坑

- 把 `raw` 当成电压：`raw` 只是原始数字，必须经过校准和换算。
- 忘记分压倍率：校准得到的是 ADC 引脚电压，不一定等于电池电压；这个 demo 用 `* 3` 还原。
- 认为百分比很精确：demo 的百分比是线性估算，真实锂电池放电曲线不是直线。
- 误以为能判断充电状态：demo 没有充电 IC 状态脚或寄存器读取逻辑。
- 采样跳动就以为坏了：ADC 数值轻微波动很常见，可以后续做平均滤波。

## 和 Pixel Soul 项目的关系

Pixel Soul 如果要显示电池图标，第一步不是做漂亮 UI，而是先拿到稳定的电池电压。

这个 demo 可以作为 Pixel Soul 电池模块的最小事实来源：它说明了板子上电池电压从哪里读、如何从 raw 变成 V、如何估算百分比。但 Pixel Soul 真正使用时，建议把“读取电压”和“估算 UI 电量”分开：底层只负责读电压，上层再决定显示几格电、什么时候提示低电量。

如果以后要显示充电状态，需要另找硬件依据，例如充电芯片状态引脚、PMIC 寄存器或板级原理图。不要从这个 ADC demo 里推断充电状态。

## 补充阅读

- [ESP-IDF v5.5.3：ADC Oneshot Mode Driver](https://docs.espressif.com/projects/esp-idf/en/v5.5.3/esp32s3/api-reference/peripherals/adc_oneshot.html)
- [ESP-IDF v5.5.3：ADC Calibration Driver](https://docs.espressif.com/projects/esp-idf/en/v5.5.3/esp32s3/api-reference/peripherals/adc_calibration.html)
- [Waveshare ESP32-S3-RLCD-4.2 资料页](https://docs.waveshare.com/ESP32-S3-RLCD-4.2/)
