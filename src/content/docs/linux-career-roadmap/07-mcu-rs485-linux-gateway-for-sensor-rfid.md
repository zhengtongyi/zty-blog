---
title: MCU 光电传感器与 RFID 读写器如何接入 Linux 网关
description: 面向 STM32、GD32、AT32 这类 MCU 产品公司，梳理光电传感器、RFID 读写器、RS485、Modbus RTU 和 Linux 网关之间的合理分工。
---

## 先给结论

如果面试公司主要做 `STM32 / GD32 / AT32` 这类 MCU 产品，例如光电传感器和 RFID 读写器，那么 Linux 不应该被包装成“替代 MCU 的主控”。

更合理的定位是：

```text
MCU 负责实时采集、协议处理和现场控制。
RS485 负责长距离、抗干扰的现场总线传输。
Linux 负责上位机、网关、测试平台、数据汇聚、MQTT 上传和诊断。
```

也就是：

```text
光电传感器 / RFID 读写器
-> STM32 / GD32 / AT32
-> RS485 / Modbus RTU
-> Orange Pi 3B Linux 网关
-> SQLite / MQTT / Web Dashboard / 日志诊断
```

这条路线比单纯说“我在学 Linux 驱动”更贴近这类公司的岗位需求。

## 为什么 MCU 仍然是核心

光电传感器和 RFID 读写器通常是现场设备，核心要求是：

1. 成本低。
2. 启动快。
3. 响应稳定。
4. 功耗低。
5. 外设接口简单可靠。
6. 长期运行不需要人工维护。
7. 可以通过 RS485、IO、UART 或 CAN 接入上位系统。

这些需求非常适合 MCU。

光电传感器里，MCU 适合做：

```text
光敏 / 红外接收
-> ADC / GPIO / Comparator / Timer
-> 滤波、阈值、回差、去抖
-> 遮挡 / 有物状态判断
-> 开关量输出或 RS485 上报
```

RFID 读写器里，MCU 适合做：

```text
RFID 前端芯片
-> ISO14443A / ISO15693 读写流程
-> UID / 数据块解析
-> 误读、漏读、重复读处理
-> RS485 / Modbus / UART 输出
```

所以如果公司问“为什么不用 Linux 直接做”，可以回答：

> 这类设备本身是实时、低成本、强现场属性的产品，用 MCU 更合适。Linux 更适合作为上位机或网关，去连接多个 MCU 节点，做数据汇聚、缓存、配置、诊断和联网。

## RS485 到底承担什么角色

RS485 不是协议，它是电气层。

它解决的是：

```text
长距离传输
抗干扰
差分信号
多设备挂总线
工业现场布线
```

但 RS485 不规定数据格式。真正规定“主站怎么读、从站怎么回、寄存器怎么定义”的，一般是：

```text
Modbus RTU
```

所以完整表达应该是：

```text
RS485：负责怎么传。
Modbus RTU：负责传什么。
```

面试时不要把 `RS485` 和 `Modbus` 混成一个概念。

## 最小可复刻项目

当前手里如果有：

```text
STM32 开发板
面包板
光敏传感器，支持 AO / DO
TTL 转 RS485 模块
USB 转 RS485 模块
Orange Pi 3B
```

就可以快速复刻一个“光电传感器节点 + Linux 网关”的最小闭环。

第一版链路：

```text
光敏传感器 AO
-> STM32 ADC
-> 阈值判断、滤波、状态机
-> STM32 Modbus RTU Slave
-> TTL 转 RS485
-> USB 转 RS485
-> Orange Pi 3B /dev/ttyUSB0
-> Linux Modbus Master
-> MQTT 上传
```

`AO` 用来做模拟采样，适合自己在 MCU 里做阈值和滤波。

`DO` 是模块自带比较器输出，可以作为辅助调试，但不建议作为主方案。因为 DO 的阈值通常由模块电位器决定，软件侧不方便配置，也不利于展示你的算法和工程能力。

## 硬件接线

光敏传感器接 STM32：

```text
光敏 VCC -> STM32 3.3V
光敏 GND -> STM32 GND
光敏 AO  -> STM32 ADC_IN，例如 PA0
光敏 DO  -> STM32 GPIO，可选
```

建议优先让光敏模块用 `3.3V` 供电，避免 `AO / DO` 输出超过 STM32 ADC 或 GPIO 可承受范围。

STM32 接 TTL 转 RS485：

```text
STM32_TX -> RS485_RXD
STM32_RX -> RS485_TXD
STM32_GND -> RS485_GND
STM32_3V3 / 5V -> RS485_VCC，看模块要求
```

RS485 总线接 Linux：

```text
STM32 侧 RS485_A -> USB-RS485_A
STM32 侧 RS485_B -> USB-RS485_B
GND 建议共地
```

Orange Pi 3B 没有板载原生 RS485 A/B 接口。它有 USB 和 40Pin UART，但没有 RS485 收发器。

第一版推荐：

```text
Orange Pi 3B USB
-> USB 转 RS485
-> /dev/ttyUSB0
```

不要一开始折腾 40Pin UART、设备树 overlay 和 GPIO 方向控制。先把产品链路跑通更重要。

## 自动收发 RS485 模块还需要开发什么

自动收发模块只省掉 `DE / RE` 方向控制。

它解决的是：

```text
STM32 UART TTL 电平
<-> RS485 A/B 差分电平
```

它没有帮你完成：

```text
Modbus RTU 协议
CRC16 校验
寄存器表设计
光电采样
阈值和滤波
状态机
超时和异常处理
参数保存
Linux 侧轮询
MQTT 上报
```

所以自动收发不是“没有开发量”，而是让你少写方向控制代码，把精力放到协议和业务。

## STM32 侧应该开发什么

建议拆成几个模块：

```text
sensor_adc
  负责 AO 采样、滑动平均、滤波。

photo_sensor
  负责阈值、回差、连续判定、遮挡状态机。

modbus_slave
  负责 RTU 组帧、CRC16、功能码、异常码。

register_map
  负责把设备状态映射成 Modbus 寄存器。

param_store
  可选，负责阈值等参数掉电保存。
```

寄存器可以先这样设计：

```text
0x0000：遮挡状态，0=无遮挡，1=遮挡
0x0001：ADC 原始值
0x0002：滤波后数值
0x0003：阈值
0x0004：触发次数
0x0005：错误计数
0x0006：设备版本
```

第一版至少支持：

```text
0x03：读保持寄存器
0x06：写单个寄存器，用于修改阈值
```

## 光电检测逻辑不能只写 if

不要只写：

```c
if (adc > threshold) {
    state = 1;
} else {
    state = 0;
}
```

这很容易抖动。

更像产品的做法是：

```text
ADC 采样
-> 滑动平均
-> 高低阈值回差
-> 连续 N 次确认
-> 状态变化才更新触发计数
```

例如：

```text
threshold_high = 2500
threshold_low  = 2200

连续 3 次超过 high，确认无遮挡。
连续 3 次低于 low，确认遮挡。
中间区域保持旧状态。
```

这能体现你理解现场干扰、阈值抖动和状态稳定性。

## Linux 侧应该开发什么

Linux 侧不要做传感器实时判断，它应该做网关。

模块可以拆成：

```text
serial_port
  打开 /dev/ttyUSB0，配置 9600 8N1、超时和重连。

modbus_master
  周期轮询 STM32，从寄存器读取状态。

device_model
  把寄存器转换成业务字段，例如 state、adc、threshold。

data_store
  使用 SQLite 保存历史采样和错误事件。

mqtt_client
  将采集结果上传到 broker。

web_dashboard
  展示实时数据、历史曲线和设备状态。

diagnostics
  统计超时、CRC 错误、离线次数、最近错误。
```

MQTT payload 可以设计成：

```json
{
  "device_id": "photo_sensor_001",
  "state": 1,
  "adc": 2380,
  "threshold": 2200,
  "trigger_count": 15,
  "timestamp": 1719000000
}
```

第一版只要做到：

```text
Linux 能通过 /dev/ttyUSB0 读取 STM32 Modbus 寄存器
-> 打印结构化日志
-> 发布 MQTT
```

就已经是一个完整闭环。

## RFID 读写器怎么接入同一套架构

RFID 读写器如果本身提供 `RS485 / Modbus` 接口，就可以直接作为另一个 Modbus 从站接入 Linux。

如果是自己用 MCU 做 RFID 读写器，则链路类似：

```text
RFID 前端芯片
-> STM32 / GD32 / AT32
-> UID 读取、数据块读写、重复过滤
-> Modbus RTU 寄存器
-> RS485
-> Linux 网关
```

RFID 寄存器可以设计成：

```text
0x0100：是否有卡，0=无卡，1=有卡
0x0101：UID 长度
0x0102~0x0109：UID 数据
0x010A：读卡次数
0x010B：错误码
```

Linux 侧不关心底层射频细节，只把 RFID 当作一个 Modbus 设备。

这就是分层：

```text
MCU 负责读卡实时性和 RFID 芯片细节。
Linux 负责设备接入、日志、缓存、上报和可视化。
```

## 面试时怎么讲

可以这样表达：

> 我理解这类光电传感器和 RFID 读写器产品，核心还是 MCU 设备端开发。比如 STM32、GD32、AT32 负责传感器采样、RFID 芯片控制、阈值判断、滤波、状态机和 RS485 / Modbus 通信。Linux 不应该替代 MCU，而更适合作为上位机或网关，连接多个 MCU 设备，做数据采集、协议转换、SQLite 缓存、MQTT 上传、Web 配置和日志诊断。

如果面试官问“你怎么快速做一个验证项目”，可以回答：

> 我会先用 STM32 接光敏传感器 AO，通过 ADC 采样做阈值、回差和连续判定，再实现 Modbus RTU 从站，把状态、ADC 值、阈值和触发次数映射成寄存器。然后用 USB-RS485 接 Orange Pi 3B，Linux 作为 Modbus Master 轮询寄存器，再通过 MQTT 上传。这样可以完整覆盖传感器采集、RS485 通信、Modbus 协议、Linux 网关和云端上报。

如果面试官问“自动收发 RS485 模块用了之后你还做什么”，可以回答：

> 自动收发模块只解决 UART 到 RS485 差分电平转换和方向控制。软件上仍然要做 Modbus RTU 从站、CRC16、功能码处理、寄存器映射、传感器滤波、状态机、超时异常和 Linux 侧采集上报。

## 简历项目写法

项目名：

```text
基于 STM32 + RS485 + Linux 网关的光电传感器数据采集系统
```

简历描述：

```text
基于 STM32 开发光电传感器节点，完成 AO 采样、阈值判断、滤波去抖、状态机和 Modbus RTU 从站；
Linux 网关通过 USB-RS485 轮询采集设备状态，并使用 MQTT 上传，实现传感器数据采集、协议转换和边缘诊断闭环。
```

项目要点：

```text
1. 基于 STM32 ADC 采集光敏 / 红外传感器信号，使用滑动平均、阈值回差和连续判定提升状态稳定性。
2. 实现 Modbus RTU 从站，支持寄存器读取、阈值配置、CRC16 校验、异常码和通信错误统计。
3. 通过 TTL 转 RS485 模块接入总线，并使用 USB-RS485 将设备接入 Orange Pi 3B Linux 网关。
4. Linux 侧实现 Modbus Master 轮询、结构化日志、SQLite 本地存储和 MQTT 上报。
5. 支持断线、超时、设备离线和异常恢复测试，沉淀接线文档、协议文档和测试报告。
```

## 最终判断

对于目标公司来说，最应该强调的是：

```text
MCU 设备端
+ 外设采样
+ RS485 / Modbus
+ 光电 / RFID 业务
+ 上位机 / Linux 网关协同
+ 稳定性测试
```

Linux 是加分项，不是主角。

主线应该是：

```text
我能做 MCU 产品模块。
我也知道这些 MCU 设备如何接入 Linux 网关、上位机和云端系统。
```

这比单纯说“我会 Linux”更适合光电传感器和 RFID 读写器公司。
