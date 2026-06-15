import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import mermaid from 'astro-mermaid';

export default defineConfig({
  site: 'https://zty-blog.pages.dev',
  integrations: [
    mermaid({
      autoTheme: true,
      enableLog: false,
    }),
    starlight({
      title: 'ZTY Blog',
      description: '嵌入式、AIoT 与 AI Agent 的学习笔记。',
      customCss: ['./src/styles/custom.css'],
      components: {
        Head: './src/components/Head.astro',
        ThemeProvider: './src/components/ThemeProvider.astro',
        ThemeSelect: './src/components/ThemeToggle.astro',
      },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/zhengtongyi',
        },
      ],
      sidebar: [
        {
          label: '开始',
          items: [
            { label: '首页', slug: 'index' },
            { label: '关于', slug: 'about' },
          ],
        },
        {
          label: 'esp-audio-stream 开发归档',
          items: [
            { label: '专栏总览', slug: 'projects/esp-audio-stream' },
            { label: 'SDD-00 项目章程', slug: 'projects/esp-audio-stream/sdd-00-project-charter' },
            { label: 'SDD-00.5 开源扫描', slug: 'projects/esp-audio-stream/sdd-00-5-open-source-scan' },
            { label: 'SDD-00.6 价值验证', slug: 'projects/esp-audio-stream/sdd-00-6-value-validation' },
            { label: 'SDD-00 设计记录', slug: 'projects/esp-audio-stream/sdd-00-design-record' },
            { label: '对话归档摘要', slug: 'projects/esp-audio-stream/conversation-archive-summary' },
          ],
        },
        {
          label: '音频流链路搭建与可靠性优化',
          items: [
            { label: '专栏总览', slug: 'audio-stream-reliability' },
            { label: '01 问题背景与常见问题', slug: 'audio-stream-reliability/01-problem-background' },
            { label: '02 Xiaozhi 音频流传输源码研究', slug: 'audio-stream-reliability/02-xiaozhi-audio-transport-study' },
            { label: '03 上行 PCM 发包链路', slug: 'audio-stream-reliability/03-uplink-pcm-backpressure-baseline' },
            { label: '04 Cloudflare 公网链路基线', slug: 'audio-stream-reliability/04-cloudflare-public-link-baseline' },
            { label: '05 四象限对照基线分析', slug: 'audio-stream-reliability/05-four-quadrant-baseline-analysis' },
            { label: '06 Frame 聚合单变量实验', slug: 'audio-stream-reliability/06-frame-aggregation-analysis' },
            { label: '07 Transport 写入分层', slug: 'audio-stream-reliability/07-transport-write-breakdown' },
            { label: '08 Opus 降码率验证', slug: 'audio-stream-reliability/08-opus-uplink-bitrate-baseline' },
            { label: '09 双向 Opus 与下行背压', slug: 'audio-stream-reliability/09-opus-real-session-pi-agent-playback' },
            { label: '10 下行 Opus 速率协商', slug: 'audio-stream-reliability/10-opus-paced-downlink-verification' },
          ],
        },
        {
          label: '面试准备',
          items: [
            { label: 'vivo外包', slug: 'interviews/vivo-outsourcing' },
            { label: 'Wi-Fi外包', slug: 'interviews/wifi-outsourcing' },
          ],
        },
        {
          label: 'Wi-Fi 模块重构与优化',
          items: [
            { label: '专栏总览', slug: 'projects/wifi-module-refactor' },
            { label: '01 建连与事件模型', slug: 'projects/wifi-module-refactor/01-esp32-wifi-connection-event-model' },
            { label: '02 重连与功耗策略', slug: 'projects/wifi-module-refactor/02-esp32-wifi-reconnect-power-strategy' },
          ],
        },
        {
          label: '嵌入式面试八股文',
          items: [
            { label: '专栏总览', slug: 'interview-handbook' },
            { label: '01 FreeRTOS 任务调度', slug: 'interview-handbook/01-freertos-scheduling' },
            { label: '02 ESP-IDF 工程开发', slug: 'interview-handbook/02-esp-idf-embedded-c' },
            { label: '03 常见外设驱动', slug: 'interview-handbook/03-peripheral-drivers' },
            { label: '04 嵌入式音频链路', slug: 'interview-handbook/04-embedded-audio' },
            { label: '05 IoT 网络通信', slug: 'interview-handbook/05-iot-network-websocket' },
            { label: '06 UI 与资源优化', slug: 'interview-handbook/06-ui-memory-resource' },
            { label: '07 CAN 与 HIL', slug: 'interview-handbook/07-can-hil-automotive' },
            { label: '08 项目综合追问', slug: 'interview-handbook/08-project-deep-dive' },
          ],
        },
        {
          label: '部署',
          items: [
            { label: 'Cloudflare Pages', slug: 'deploy/cloudflare-pages' },
          ],
        },
      ],
    }),
  ],
});
