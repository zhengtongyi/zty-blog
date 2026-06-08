---
title: Pixel Soul PowerService 复习笔记（v1 已实现）
description: 复习 PowerService v1 的电池 ADC 采样、分压换算、电量百分比、状态栏电池图标联动，以及 Type-C 充电指示灯边界。
---

> 本文已按当前设备侧代码校准。PowerService v1 已落地，当前只做电池电压采样和电量百分比估算；不读取充电状态，不显示充电图标。

## 前置阅读

这篇笔记按当前项目代码展开，阅读时可以把下面三份官方文档作为背景资料：

- [ESP32-S3 ADC 总览](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/peripherals/adc/index.html)：理解 ADC raw、位宽、衰减和校准的整体概念。
- [ADC Oneshot Driver](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/peripherals/adc/adc_oneshot.html)：理解 `adc_oneshot_new_unit()`、`adc_oneshot_config_channel()`、`adc_oneshot_read()`。
- [ADC Calibration Driver](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/peripherals/adc/adc_calibration.html)：理解为什么不要直接用 raw 算电压，以及 `adc_cali_raw_to_voltage()` 的作用。

## 一句话定位

PowerService 是设备侧的电源观测服务。它把板载 `BAT_ADC` 采样值转换成稳定的电池状态 snapshot，供 AppModel 和右上角状态栏使用。

```text
BAT_ADC
  -> PowerService
  -> power_snapshot_t(valid / voltage_mv / percent)
  -> AppModel battery_valid / battery_percent
  -> UI status_battery_label
```

当前 Type-C 口旁边的 `CHG` LED 由 ETA6098 充电芯片自己驱动，固件没有确认可读取的 `CHG/STAT` GPIO。因此：

```text
右上角 UI:
  只显示 Wi-Fi 图标和电池图标。

充电状态:
  用户根据 Type-C 口附近 CHG LED 亮灭自行判断。
```

## 当前代码事实

当前 PowerService 已经在设备仓库中实现：

| 文件 | 作用 |
| --- | --- |
| `components/service/include/power_service.h` | Public API 和 `power_snapshot_t`。 |
| `components/service/src/power/power_service.c` | ADC 初始化、周期采样、换算、snapshot 更新。 |
| `components/service/include/service_config.h` | PowerService 配置项。 |
| `components/app_application/src/app_model.c` | 把 PowerService snapshot 投影到 App status model。 |
| `components/app_application/src/app_ui/app_ui.c` | 根据 `battery_percent` 选择 LVGL 电池图标。 |

真实 public snapshot 只有三个字段：

```c
typedef struct {
    bool valid;
    uint16_t voltage_mv;
    uint8_t percent;
} power_snapshot_t;
```

真实 public API 是：

```c
typedef void (*power_service_update_cb_t)(void *ctx);

esp_err_t power_service_init(power_service_update_cb_t update_cb, void *ctx);
esp_err_t power_service_start(void);
void power_service_get_snapshot(power_snapshot_t *out);
```

注意当前没有这些能力：

```text
充电状态字段
充电状态 GPIO 配置
右上角充电图标
充电图标 label
```

这些不是遗漏，而是 v1 的明确边界。

## 基础原理

电池电压不能直接送进 ESP32-S3 ADC。板子先用电阻分压把电池电压降低到 `BAT_ADC` 节点，ADC 实际测到的是分压后的电压。

这条链路可以拆成四个值：

| 名称 | 含义 | 举例 |
| --- | --- | --- |
| `raw` | ADC 原始采样码值。 | 12-bit 通常是 `0-4095`。 |
| `adc_mv` | `adc_cali_raw_to_voltage()` 得到的 ADC 引脚端电压。 | 分压后的电压，例如 `1380mV`。 |
| `divider_ratio` | 从 ADC 节点还原回电池电压的比例。 | 当前为 `3.0f`。 |
| `battery_mv` | 电池实际电压估算值。 | `1380 * 3 = 4140mV`。 |

所以 PowerService 的核心不是“读 raw 后直接算百分比”，而是：

```text
raw
  -> adc_cali_raw_to_voltage()
  -> adc_mv
  -> adc_mv * SERVICE_POWER_BAT_DIVIDER_RATIO
  -> battery_mv
  -> percent
```

## 配置项

当前配置在 `service_config.h`：

| 配置项 | 当前值 | 说明 |
| --- | --- | --- |
| `SERVICE_POWER_BAT_ADC_GPIO` | `BSP_BAT_ADC_GPIO` | 板级 BAT_ADC GPIO，BSP 中为 `GPIO_NUM_4`。 |
| `SERVICE_POWER_BAT_ADC_UNIT` | `ADC_UNIT_1` | 使用 ADC1。 |
| `SERVICE_POWER_BAT_ADC_CHANNEL` | `ADC_CHANNEL_3` | GPIO4 对应 ADC1 Channel 3。 |
| `SERVICE_POWER_BAT_ADC_ATTEN` | `ADC_ATTEN_DB_12` | 扩大可测输入范围，适配分压后的电池电压。 |
| `SERVICE_POWER_BAT_ADC_BITWIDTH` | `ADC_BITWIDTH_12` | 12-bit ADC raw。 |
| `SERVICE_POWER_BAT_DIVIDER_RATIO` | `3.0f` | 电池电压 = ADC 节点电压 * 3。 |
| `SERVICE_POWER_SAMPLE_INTERVAL_MS` | `30000` | 30 秒采样一次。 |
| `SERVICE_POWER_EMPTY_MV` | `3000` | 线性电量估算下限。 |
| `SERVICE_POWER_FULL_MV` | `4120` | 线性电量估算上限。 |

`ADC_ATTEN_DB_12` 这点很重要。虽然 ESP32-S3 ADC 内部参考电压常被说成约 `1.1V`，但 12dB 衰减会扩大 ADC 引脚可测输入范围。当前电池满电附近：

```text
4.12V / 3 = 1.373V
```

这个 `BAT_ADC` 节点电压在 `ADC_ATTEN_DB_12` 的可测范围内。

## 主流程

当前实现的主流程很短：

```text
power_service_init()
  -> 保存 update callback
  -> 初始化 ADC calibration
  -> 初始化 ADC oneshot unit/channel
  -> 初始化 snapshot

power_service_start()
  -> 创建 power_service task

power_task()
  -> power_sample_once()
  -> delay 30000ms

power_sample_once()
  -> power_read_battery_mv()
  -> power_update_snapshot()
  -> notify_power_updated()
```

这里的核心编排函数是 `power_sample_once()`。打开代码时先看它，就能看到业务主线：

```text
读电池电压
  -> 成功：更新 valid snapshot，必要时通知 App
  -> 失败：记录 warning，更新 invalid snapshot，必要时通知 App
```

## 关键方法：读取电池电压

当前代码中的读取方法是：

```c
static esp_err_t power_read_battery_mv(uint16_t *out_battery_mv);
```

它不是只返回 ADC 节点电压，而是直接返回换算后的电池实际电压。内部步骤是：

```text
1. 检查 out_battery_mv 非空，并且 adc_ready=true。
2. adc_oneshot_read() 读取 raw。
3. adc_cali_raw_to_voltage() 把 raw 校准成 adc_mv。
4. adc_mv <= 0 时返回 ESP_ERR_INVALID_RESPONSE。
5. power_battery_mv_from_adc(adc_mv) 得到 battery_mv。
6. 写入 out_battery_mv。
```

伪代码和当前实现一致：

```c
static esp_err_t power_read_battery_mv(uint16_t *out_battery_mv)
{
    if (out_battery_mv == NULL || !s_power.adc_ready) {
        return ESP_ERR_INVALID_STATE;
    }

    int raw = 0;
    esp_err_t ret = adc_oneshot_read(s_power.adc_unit,
                                     SERVICE_POWER_BAT_ADC_CHANNEL,
                                     &raw);
    if (ret != ESP_OK) {
        return ret;
    }

    int adc_mv = 0;
    ret = adc_cali_raw_to_voltage(s_power.adc_cali, raw, &adc_mv);
    if (ret != ESP_OK) {
        return ret;
    }
    if (adc_mv <= 0) {
        return ESP_ERR_INVALID_RESPONSE;
    }

    *out_battery_mv = power_battery_mv_from_adc(adc_mv);
    return ESP_OK;
}
```

这里不要绕过 `adc_cali_raw_to_voltage()` 直接用 raw 算电压。raw 到真实电压的关系受芯片个体、衰减档位和校准参数影响，直接算会让电量显示更飘。

## 关键方法：分压换算

`adc_cali_raw_to_voltage()` 得到的是 `BAT_ADC` 节点电压，不是电池原始电压。电池原始电压要通过分压比例还原。

局部等效电路如下：

![ESP32-S3-RLCD battery ADC voltage divider](/images/esp32-s3-rlcd-battery-adc.svg)

对应公式：

```text
adc_mv = battery_mv * R_down / (R_up + R_down)
battery_mv = adc_mv * (R_up + R_down) / R_down
```

如果 `R_up=200K`、`R_down=100K`：

```text
divider_ratio = (200K + 100K) / 100K = 3.0
battery_mv = adc_mv * 3.0
```

当前代码收敛成：

```c
static uint16_t power_battery_mv_from_adc(int adc_mv)
{
    const float battery_mv = (float)adc_mv * SERVICE_POWER_BAT_DIVIDER_RATIO;
    if (battery_mv <= 0.0f) {
        return 0;
    }
    if (battery_mv >= 65535.0f) {
        return UINT16_MAX;
    }
    return (uint16_t)(battery_mv + 0.5f);
}
```

举例：

```text
BAT_ADC 节点电压 adc_mv = 1380mV
divider_ratio = 3.0
battery_mv = 1380 * 3 = 4140mV
```

这就是日志中可能看到 `battery 4140mV 100%` 的来源。

## 关键方法：百分比估算

百分比只是状态栏图标使用的显示估算，不是精密 SOC。当前代码是线性映射：

```c
static uint8_t power_percent_from_mv(uint16_t battery_mv)
{
    if (battery_mv <= SERVICE_POWER_EMPTY_MV) {
        return 0;
    }
    if (battery_mv >= SERVICE_POWER_FULL_MV) {
        return 100;
    }

    const uint32_t span = SERVICE_POWER_FULL_MV - SERVICE_POWER_EMPTY_MV;
    const uint32_t used = battery_mv - SERVICE_POWER_EMPTY_MV;
    return (uint8_t)((used * 100U + span / 2U) / span);
}
```

默认区间：

```text
3000mV -> 0%
4120mV -> 100%
```

中间值示例：

```text
battery_mv = 3560
percent = (3560 - 3000) * 100 / (4120 - 3000)
        = 50%
```

这条线性曲线只适合粗略显示。锂电池真实剩余容量还会受负载、电池内阻、温度和老化影响。

## Snapshot 与事件

PowerService 的 snapshot 更新由 `power_update_snapshot()` 完成：

```text
valid=true:
  voltage_mv = battery_mv
  percent = power_percent_from_mv(battery_mv)

valid=false:
  voltage_mv = 0
  percent = 0
```

snapshot 变化时才触发 callback：

```text
power_update_snapshot()
  -> changed=true
  -> notify_power_updated()
  -> AppCore posts APP_EVENT_POWER_UPDATED
```

这使 UI 不需要轮询 ADC，也不需要理解采样细节。它只等待服务层模型刷新。

## UI 联动

当前 AppModel 投影链路：

```text
power_service_get_snapshot(&power)
  -> build_status_model()
  -> out->battery_valid = power.valid
  -> out->battery_percent = power.valid ? power.percent : 0
```

当前 UI 渲染链路：

```text
app_status_model_t.battery_valid / battery_percent
  -> ui_battery_symbol()
  -> status_battery_label
```

电池图标映射：

| 状态 | 图标 |
| --- | --- |
| `battery_valid=false` | `LV_SYMBOL_BATTERY_EMPTY` |
| `0-19%` | `LV_SYMBOL_BATTERY_EMPTY` |
| `20-39%` | `LV_SYMBOL_BATTERY_1` |
| `40-59%` | `LV_SYMBOL_BATTERY_2` |
| `60-79%` | `LV_SYMBOL_BATTERY_3` |
| `80-100%` | `LV_SYMBOL_BATTERY_FULL` |

当前右上角没有充电状态 label，也不渲染充电图标。这和当前硬件事实一致：固件读不到 Type-C 充电状态。

## Type-C 充电与 CHG LED

当前板卡通过 Type-C 输入并由 ETA6098 充电芯片给电池充电。这里要区分两条路径：

```text
真正充电路径:
  Type-C VBUS
    -> ETA6098 VIN
    -> ETA6098 开关充电电路
    -> L1 电感
    -> B+ / 电池

CHG LED 指示支路:
  B+ / 电源侧
    -> 限流电阻
    -> CHG LED
    -> ETA6098 STAT
    -> 芯片内部下拉到 GND
```

`STAT` 典型行为：

```text
正在充电:
  STAT = low
  CHG LED 亮

充电完成 / 不在充电:
  STAT = high-Z
  CHG LED 灭
```

关键点是：`CHG` LED 是充电芯片自己控制的指示支路。当前没有确认 `STAT` 再接到 ESP32 GPIO，所以固件不知道 LED 是否亮。用户可以看 LED，PowerService 不读取它。

如果未来硬件把 `STAT` 接入 GPIO，可以作为 PowerService v2，但需要保持 v1 的 `valid/voltage_mv/percent` 兼容。

## 失败收口

当前实现的失败收口很简单：

```text
ADC 初始化或校准失败:
  - power_service_init() 记录 warning。
  - adc_ready=false。
  - initialized=true。
  - App 主流程继续。

power_service_start():
  - 如果 adc_ready=false，只通知一次无效 snapshot。

单次采样失败:
  - 记录 warning。
  - snapshot 切到 valid=false。
  - 下次周期继续尝试。
```

这符合服务层原则：硬件观测失败不能拖垮主 App。

## 面试问答

**问：PowerService 当前实现了吗？**

答：已实现 v1。当前代码包含 `power_service.h` 和 `power_service.c`，提供 `power_service_init()`、`power_service_start()`、`power_service_get_snapshot()`，snapshot 字段是 `valid / voltage_mv / percent`。

**问：为什么电池电压要乘以 3？**

答：ADC 测的是分压后的 `BAT_ADC` 节点电压，不是电池原始电压。当前按 `200K + 100K` 分压理解，ADC 节点约为电池电压的三分之一，所以 `battery_mv = adc_mv * 3.0`。

**问：为什么 4.12V 电池分压后 1.37V 能被 ADC 测到，不是超过 1.1V 了吗？**

答：因为当前使用 `ADC_ATTEN_DB_12`。衰减配置会扩大 ADC 引脚可测输入范围，`4.12V / 3 = 1.37V` 仍在 12dB 衰减下的可测范围内。

**问：为什么不显示充电图标？**

答：因为当前固件没有确认可读取的 `CHG/STAT` GPIO。板上的 `CHG` LED 是 ETA6098 自己驱动的硬件指示灯，用户可以肉眼判断，但 PowerService 不知道它亮没亮，所以 UI 不显示充电图标。

**问：为什么 `get_snapshot()` 不直接采样？**

答：UI 读取状态时不应该卡在 ADC 采样和校准流程里。PowerService 周期采样并缓存 snapshot，AppModel 只读取缓存，这样时序更稳定，也避免 UI 和硬件读数耦合。

**问：线性百分比有什么问题？**

答：锂电池电压和剩余容量不是线性关系。当前 `3000mV-4120mV` 只是状态栏电池图标的粗略估算，后续如果需要更准，可以替换 PowerService 内部的 `voltage_mv -> percent` 映射，不改 App/UI 数据流。

## 复习检查表

- [ ] 能说明 PowerService v1 已实现，而不是草案。
- [ ] 能写出 `power_snapshot_t(valid / voltage_mv / percent)`。
- [ ] 能画出 `BAT_ADC -> PowerService -> AppModel -> status_battery_label` 数据流。
- [ ] 能解释 `raw -> adc_mv -> battery_mv -> percent`。
- [ ] 能解释为什么 `ADC_ATTEN_DB_12` 可以测分压后的 1.37V。
- [ ] 能解释 `battery_mv = adc_mv * 3.0` 的分压来源。
- [ ] 能说明为什么当前不显示充电图标。
- [ ] 能区分 Type-C 充电路径和 CHG LED 指示支路。
