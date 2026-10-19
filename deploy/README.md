# 前后端分机部署

| 服务 | 位置 |
|---|---|
| Nginx、官网、Web SPA、APK 下载 | `106.14.143.151`，`/opt/mianba-web` |
| Spring Boot、PostgreSQL、Redis、MinIO | `103.236.92.40`，`/opt/mianba` |
| API 上游 | 前端机 `127.0.0.1:23333`，经 SSH 隧道连接后端机 `127.0.0.1:23333` |

网页继续使用 `.env.web` 中的空 `VITE_API_BASE`，浏览器请求同源 `/api`。
SSE 关闭 Nginx 缓冲、缓存和压缩，读写超时为 3600 秒。上传限制仍为 50MB。

## 首次准备

前端机安装 `nginx`、`curl`、`ca-certificates`、`openssh-client` 和 `tar`，本机管理公钥加入前端机 `~/.ssh/authorized_keys`。
前端安全组开放 TCP 443、管理 SSH 端口；若需要 HTTP 自动跳转，也开放 TCP 80。
前端机须能出站连接后端 `103.236.92.40:37777`。

将 `mianba.vip.pem`（完整证书链）和 `mianba.vip.key` 放到前端机 `/opt/mianba-web/certs/`。
私钥权限为 600，证书不得提交到 Git。

**证书推荐直接走自动签发（见下），替代手动放置的 TrustAsia 证书**：现有 TrustAsia 证书的链终止于
`TrustAsia TLS RSA Root CA`，该根仅 Chrome/Chromium 系收录，Apple（Safari/iOS）、Microsoft（Windows）、
Mozilla（Firefox）均未收录（Cloudflare Radar / Chrome Root Store 可查证）——EdgeOne 还在前时用户看到的是
EdgeOne 边缘证书所以未暴露；一旦直连新源站，这些浏览器会报证书错误。

在本地 Git Bash / Linux 执行：

```bash
bash deploy/setup-backend-tunnel.sh
DP_ID=<DNSPod数字ID> DP_KEY=<DNSPod API Token> bash deploy/setup-cert.sh
bash deploy/deploy-web.sh
```

`setup-cert.sh` 在前端机安装 acme.sh 并用 DNS-01 签发 Let's Encrypt 证书（`mianba.vip` + `www.mianba.vip`，
ISRG Root X1 链全平台受信），安装到 `/opt/mianba-web/certs/`（旧证书自动备份为 `*.bak-*`），续期由 acme.sh
自带的 cron 自动完成并重载 Nginx。DNS-01 只动 DNSPod 解析、不碰服务器，接入备案通过前即可签发。
DNSPod API 密钥在 console.dnspod.cn → 账号中心 → API 密钥 创建；acme.sh 会把密钥存在前端机
`~/.acme.sh/account.conf` 供续期使用。`deploy-remote.sh` 现要求证书剩余有效期 ≥ 7 天，否则发布失败提醒续期。

隧道私钥在前端机 `/etc/mianba-web/backend_ed25519` 生成，后端只加入专用受限公钥。
后端主机密钥通过已认证的管理连接读取并固定，隧道不跳过 SSH 主机身份校验。
`mianba-backend-tunnel.service` 开机启动，连接中断自动重连。

## 后续发布

```bash
bash deploy/deploy-web.sh
# 已经执行过 npm run build:web 时：
bash deploy/deploy-web.sh --skip-build
```

可配置 `SSH_HOST`、`SSH_PORT`、`SSH_USER`、`SSH_KEY`、`DEPLOY_DIR` 和 `OFFICIAL_SITE_DIR`。
最终公网验收默认经过现有域名入口；设置 `CHECK_DIRECT_ORIGIN=true` 可强制绕过 DNS/CDN，直接验证新 IP 的域名 HTTPS。
官网源码默认依次探测相邻的 `../interview-homegrown/official-site` 与 `../interview/official-site`，包含 `/download`。
官网源码缺失时沿用服务器当前官网和下载文件；首次部署必须提供官网源码。
单独更新 APK 时，将文件放入上述官网源码的 `download/`，再执行前端发布。
后端仍使用它自己的 `deploy/deploy-local.sh`，该脚本不再上传前端或重建旧 Web 容器。

每次发布创建 `releases/<版本>`，完成后原子切换 `current` 链接，上一版记录为 `previous`。
带哈希的旧版静态资源会保留，以兼容 CDN 缓存及已经打开的旧页面。
远端检查 Nginx、域名证书、SPA 入口/JS、官网、健康接口和认证配置；失败自动恢复旧配置和版本。
最后从本地验证当前域名入口的 HTTPS、健康接口和本次 HTML 引用。公网验收失败会返回错误，但不会撤销已经通过远端检查的源站发布。
版本目录暂不自动清理，按磁盘情况手动保留需要的版本。

## 域名和 EdgeOne

当前 DNS 是 `mianba.vip → mianba.vip.eo.dnse0.com`，仍经过 EdgeOne。
EdgeOne 实际回源旧服务器 `18080` 的 Web 容器。容器过渡入口配置见后端仓库 `deploy/nginx-container-entry.conf`，宿主机入口配置见 `deploy/nginx-entry.conf`；二者都通过验证证书的 HTTPS 转发到新机。

要让访问直接走新源站，可选择：

- 保留 EdgeOne：将源站改为 `106.14.143.151`，回源协议 HTTPS、端口 443，回源 Host 为 `mianba.vip`；SNI 配置须结合下述公网握手现象核查。
- 直连源站：将相应域名的 CNAME 改为 A 记录 `106.14.143.151`。证书覆盖 `www`，其 DNS 也需相应配置。

切换后按需刷新 EdgeOne 的 `/` 和 `/app/` HTML 缓存。443 证书用于域名，访问裸 IP 不会通过域名证书校验。
本次迁移没有修改 DNS 或 EdgeOne 控制台配置；旧回源入口已经转发到新机。若普通 `/app/` 仍命中旧 HTML，刷新 EdgeOne 对应缓存即可；带新版本参数的 URL 可直接验证本次构建。
2026-10-18 复核时，新机公网 443 携带 `mianba.vip` / `www.mianba.vip` 的 SNI 会被重置，但不携带 SNI 时证书链及域名验证成功，服务器本机 HTTPS 也正常。
**根因已确认（2026-10-19）：备案的接入商是腾讯云（域名在腾讯云购买、备案经腾讯云提交），阿里云名下无此域名的接入记录，故被阿里云拦截。解决办法是在阿里云做「接入备案」（主体/域名/备案号不变，仅补接入记录），审核期间零停机。**

**切换流程、等待期准备清单与回退路径见 [CUTOVER.md](CUTOVER.md)。**
旧机两个过渡入口暂使用 `proxy_ssl_server_name off`，同时保留 `proxy_ssl_verify on` 和 `proxy_ssl_name mianba.vip`，仍验证新机证书链与域名。新机须继续将该证书用作默认 443 站点；公网域名握手恢复后可将回源 SNI 恢复为 on。
公网域名握手问题排除后，可不修改本地 DNS 验证新站：

```bash
curl --resolve mianba.vip:443:106.14.143.151 https://mianba.vip/actuator/health
```

## 运维和回退

在前端机查看：

```bash
systemctl status nginx mianba-backend-tunnel
journalctl -u mianba-backend-tunnel -n 50 --no-pager
nginx -t
readlink /opt/mianba-web/current
```

回退到上一版静态内容（在前端机执行，Nginx 无需重启）：

```bash
cd /opt/mianba-web
ln -s "$(readlink previous)" rollback-current
mv -Tf rollback-current current
```

旧服务器原静态树和原 Web 镜像 `mianba-web:before-front-move-20261018` 保留供回退。
容器入口回退时，先将 `/opt/mianba/web-image/nginx.conf.before-front-move-20261018` 恢复为 `nginx.conf`，然后 `docker compose build web && docker compose up -d --no-deps web`。
宿主机入口回退时，将 `/etc/nginx/conf.d/mianba.conf.before-front-move-20261018` 恢复后执行 `nginx -t && systemctl reload nginx`。

## 2026-10-18 验收记录

- Web 构建（含 TypeScript 检查）和 Bash 语法检查通过，两个生产 Compose 文件校验通过。
- 源站本机的 HTTPS 证书校验、官网、`/app`、JS、APK 下载、`/actuator/health`、`/api/auth/config` 均通过；受保护接口返回 401。公网按 IP 回源并验证域名证书通过，携带域名 SNI 的直连问题如上记录。
- 宿主机入口与 EdgeOne 的旧容器入口均已切至新前端，未重启后端和数据库。
- 入口 HTML、主 JS、APK 的 SHA-256 与本地文件一致；主 JS 为 `assets/index-BxKQKLYv.js`。
- Nginx 与 SSH 隧道均为 active，开机启动已启用；部署中已验证失败自动恢复旧配置，以及后续重复发布。
- 未使用应用账号执行登录或付费 AI 流式调用；SSE 保留禁用缓冲、压缩与长超时配置。

配置参考：[Nginx 反向代理文档](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)、[Docker Compose profiles](https://docs.docker.com/compose/how-tos/profiles/)。
