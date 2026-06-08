---
title: ESP32-S3-RLCD ADC 电池采样示例拆解
description: 从 ADC 原始值、曲线拟合校准、电阻分压和电量估算入手，读懂 03_ADC_Test 如何读取电池电压。
---

## 一句话定位

`03_ADC_Test` 演示如何读取板载电池电压：ESP32-S3 通过 `ADC_UNIT_1 / ADC_CHANNEL_3` 采样电池分压点，再通过校准和倍率还原为电池实际电压。

## 基础原理

ADC 是 Analog to Digital Converter，也就是模数转换器。它把模拟电压转换成数字值。ESP32-S3 ADC 读取到的第一手结果叫 `raw`，它不是电压，而是一个和输入电压相关的数字。

从 `raw` 到电池电压需要先做 ADC 校准，再按板级分压倍率还原：

```text
ADC raw
  -> ADC 曲线拟合校准
  -> ADC 引脚电压 mV
  -> 按电阻分压倍率还原
  -> 电池实际电压
```

ESP32-S3 ADC 校准里常见的曲线拟合方案可以理解成“两级修正”：

```text
raw
  -> 用 eFuse 里的出厂标定点拟合 raw -> mV 的线性关系
  -> 得到 v_cali_1
  -> 用 ESP32-S3 ADC 曲线拟合误差模型计算 error(v_cali_1)
  -> voltage = v_cali_1 - error
```

这里的 `error` 不是固定常数偏置，而是一个随输入电压变化的误差函数。`K0` 项可以类比固定偏移，`K1 * X` 类似斜率相关误差，`K2 * X^2`、`K3 * X^3` 等高阶项用于修正 ADC 非线性。

电池电压通常高于 ADC 引脚适合直接测量的电压范围，所以开发板会使用电阻分压。这个 demo 中代码使用 `* 3` 还原电池电压，含义是 ADC 引脚看到的电压约为电池电压的三分之一。

电量百分比不是 ADC 直接测出来的，而是 demo 用线性公式粗略估算：

```text
3.0V 以下  -> 0%
4.12V 以上 -> 100%
中间       -> 按线性比例换算
```

这适合示例学习，不等同于真实锂电池电量曲线。

## 硬件与工程入口

源码阅读入口：

```text
02_ESP-IDF/03_ADC_Test/main/main.cpp
02_ESP-IDF/03_ADC_Test/components/user_app/user_app.cpp
02_ESP-IDF/03_ADC_Test/components/port_bsp/adc_bsp.cpp
02_ESP-IDF/03_ADC_Test/components/port_bsp/adc_bsp.h
```

关键硬件配置：

| 项目 | 配置 |
| --- | --- |
| ADC unit | `ADC_UNIT_1` |
| ADC channel | `ADC_CHANNEL_3` |
| 对应 GPIO | GPIO4 |
| 位宽 | `ADC_BITWIDTH_12` |
| 衰减 | `ADC_ATTEN_DB_12` |
| 校准方案 | `ADC_CALI_SCHEME_VER_CURVE_FITTING` / `adc_cali_create_scheme_curve_fitting()` |
| 分压还原 | `battery_v = adc_mv * 0.001 * 3` |

## 关键流程总图

```text
app_main()
  -> UserApp_AppInit()
      -> Adc_PortInit()
          -> adc_cali_create_scheme_curve_fitting()
          -> adc_oneshot_new_unit()
          -> adc_oneshot_config_channel(ADC_CHANNEL_3)
      -> xTaskCreate(Adc_LoopTask)

Adc_LoopTask()
  -> Adc_GetBatteryVoltage()
      -> adc_oneshot_read()
      -> adc_cali_raw_to_voltage()
      -> mV 转 V
      -> 乘以 3 还原电池电压
  -> 每 1000ms 打印一次
```

## 关键方法速查

| 函数/方法 | 所在文件 | 作用 | 初学者需要理解的点 |
| --- | --- | --- | --- |
| `app_main()` | `main/main.cpp` | ESP-IDF 应用入口。 | 只调用应用初始化，主逻辑不在这里。 |
| `UserApp_AppInit()` | `components/user_app/user_app.cpp` | 初始化 ADC 并创建采样任务。 | demo 行为层负责“多久读一次”。 |
| `Adc_LoopTask()` | `components/user_app/user_app.cpp` | 周期读取 ADC 并打印。 | ADC 不是自动上报，任务定时主动读。 |
| `Adc_PortInit()` | `components/port_bsp/adc_bsp.cpp` | 初始化 ADC 校准、unit、channel。 | 板级硬件配置集中在 BSP。 |
| `adc_cali_create_scheme_curve_fitting()` | ESP-IDF ADC 校准 API | 创建曲线拟合校准句柄。 | 它会按 ADC unit 和 attenuation 准备 eFuse 标定与误差模型。 |
| `adc_oneshot_new_unit()` | ESP-IDF ADC oneshot API | 创建一次性采样 ADC unit。 | 低频电池采样适合 oneshot。 |
| `adc_oneshot_config_channel()` | ESP-IDF ADC oneshot API | 配置 channel、位宽和衰减。 | `ADC_ATTEN_DB_12` 扩大可测输入范围。 |
| `adc_cali_raw_to_voltage()` | ESP-IDF ADC 校准 API | 把 raw 转成校准后的 ADC 引脚电压。 | 内部先线性标定，再用非线性误差多项式修正。 |
| `Adc_GetBatteryVoltage()` | `components/port_bsp/adc_bsp.cpp` | 读取 raw 并换算电池电压。 | 这里串起 raw、校准、分压倍率。 |
| `Adc_GetBatteryLevel()` | `components/port_bsp/adc_bsp.cpp` | 把电压粗略映射成百分比。 | 示例中主循环未调用它，但 FactoryProgram 会用类似逻辑。 |

## 关键代码讲解

初始化时，demo 先创建 ADC 校准句柄：

```cpp
adc_cali_create_scheme_curve_fitting(...);
```

校准的作用是减少芯片 ADC 误差。没有校准时，`raw` 只能大致反映输入变化；有校准后，`adc_cali_raw_to_voltage()` 可以得到单位为 mV 的引脚电压。

ESP32-S3 的曲线拟合校准不是简单地给所有读数加一个固定偏移，而是更接近下面的两级过程。

第一步是线性标定。ESP-IDF 会从 eFuse 中读取芯片出厂时写入的标定点，也就是某个真实电压 `voltage` 对应的 ADC 数字输出 `digi`，然后建立第一阶段的线性关系：

```text
coeff_a = 65536 * voltage / digi
coeff_b = 0
v_cali_1 = raw * coeff_a / 65536 + coeff_b
```

这一步解决的是“这颗芯片的 ADC 参考电压和理想值不完全一致”的问题。官方文档说明，ADC 设计参考电压为 `1100 mV`，但不同芯片真实参考电压可能落在 `1000 mV ~ 1200 mV`，所以需要用出厂标定信息降低这类偏差。

第二步是非线性误差修正。ESP-IDF 会按 `ADC unit + attenuation` 选择 ESP32-S3 预置的曲线拟合误差模型，并根据第一步得到的 `v_cali_1` 计算读数误差：

```text
error = K0 * X^0 + K1 * X^1 + K2 * X^2 + K3 * X^3 + ... + Kn * X^n
X = v_cali_1
voltage = v_cali_1 - error
```

源码中 `get_reading_error()` 实际做的就是这件事。ESP32-S3 的系数表还会按 ADC1/ADC2 和 attenuation 选择不同系数与符号；atten0 到 atten2 使用 3 项误差模型，atten3 使用 5 项误差模型。因此可以把 `error` 理解成“电压相关的 residual error correction”，而不是单一固定偏置。

接着创建 oneshot unit：

```cpp
adc_oneshot_new_unit(...);
adc_oneshot_config_channel(...);
```

`oneshot` 的意思是需要时读一次。电池电压变化很慢，不需要高速连续采样，所以 oneshot 比连续采样更直观。

读取链路在 `Adc_GetBatteryVoltage()`：

```cpp
adc_oneshot_read(...);
adc_cali_raw_to_voltage(...);
vol = 0.001 * tage * 3;
```

这行换算可以拆开理解：

```text
tage        -> 校准后的 ADC 引脚电压，单位 mV
0.001       -> mV 转 V
* 3         -> 按板载分压倍率还原为电池电压
```

百分比估算使用线性区间：

```text
percent = (voltage - 3.0) / (4.12 - 3.0) * 100
```

这只是显示层的粗略估计。真实产品中建议对电压做滑动平均或 EMA，并根据电池放电曲线调整百分比映射。

## 实验现象

运行后，串口会先打印：

```text
adc-example run
```

随后每秒打印一次类似：

```text
Adc Value:1234,Batt Voltage:3.700000
```

`Adc Value` 是原始 ADC 数字值，`Batt Voltage` 是换算后的电池电压，单位是 V。

## 常见问题

| 现象 | 可能原因 | 排查方式 |
| --- | --- | --- |
| 把 raw 当电压 | `raw` 只是 ADC 原始数字。 | 必须经过 `adc_cali_raw_to_voltage()`。 |
| 电压只有真实电池的三分之一 | 读到的是分压点电压。 | 需要按电阻分压倍率还原，本 demo 是 `* 3`。 |
| 电量百分比跳动 | ADC 采样和电池负载都会波动。 | 后续可加多次平均或 EMA。 |
| 百分比不准 | 锂电池电压曲线非线性。 | demo 公式只适合粗略显示。 |
| 想判断正在充电 | 当前 ADC demo 没有充电状态读取。 | 需要额外的 CHG/STAT GPIO、PMIC 或充电 IC 信息。 |

## 工程迁移思路

迁移到产品时，建议把电池能力拆成两层：

```text
PowerService
  -> 读取 ADC raw
  -> 校准为电压
  -> 分压还原
  -> 输出 snapshot: voltage_mv / percent / valid

AppModel/UI
  -> 根据 percent 显示电池图标
  -> 当前不显示充电图标
  -> 如果未来接入 CHG/STAT GPIO，再增加充电状态投影
  -> 根据低电阈值给出提示
```

底层服务只负责事实采集，不直接决定 UI 显示几格电。当前 PowerService v1 只提供 `valid / voltage_mv / percent`，充电状态不靠电压趋势猜测；如果未来需要显示充电图标，最好来自硬件状态脚或电源管理芯片。

## 补充阅读

- [ESP-IDF ADC Oneshot Mode Driver](https://docs.espressif.com/projects/esp-idf/zh_CN/v5.5.3/esp32s3/api-reference/peripherals/adc_oneshot.html)
- [ESP-IDF ADC Calibration Driver](https://docs.espressif.com/projects/esp-idf/zh_CN/v5.5.3/esp32s3/api-reference/peripherals/adc_calibration.html)
- [ESP-IDF v6.0.1 ESP32-S3 ADC Calibration Driver](https://docs.espressif.com/projects/esp-idf/zh_CN/v6.0.1/esp32s3/api-reference/peripherals/adc/adc_calibration.html)
- [ESP-IDF v6.0.1 `adc_cali_curve_fitting.c`](https://github.com/espressif/esp-idf/blob/v6.0.1/components/esp_adc/adc_cali_curve_fitting.c)
- [ESP-IDF v6.0.1 ESP32-S3 curve fitting coefficients](https://github.com/espressif/esp-idf/blob/v6.0.1/components/esp_adc/esp32s3/curve_fitting_coefficients.c)
- [Waveshare ESP32-S3-RLCD-4.2 资料页](https://docs.waveshare.com/ESP32-S3-RLCD-4.2)
