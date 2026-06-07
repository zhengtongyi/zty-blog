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
          label: '项目',
          items: [
            { label: 'Pixel Soul', slug: 'projects/pixel-soul' },
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
            { label: 'PowerService 草案', slug: 'projects/pixel-soul-services/power-service' },
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
