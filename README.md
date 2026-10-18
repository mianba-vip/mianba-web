# 面霸 · Web 端

面霸的网页端 SPA，部署于 `mianba.vip/app`（与官网同源）。
原为后端单体仓库（interview）中的 `frontend/` 目录，已拆分为独立项目。

## 技术栈

React 18 · TypeScript · Vite · react-markdown · CodeMirror · Tailwind 风格自研 UI

## 与后端的关系

纯前端项目，API 同源（网页部署在 `mianba.vip/app`，`/api` 由同域 nginx 转发给 Spring Boot 后端）：

- `npm run build:web`（网页模式）：API 走同源相对路径，部署时与官网一起放进 nginx
- `npm run build`（桌面模式）：构建时把 `VITE_API_BASE` 烘焙为后端地址，供 Electron 桌面端打包使用

## 开发

```bash
npm install
npm run dev        # /api 代理目标在 vite.config.ts（默认指向线上源站，可改本地后端）
```

## 构建

```bash
npm run build:web   # 网页模式（tsc + vite，输出 dist/）
npm run build       # 桌面模式
```

## 目录结构

| 路径 | 说明 |
|---|---|
| `src/pages/` | 页面（练习 Drill / 复盘 Review / 知识库 / 设置等） |
| `src/api/` | 后端接口封装（drill / auth / knowledge / user 等） |
| `src/components/` | 通用组件（Markdown、滑块验证、对话流等） |
| `tests/` | 测试 |
| `public/` | 静态资源 |

## 部署

前端部署到 `106.14.143.151:443`，后端与数据库保留在 `103.236.92.40`。
新服务器的宿主机 Nginx 提供官网、`/app` 和 `/download`；`/api` 经加密 SSH 隧道转发给原后端。

```bash
bash deploy/deploy-web.sh
```

默认使用 `root@106.14.143.151:22`、`~/.ssh/id_ed25519` 和 `/opt/mianba-web`。
首次准备、证书、域名/CDN 切换及回退步骤见 [部署说明](deploy/README.md)。
