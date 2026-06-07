---
title: Pixel Soul PowerService 复习笔记（设计草案/待实现）
description: 复习 PowerService 的设计草案、ADC 电池采样、充电状态 GPIO、snapshot 边界和后续实现注意点。
---

> 当前 PowerService 是设计草案/待实现：ESP32 service public include 目录中尚未存在对应头文件，也没有已落地的 PowerService 代码。本文只能作为后续实现和面试表达的设计笔记，不能当作已完成模块说明。

## 一句话定位

PowerService 计划把电池 ADC 采样和可选充电状态 GPIO 封装成“电源观测 Service”，给 AppModel/UI 提供稳定的电压、电量百分比和充电状态 snapshot。

## 基础原理

电池电压不能直接等同于 ADC 原始值。板卡通常会通过分压电阻把电池电压降到 ADC 可测范围，ADC 读到的是分压后的电压；Service 需要用校准后的 ADC mV 乘以分压比例，换算回电池实际电压。

当前草案以官方 ADC demo 为硬件基线：

```text
ADC_UNIT_1
ADC_CHANNEL_3
ADC_ATTEN_DB_12
ADC_BITWIDTH_12
adc_cali_create_scheme_curve_fitting()
adc_oneshot_read()
adc_cali_raw_to_voltage()
voltage = calibrated_adc_mv * 3
```

电量百分比 v1 计划使用线性映射：

```text
3000mV -> 0%
4120mV -> 100%
```

充电状态不靠“电压是否上升”推断，而是优先使用充电芯片 `CHG/STAT` GPIO。如果该 GPIO 未确认或未配置，则 `charge_valid=false`，UI 不显示充电图标。

## 主流程

设计主流程应保持短而清楚：

```text
Init ADC/GPIO
  -> Sample Battery
  -> Read Charge GPIO
  -> Update Snapshot
  -> Notify App if changed
```

建议运行方式：

```text
Init
  -> 初始化 ADC oneshot 和 ADC calibration
  -> 如果配置了 CHG GPIO，则初始化 GPIO 输入
  -> 初始化 power_snapshot_t 默认值

Start
  -> 创建周期采样 task 或 timer

Sample Loop
  -> 每 SERVICE_POWER_SAMPLE_INTERVAL_MS 采样一次
  -> raw ADC 转 calibrated mV
  -> multiplied by divider ratio 得到 voltage_mv
  -> voltage_mv 映射到 percent
  -> 读取 charging 状态
  -> snapshot 有变化时通知 AppCore/AppModel
```

上层数据流：

```text
PowerService snapshot
  -> AppModel status model
  -> UI status bar
  -> battery icon / charge icon
```

## 为什么这样设计

第一，PowerService 只做电源观测，不做电源策略。低电量关机、休眠、动态降频属于 PowerPolicy 或产品策略，不应塞进 v1。

第二，电量是慢变量，不需要高频采样。草案默认 30 秒采样一次，足够支撑状态栏显示，也避免 ADC 和 UI 频繁刷新。

第三，充电状态必须有明确硬件依据。用电压趋势推断充电响应慢、容易受负载波动影响，所以 v1 不采用。

第四，snapshot 对 UI 友好。UI 不应该知道 ADC 通道、分压比例、校准方法、充电 GPIO 有效电平，只应该读取 `battery_valid`、`battery_percent`、`charging` 这类模型字段。

## 当前项目实现

当前状态：设计草案/待实现。

已确认的事实边界：

- 存在 `POWER_SERVICE_MODULE.md` 设计文档。
- service public include 中尚未存在 PowerService 对外头文件。
- 当前草案建议参考官方 ADC demo 的 ADC1 Channel 3。
- 草案默认 `SERVICE_POWER_CHG_GPIO = GPIO_NUM_NC`，因为 `CHG/STAT` 是否接入 ESP32 GPIO 尚未确认。
- v1 只计划覆盖状态栏电量和可选充电图标，不做完整 PMIC 管理。

草案 snapshot：

```c
typedef struct {
    bool valid;
    uint16_t voltage_mv;
    uint8_t percent;
    bool charge_valid;
    bool charging;
} power_snapshot_t;
```

草案配置分层：

```text
BSP config:
  - BSP_BAT_ADC_GPIO
  - BSP_BAT_ADC_UNIT
  - BSP_BAT_ADC_CHANNEL
  - BSP_CHG_STATUS_GPIO

Service config:
  - SERVICE_POWER_BAT_ADC_ATTEN
  - SERVICE_POWER_BAT_ADC_BITWIDTH
  - SERVICE_POWER_BAT_DIVIDER_RATIO
  - SERVICE_POWER_CHG_GPIO
  - SERVICE_POWER_CHG_ACTIVE_LEVEL
  - SERVICE_POWER_SAMPLE_INTERVAL_MS
  - SERVICE_POWER_EMPTY_MV
  - SERVICE_POWER_FULL_MV
```

## 关键边界/踩坑

- 本文是设计草案/待实现，不能在复习或面试中说“当前 PowerService 已经落地”。
- 不要复用旧 ADC 文的结论替代项目事实；真正实现时要以当前板卡 demo、BSP 配置和实机测量为准。
- `CHG/STAT` GPIO 未确认前，默认 `charge_valid=false`，不要假装能判断充电状态。
- 电池百分比线性映射只是状态栏粗略估算，不是精密电量计。
- `SERVICE_POWER_BAT_DIVIDER_RATIO = 3.0f` 是按 `200K + 100K` 分压假设，需要原理图或实测确认。
- ADC 采样应使用校准后的 mV，不应直接拿 raw 值估算电池电压。
- PowerService 不应直接调用 UI，也不应决定低电量关机。

## 面试问答

**问：PowerService 现在实现了吗？**

答：还没有，当前是设计草案/待实现。已经有模块设计文档，但 service public include 中还没有 PowerService 对外头文件，所以不能把它描述成已落地代码。

**问：为什么电池电压要乘以分压比例？**

答：ADC 测的是经过分压电阻后的电压，不是电池原始电压。假设硬件是 `200K + 100K` 分压，ADC 端约为电池电压的三分之一，所以校准后的 ADC mV 要乘以 3 才接近电池实际电压。

**问：为什么不通过电压上升判断是否正在充电？**

答：电压趋势受负载、采样间隔、电池曲线影响，响应慢且容易误判。充电状态最好来自充电芯片的 `CHG/STAT` 引脚；如果没有硬件依据，就应该明确标记为 unknown，而不是猜。

**问：线性百分比有什么问题？**

答：锂电池电压和剩余容量不是线性关系，线性映射只能做状态栏粗略显示。v1 先用 `3000mV-4120mV` 对齐官方 demo，后续可以根据实机体验调阈值或换分段曲线。

**问：PowerService 和 PowerPolicy 怎么分？**

答：PowerService 只观测并输出 snapshot；PowerPolicy 才适合做低电量关机、休眠、降频等策略。这样电源数据采集和产品策略不会混在一起。

## 复习检查表

- [ ] 明确说出 PowerService 是设计草案/待实现。
- [ ] 能解释 ADC raw、校准 mV、分压换算、电池电压之间的关系。
- [ ] 能写出 `3000mV-4120mV` 线性百分比的基本公式。
- [ ] 能说明 `charge_valid=false` 的含义。
- [ ] 能解释为什么不靠电压趋势推断充电。
- [ ] 能区分 PowerService 观测职责和 PowerPolicy 策略职责。
- [ ] 能列出实现前必须确认的 `CHG/STAT` GPIO、有效电平和分压比例。
