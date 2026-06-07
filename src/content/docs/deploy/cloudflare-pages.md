---
title: Cloudflare Pages 部署
description: zty-blog 的 GitHub 自动构建与 Cloudflare Pages 发布方式。
---

这个博客使用 Cloudflare Pages 托管。

## GitHub 的作用

GitHub 不是访问博客的地方，它负责：

- 保存博客源码。
- 保存 Markdown 文章。
- 每次 push 后触发 Cloudflare Pages 自动构建。

Cloudflare 才是真正托管和对外访问博客的地方。

## Cloudflare Pages 配置

在 Cloudflare Dashboard 中：

```text
Workers & Pages
  -> Pages
  -> Import Git repository
  -> 选择 zhengtongyi/zty-blog
```

构建配置：

| 项目 | 值 |
| --- | --- |
| Framework preset | Astro |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Production branch | `main` |

## 域名

第一版不需要自定义域名。Cloudflare Pages 会提供一个免费地址：

```text
https://zty-blog.pages.dev
```

后续如果绑定自定义域名，只需要在 Cloudflare Pages 的 Custom Domains 中添加。域名到期或更换时，不影响 GitHub 仓库和博客项目。

