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
          label: '技术笔记',
          items: [
            { label: 'ESP32-S3 电池采样背景', slug: 'notes/esp32-s3-adc-battery' },
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
          ],
        },
        {
          label: '项目',
          items: [
            { label: 'Pixel Soul', slug: 'projects/pixel-soul' },
          ],
        },
        {
          label: 'ESP32-S3-RLCD Demo',
          items: [
            { label: '学习路线', slug: 'projects/esp32-s3-rlcd-demos' },
            { label: '01 Wi-Fi AP', slug: 'projects/esp32-s3-rlcd-demos/wifi-ap' },
            { label: '02 Wi-Fi STA', slug: 'projects/esp32-s3-rlcd-demos/wifi-sta' },
            { label: '03 ADC Battery', slug: 'projects/esp32-s3-rlcd-demos/adc-battery' },
            { label: '04 I2C PCF85063', slug: 'projects/esp32-s3-rlcd-demos/i2c-pcf85063' },
            { label: '05 I2C SHTC3', slug: 'projects/esp32-s3-rlcd-demos/i2c-shtc3' },
            { label: '06 SD Card', slug: 'projects/esp32-s3-rlcd-demos/sd-card' },
            { label: '07 Audio Test', slug: 'projects/esp32-s3-rlcd-demos/audio-test' },
            { label: '08 LVGL v8', slug: 'projects/esp32-s3-rlcd-demos/lvgl-v8' },
            { label: '09 LVGL v9', slug: 'projects/esp32-s3-rlcd-demos/lvgl-v9' },
            { label: '10 Factory Program', slug: 'projects/esp32-s3-rlcd-demos/factory-program' },
          ],
        },
        {
          label: 'Pixel Soul Service',
          items: [
            { label: '模块总览', slug: 'projects/pixel-soul-services' },
            { label: '基础状态服务', slug: 'projects/pixel-soul-services/foundation-services' },
            { label: 'NetworkService', slug: 'projects/pixel-soul-services/network-service' },
            { label: 'AudioService', slug: 'projects/pixel-soul-services/audio-service' },
            { label: 'SRService', slug: 'projects/pixel-soul-services/sr-service' },
            { label: 'Session', slug: 'projects/pixel-soul-services/session-service' },
            { label: 'Protocol + WebSocketTask', slug: 'projects/pixel-soul-services/protocol-websocket' },
            { label: 'TTSPlayer', slug: 'projects/pixel-soul-services/tts-player' },
            { label: 'PowerService', slug: 'projects/pixel-soul-services/power-service' },
          ],
        },
        {
          label: 'Pixel Soul 全链路复盘',
          items: [
            { label: '复盘总览', slug: 'projects/pixel-soul-review' },
            { label: '设备侧', slug: 'projects/pixel-soul-review/device-side' },
            { label: 'App 层', slug: 'projects/pixel-soul-review/app-layer' },
            { label: '协议交互泳道图', slug: 'projects/pixel-soul-review/protocol-flows' },
            { label: '云端 Cloud New', slug: 'projects/pixel-soul-review/cloud-side' },
            { label: 'Pi Agent Gateway', slug: 'projects/pixel-soul-review/pi-agent-gateway' },
          ],
        },
        {
          label: '面试准备',
          items: [
            { label: '仿生知觉专项准备', slug: 'interviews/bionic-perception' },
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
