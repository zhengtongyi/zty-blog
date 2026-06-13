---
title: vivo外包
description: 面向 vivo 外包嵌入式岗位的面经复盘：核心业务、独立开发边界、蓝牙与音频模块、Wi-Fi 协议栈、FreeRTOS 调度、TDD/SDD/DDD。
---

这次面试的核心信号是：岗位更关注**蓝牙和音频模块的独立开发能力**，而不是完整 AIoT 全链路叙述。

后续介绍应收敛为：

```text
负责蓝牙和音频基础模块。
蓝牙提供通道能力，可承载控制、播放和语音数据。
音频模块负责采集、播放、缓冲、编解码和实时性保障。
```

## 岗位和业务理解

如果面试官问“你理解这个岗位是做什么的吗”，不要只说“写蓝牙、写音频”。可以回答：

```text
我理解这个岗位更像设备侧基础能力开发。蓝牙模块不是只做配对连接，而是要提供稳定的数据通道，让外部设备可以通过蓝牙下发控制、传输播放音频、上传或接收语音数据。音频模块也不是简单播放 WAV，而是要负责采集、播放、缓冲、编解码、任务调度和异常恢复。
```

更精简的版本：

```text
这个岗位核心不是上层业务页面，而是底层能力模块：蓝牙通道能力、音频输入输出能力、模块接口封装和稳定性保障。
```

## “独立开发”怎么回答

面试官问“哪些是你独立开发的”，不要回答“我参与了整个项目”。要按模块边界回答：

```text
我更适合按模块说明。比如通信传输模块、音频播放模块、语音输入链路、协议状态机，我都不是只改几行业务逻辑，而是从需求拆解、接口定义、状态机、任务模型、queue/ringbuf、日志指标、测试验证到实机问题定位完整做过。
```

对应 vivo 外包岗位，可以迁移成：

```text
如果对应到蓝牙和音频岗位，我会把独立开发拆成两个模块：

1. 蓝牙通信服务模块：负责连接管理、通道收发、分包重组、协议解析、状态事件上报。
2. 音频服务模块：负责采集、播放、缓冲、编解码、I2S/codec 资源管理、播放连续性和异常恢复。

这两个模块都需要清晰接口，不能让上层业务直接操作 BLE API、I2S driver 或 codec 寄存器。
```

一句话总结：

```text
我理解独立开发不是只完成某个功能点，而是把一个模块的边界、接口、状态、错误处理、测试和文档都收口。
```

## 蓝牙模块设计

蓝牙模块可以抽象成 `BluetoothService`：

```text
App / Business
  -> BluetoothService API
  -> BLE/GATT or SPP channel
  -> Bluetooth Controller / RF
```

模块职责：

```text
1. 广播、扫描、连接、断开、重连。
2. MTU 或通道参数协商。
3. 控制消息收发。
4. binary 数据通道。
5. 音频 packet 分包、重组、顺序校验。
6. 连接状态、错误状态、吞吐指标上报。
```

模块不负责：

```text
1. 不理解具体业务页面。
2. 不直接控制播放器业务状态。
3. 不直接实现复杂 ASR/TTS 业务。
4. 不把上层业务状态塞到底层蓝牙 callback。
```

对外接口示例：

```c
esp_err_t bluetooth_service_start(void);
esp_err_t bluetooth_service_stop(void);
esp_err_t bluetooth_service_send_control(const bt_control_msg_t *msg);
esp_err_t bluetooth_service_send_audio(const uint8_t *data, size_t len);
bool bluetooth_service_is_connected(void);
```

事件上报示例：

```c
typedef enum {
    BT_EVENT_CONNECTED,
    BT_EVENT_DISCONNECTED,
    BT_EVENT_CONTROL_RECEIVED,
    BT_EVENT_AUDIO_RECEIVED,
    BT_EVENT_ERROR,
} bt_event_type_t;
```

面试表达：

```text
我会把蓝牙做成一个 service，而不是让业务层直接操作 GATT callback。业务层只看到 connected、disconnected、control received、audio received 这些事件；底层的 MTU、分包、notify/write、重连和错误恢复由 BluetoothService 收口。
```

## 蓝牙通道如何承载播放和语音

岗位提到“蓝牙利用通道能力，能够实现播放和语音”，可以理解为：

```text
蓝牙先提供稳定通道，再在通道上定义业务协议。
控制消息走小包。
语音和播放走 binary packet。
```

典型数据流：

```text
播放方向:
外部设备 -> 蓝牙通道 -> 音频 packet -> 解码/PCM -> Player -> 喇叭

语音方向:
麦克风 -> PCM/编码 -> 蓝牙通道 -> 外部设备
```

如果是 BLE，要注意：

```text
BLE 更适合低码率语音、控制、状态同步，不适合高质量音乐流。
```

面试回答：

```text
如果是语音类数据，我不会默认传裸 PCM。16kHz/16bit/mono PCM 是 32KB/s，对 BLE 来说压力比较大，实际还受 MTU、connection interval、手机系统调度影响。所以我会优先考虑低码率编码，例如 Opus、ADPCM 或 LC3，具体取决于芯片能力和产品要求。
```

如果被问“能不能播放”，可以回答：

```text
如果是提示音、TTS、语音回复这类低码率语音播放，蓝牙通道加合适的编码和缓冲策略可以实现。如果是音乐播放，普通 BLE 不合适，通常要考虑 Classic Bluetooth A2DP 或 BLE Audio/LC3。
```

## 音频模块设计

音频模块可以抽象成：

```text
AudioService
  -> AudioInput
  -> AudioOutput
  -> Codec/I2S driver
  -> Encoder/Decoder
  -> Player
```

职责：

```text
1. 初始化音频 codec。
2. 管理 I2S 输入输出。
3. 提供麦克风 PCM 数据。
4. 提供播放 PCM sink。
5. 管理播放 ringbuf。
6. 统计 underrun、short_write、rebuffer。
7. 管理 start/stop/clear/interrupt 生命周期。
```

面试表达：

```text
音频模块我会拆成采集和播放两条链路。采集侧负责从 codec/I2S 拿 PCM，再交给上层编码或语音算法；播放侧只消费 PCM，不理解蓝牙或业务协议。蓝牙收到的音频 packet 需要先在蓝牙模块或 codec 模块解码成 PCM，再交给播放器。
```

播放连续性关键：

```text
不能收到一点播一点。需要 ringbuf 或 jitter buffer，达到一定水位后再启动播放，并持续监控 underrun 和 short_write。
```

### 为什么使用多通道麦克风

如果面试官问“为什么用多通道麦克风，不用单通道”，不要只回答“效果更好”。要从**空间信息、抗噪、远场拾音和算法能力**回答。

核心区别：

```text
单通道麦克风只能拿到一个位置的声音波形，只能做基于幅度和频谱的处理。
多通道麦克风可以拿到不同麦克风之间的时间差、相位差和能量差，因此可以获得声音的空间信息。
```

多通道麦克风的价值：

```text
1. 支持波束形成，把拾音方向对准说话人，抑制旁边或后方噪声。
2. 支持声源方向估计，判断声音大致来自哪个方向。
3. 提升远场拾音能力，桌面设备、车载设备、会议设备不要求用户贴近麦克风说话。
4. 提升 Wake Word / VAD / ASR 稳定性，降低环境噪声和播放回声导致的误唤醒、漏唤醒。
5. 播放期结合参考音和多麦输入，更容易做回声抑制和语音增强。
```

工程 trade-off：

```text
多通道不是无脑更好。它会增加麦克风成本、PCB 空间、I2S/TDM/PDM 通道、DMA 带宽、算法算力和标定复杂度。
如果是近场按键对讲、低成本设备，单麦可能够用。
如果是桌面语音交互、车载、会议、嘈杂环境或需要远场唤醒，多麦更合理。
```

面试表达：

```text
我会根据场景选择麦克风数量。单麦适合近场、低成本、环境简单的设备；多麦适合远场语音和噪声复杂的场景。多麦的核心不是多采几路 PCM，而是提供空间信息，让 AFE 能做波束形成、降噪、声源方向估计和更稳定的唤醒识别。
```

## Wi-Fi 协议栈怎么回答

如果被问“是否了解 Wi-Fi 协议栈”，不要夸大成自己写过 Wi-Fi MAC/PHY。可以诚实但有层次：

```text
我没有自己实现过 Wi-Fi MAC/PHY，但理解 ESP-IDF 里 Wi-Fi 从驱动、事件、IP 获取到上层 socket 的分层。实际开发中主要接触 STA/AP 模式、连接事件、断线重连、DHCP 获取 IP、网络状态上报，以及上层 TCP/WebSocket 对 Wi-Fi 状态的依赖。
```

分层可以画成：

```text
Application
  -> HTTP / WebSocket / MQTT
  -> TCP / UDP
  -> IP / DHCP / DNS
  -> Wi-Fi driver
  -> 802.11 MAC / PHY
  -> RF
```

重点：

```text
Wi-Fi 连接成功不等于业务可用。设备拿到 IP 只说明链路层和网络层基本可用；如果 AI gateway、DNS、TLS、WebSocket 任一层失败，上层业务仍然不可用。所以工程上需要区分 Wi-Fi connected、IP ready、gateway reachable 和 session active。
```

常见追问：

```text
STA 是设备连接到路由器；AP 是设备自己开热点让手机连接。
设备连上 AP 后，通过 DHCP 获取 IP、网关和 DNS。
Wi-Fi 断开后底层 NetworkService 负责重连，上层业务要收到网络不可用状态并关闭或暂停当前 session。
```

## FreeRTOS 调度怎么回答

不要只说会创建 task。推荐回答：

```text
我理解 FreeRTOS 是基于优先级的抢占式 RTOS。调度器维护不同优先级的 ready list，每次选择当前最高优先级 ready task 运行。任务调用 vTaskDelay、等待 queue/semaphore/ringbuf 时，会进入 blocked 状态，不再参与调度；tick 中断到期后再把任务移回 ready list。
```

任务状态：

```text
Running
Ready
Blocked
Suspended
Deleted
```

上下文切换：

```text
当前 task 寄存器、PC、SP
  -> 保存到当前 task stack/TCB
调度器选择 next task
  -> 从 next task TCB/stack 恢复上下文
  -> 继续运行 next task
```

ESP32-S3 补充：

```text
ESP32-S3 是双核，ESP-IDF FreeRTOS 还要考虑 task priority、core affinity、SMP 调度、临界区和 spinlock。实际项目里，音频采集、编码、WebSocket、播放这些 task 的优先级和阻塞点会直接影响语音完整性和播放连续性。
```

结合蓝牙音频岗位：

```text
蓝牙 callback 里不能做重活，应该尽快把数据投递到 queue/ringbuf；音频编码、解码、播放放到独立 task。否则高优先级 callback 或网络任务长时间运行，会影响音频实时性。
```

## TDD / SDD / DDD 怎么回答

### TDD

TDD 是 Test-Driven Development，测试驱动开发。

```text
我的理解是先把可验证行为写清楚，再实现代码。不是所有嵌入式代码都适合完整 TDD，但协议解析、状态机、分包重组、队列满、非法参数、超时处理这些纯逻辑边界很适合先写测试。
```

结合岗位：

```text
蓝牙协议 parser、音频 packet 分包重组、播放器状态机都可以做 TDD。比如先写测试：收到两个相同 seq 的包怎么处理、半包是否等待、queue 满是否阻塞或丢旧包，然后再实现。
```

### SDD

SDD 可以按 Software Design Document 理解，即软件设计说明。

```text
SDD 对我来说是开发前先把模块目标、边界、接口、状态机、数据结构、错误处理和测试方案写清楚。嵌入式模块如果不先写 SDD，很容易出现业务层直接调用底层驱动、状态散落、后期不可维护的问题。
```

蓝牙音频模块的 SDD 应包括：

```text
1. 模块目标。
2. 模块不负责什么。
3. 对外 API。
4. 内部 task/queue/ringbuf。
5. 状态机。
6. 数据包格式。
7. timeout 和错误恢复。
8. 测试计划。
```

### DDD

DDD 是 Domain-Driven Design，领域驱动设计。

嵌入式面试里不必讲复杂聚合根，可以落到“统一领域语言和模块边界”：

```text
我的理解是先把业务领域里的概念说清楚，再让代码结构跟这些概念对齐。比如连接、通道、播放、语音输入、音频 packet、设备状态，这些词不能混用。
```

结合岗位：

```text
蓝牙模块的领域语言应该是 connection、channel、control message、audio packet；音频模块的领域语言是 PCM frame、encoded packet、playback buffer、underrun、rebuffer。不要让蓝牙模块理解播放器业务，也不要让播放器理解蓝牙 GATT 细节。
```

一句话总结：

```text
TDD 解决“怎么证明行为正确”，SDD 解决“开发前怎么设计清楚”，DDD 解决“模块语言和业务边界怎么统一”。
```

## 高频问答

### Q1：哪些模块是你独立开发的？

```text
我会按模块回答，而不是按整个项目回答。比如传输模块、音频播放模块、语音输入链路和协议状态机，我都做过从需求拆解、接口设计、状态机、任务模型、测试验证到实机问题定位。对应这个岗位，我最相关的是蓝牙通信服务和音频服务这类独立能力模块。
```

### Q2：蓝牙怎么实现语音和播放？

```text
蓝牙先提供通道能力，然后在通道上跑自定义协议。控制消息可以走小包，语音和播放走 binary packet。播放方向是外部设备通过蓝牙发音频 packet，设备解码成 PCM 后交给 Player；语音方向是麦克风采集 PCM，编码后通过蓝牙发出去。关键是分包重组、码率控制、缓冲水位和播放连续性。
```

### Q3：BLE 传 PCM 可以吗？

```text
要看目标质量。16k/16bit/mono PCM 是 32KB/s，BLE 实际吞吐受 MTU、connection interval 和手机调度影响，直接传裸 PCM 风险较高。语音场景我会优先考虑压缩编码，降低链路压力。
```

### Q4：音频播放断续怎么查？

```text
分层查：蓝牙接收速率是否够、packet 是否丢、解码耗时是否超过 frame duration、PCM ringbuf 是否空、I2S write 是否 short_write、播放器水位是否太低。不能一上来只改播放器。
```

### Q5：为什么使用多通道麦克风，而不是单通道？

```text
单麦只能拿到一个位置的声音波形，多麦可以拿到不同麦克风之间的时间差、相位差和能量差，也就是声音的空间信息。这样 AFE 才能做波束形成、声源方向估计、降噪和远场拾音，提升 Wake Word、VAD 和 ASR 的稳定性。但多麦也会增加成本、通道带宽、DMA 和算法算力，所以近场低成本设备可以用单麦，远场语音、车载、会议或嘈杂环境更适合多麦。
```

### Q6：FreeRTOS 底层怎么调度？

```text
基于优先级抢占。ready list 里最高优先级 task 运行；等待 queue/semaphore/ringbuf 或 vTaskDelay 的任务进入 blocked，不占 CPU；tick 到期或事件到达后回 ready。上下文切换保存当前 task 的寄存器和栈指针，再恢复下一个 task。ESP32-S3 还涉及双核、core affinity 和 spinlock。
```

### Q7：你了解 Wi-Fi 协议栈吗？

```text
我了解工程开发中需要掌握的分层：Wi-Fi driver 负责 802.11 连接，IP 层通过 DHCP 获取地址，上层再跑 TCP/TLS/WebSocket。实际开发要区分 Wi-Fi connected、got IP、gateway reachable、session active，不能把它们混成一个 online 状态。
```

### Q8：TDD/SDD/DDD 你怎么理解？

```text
TDD 是先定义可验证行为，适合协议解析、状态机、边界条件；SDD 是开发前写清模块目标、接口、状态机、错误处理和测试方案；DDD 是统一领域语言和模块边界，避免底层模块混入上层业务语义。
```

## 下一次面试表达策略

不要这样说：

```text
我做过 AI 语音设备，里面有蓝牙、Wi-Fi、音频、云端、UI。
```

容易显得散。

应该这样说：

```text
我重点准备的是蓝牙和音频这类独立能力模块。我的模块设计思路是：先定义清楚通道能力、音频能力和业务边界；底层用 FreeRTOS task、queue、ringbuf 把实时数据搬运稳定；上层只消费清晰的 API 和事件。这样模块可以独立开发、独立测试，也更适合团队协作。
```

最后留给面试官的印象：

```text
我不是只会写 demo，而是能把蓝牙/音频这种底层能力模块，从需求、接口、协议、任务调度、缓冲、异常恢复到测试验证完整收口。
```
