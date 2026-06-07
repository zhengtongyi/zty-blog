---
title: Pixel Soul 基础服务复习笔记
description: 复习 ButtonService、SensorService、TimeService 和 SdService 的定位、主流程、设计取舍与面试表达。
---

## 一句话定位

基础服务组负责把板载按键、温湿度传感器、RTC/SNTP 时间和 Micro SD 卡这些硬件或系统能力封装成稳定的 Service，让 AppCore 和 UI 只面对事件、snapshot 和少量启动接口。

## 基础原理

基础服务的共同思路是：底层负责硬件细节，上层负责产品决策。ButtonService 把 `iot_button` 的 GPIO、消抖、长按、双击转换成 `button_service_event_t`；SensorService 通过 I2C 读取 SHTC3，并把温湿度、有效性、格式化文本放进 `sensor_snapshot_t`；TimeService 用 RTC 和 SNTP 修正系统时间，再输出 `time_snapshot_t`；SdService 在启动期挂载 SDMMC/FAT 文件系统，并输出 `sd_service_snapshot_t`。

这些 Service 不直接驱动页面，也不直接决定业务动作。例如按键服务只说“KEY 发生了 double click”，不说“返回首页”；时间服务只说“当前来源是 RTC 或 SNTP”，不说“页面怎么显示”；SD 服务只说“Ready/N/A/Error”，不负责模型加载策略。

## 主流程

基础服务的启动主线可以概括为：

```text
AppCore 启动
  -> 初始化 ButtonService / SensorService / TimeService / SdService
  -> 启动需要后台运行的 Service
  -> Service 维护事件或 snapshot
  -> AppCore 收到 callback 后读取 snapshot
  -> AppModel/UI 做展示或业务决策
```

ButtonService 是事件流：

```text
button_service_init()
  -> 创建 KEY / BOOT button
  -> 注册 single / double / long / hold / release callback
  -> iot_button 触发底层 callback
  -> ButtonService 转成 button_service_event_t
  -> AppCore 根据当前页面和状态决定动作
```

SensorService 是周期采样流：

```text
sensor_service_init()
  -> 获取 BSP I2C bus
  -> 初始化 SHTC3 backend
  -> sensor_service_start()
  -> sensor_service task 周期读取温湿度
  -> 更新 sensor_snapshot_t
  -> 通知上层刷新
```

TimeService 是本地时间增强流：

```text
time_service_init()
  -> 设置时区
  -> 尝试从 PCF85063 RTC 恢复系统时间
  -> time_service_start() 启动 esp_timer tick
  -> 网络连接后 time_service_on_network_connected()
  -> SNTP 成功后更新系统时间并按策略写回 RTC
  -> 输出 time_snapshot_t
```

SdService 是启动期同步挂载流：

```text
sd_service_init()
  -> 使用 SDMMC 1-bit 尝试挂载 /sdcard
  -> 成功则 READY
  -> 无卡则 NOT_FOUND
  -> 挂载失败则 ERROR
  -> 上层通过 sd_service_get_snapshot() 读取状态
```

## 为什么这样设计

第一，硬件能力可降级。SHTC3、RTC、SD 卡都不是 App 启动的硬依赖，所以缺失时记录为 `NOT_FOUND` 或不可用，但 `init()` 仍尽量返回 `ESP_OK`。这能保证屏幕、网络、AI 等核心链路继续工作。

第二，业务含义集中在 AppCore。ButtonService 不理解 Home/Game/Info 页面，也不理解 AI activate/cancel；它只提供事实事件。这样后续改交互映射时，不需要重写底层按键模块。

第三，snapshot 降低 UI 复杂度。SensorService 和 TimeService 已经把原始数值、有效性和展示文本整理好，UI 不需要知道 SHTC3 CRC、RTC BCD、SNTP 回调或 I2C bus 顺序。

第四，共享资源边界清楚。SensorService 和 TimeService 只调用 `bsp_i2c_bus_get()` 获取已经初始化好的 I2C bus，不在各自模块里重复创建共享总线。

## 当前项目实现

ButtonService 已实现 `button_service_init()`、`button_action_to_str()`、`button_id_to_str()`。当前公开按键包括 `BUTTON_ID_KEY` 和 `BUTTON_ID_BOOT`；动作包括 `PRESS_DOWN`、`SINGLE_CLICK`、`DOUBLE_CLICK`、`LONG_PRESS`、`LONG_HOLD`、`LONG_RELEASE`、`VERY_LONG_PRESS`。KEY 支持 very long press，适合作为配网或重置这类强意图入口，最终业务仍由 AppCore 决定。

SensorService 已实现 `sensor_service_init()`、`sensor_service_start()`、`sensor_service_get_snapshot()`、`sensor_service_is_ok()`。snapshot 包含 `status`、`valid`、`temperature_c`、`humidity_percent`、`device_id`、`fail_count`、`updated_at_ms` 和 UI 文本字段。SHTC3 缺失不会阻塞 App；后续任务只在 backend ready 时创建。

TimeService 已实现 `time_service_init()`、`time_service_start()`、`time_service_on_network_connected()`、`time_service_on_network_disconnected()`、`time_service_refresh_snapshot()`、`time_service_get_snapshot()`、`time_service_is_valid()`。它没有 FreeRTOS task，使用 `esp_timer` 周期刷新 snapshot；SNTP 成功后来源变为 `TIME_SYNC_SOURCE_SNTP`，RTC 有效时来源可为 `TIME_SYNC_SOURCE_RTC`。

SdService 已实现 `sd_service_init()`、`sd_service_get_snapshot()`、`sd_service_is_ready()`。它使用 SDMMC 1-bit 挂载 `/sdcard`，`format_if_mount_failed=false`，不会自动格式化用户卡。当前 v1 不做热插拔、不做后台文件队列，也不承担 ESP-SR 模型加载策略。

## 关键边界/踩坑

- `init()` 返回 `ESP_OK` 不一定表示外设存在。SensorService、TimeService、SdService 对缺失外设采用可降级设计，要看 snapshot。
- ButtonService 没有自己的 FreeRTOS task，按键扫描和消抖由 `iot_button` 处理。
- `sensor_service_is_ok()` 只表示最近 snapshot 有效，不等于传感器永久正常。
- TimeService 的 `sync_source` 表示最近一次明确校时来源，不等于当前网络一定在线。
- TimeService 断网不会清空系统时间，也不会把来源重置成 `NONE`。
- SdService v1 的 snapshot 只在 `sd_service_init()` 时更新；没有热插拔检测。
- SD 卡挂载失败不会自动格式化，这是保护用户数据的设计。
- SensorService 和 TimeService 依赖统一启动流程先完成 BSP I2C bus 初始化。

## 面试问答

**问：你们为什么要做 Service 层，而不是 UI 直接读硬件？**

答：因为 UI 需要的是稳定状态和展示文本，不应该理解 GPIO、I2C、CRC、RTC 寄存器或 SDMMC 挂载细节。Service 层把硬件能力封装成事件或 snapshot，上层只做业务决策，模块边界更清楚，也更容易替换硬件实现。

**问：如果 SHTC3 或 RTC 不存在，系统会启动失败吗？**

答：不会。它们在当前产品里是增强能力，不是启动硬依赖。SensorService 会把状态标为 `NOT_FOUND`，TimeService 会继续使用当前系统时间并等待后续 SNTP 修正，App 可以继续运行。

**问：ButtonService 为什么不直接处理配网、返回首页、AI 取消？**

答：按键模块只应该描述“哪个按键发生了什么动作”。配网、页面跳转和 AI 控制依赖当前产品状态，应该放在 AppCore。这样按键事实和业务含义不会混在一起。

**问：TimeService 为什么同时需要 RTC 和 SNTP？**

答：RTC 解决离线启动时的时间恢复，SNTP 解决联网后的准确校时。SNTP 成功后还能按阈值写回 RTC，让下次离线启动也有较准时间。

**问：SdService 为什么不自动格式化挂载失败的 SD 卡？**

答：挂载失败可能是卡损坏、格式不支持或用户数据异常。固件自动格式化风险太高，所以只进入 `ERROR`，由用户或后续明确流程处理。

## 复习检查表

- [ ] 能说清基础服务的共同边界：硬件能力封装，不做产品决策。
- [ ] 能画出 ButtonService 的 `iot_button -> event -> AppCore` 流程。
- [ ] 能解释 SensorService 为什么缺少 SHTC3 仍返回 `ESP_OK`。
- [ ] 能解释 TimeService 的 RTC 恢复、SNTP 校时、RTC 写回三段流程。
- [ ] 能解释 SdService v1 为什么只做启动期挂载。
- [ ] 能区分事件型 Service 和 snapshot 型 Service。
- [ ] 能说出每个基础服务当前不负责什么。
