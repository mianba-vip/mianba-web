# 切换手册：EdgeOne → 直连新前端机（106.14.143.151）

> 前提：阿里云「接入备案」已提交、等待管局审核（2026-10 状态：备案为腾讯云接入，
> 新机在阿里云名下无接入记录，带域名 SNI 的公网握手被阿里云拦截——这是当前唯一阻断项）。
> 本手册第一部分在等待期就能全部做完；备案通过当天只跑「切换日」部分。

## 一、等待期准备清单（现在就做）

### 1. 后端不再公网暴露明文 23333（最重要）

后端机上（103.236.92.40，SSH 端口 37777）：

```bash
# /opt/mianba/.env 里把（若没有这行则加上）：
#   BACKEND_BIND_ADDRESS=127.0.0.1
# 然后重建 backend 使端口映射生效（注意：会重启后端，API 中断约半分钟，挑低峰执行）：
cd /opt/mianba
docker compose -f docker-compose.prod.yml up -d backend
# 验证三件事：
curl -fsS http://127.0.0.1:23333/healthz                 # 后端机本机健康
# 前端机上：隧道经回环打后端，应同样 200：
curl -fsS http://127.0.0.1:23333/healthz
# 后端机上：公网地址应当连不上（预期 refused/timeout）：
curl -m 5 http://103.236.92.40:23333/healthz || echo 'OK: 公网已不可达'
```

仓库默认值已改为 `127.0.0.1`（docker-compose.prod.yml 与 .env.example），服务器 .env 以显式配置为准。
另外到阿里云/机房控制台确认 23333 不在安全组放行列表（双保险）。

### 2. 换全平台受信证书 + 自动续期

在本地（本仓库根目录）：

```bash
# DNSPod → 账号中心 → API 密钥，创建 DP_Id + DP_Key 后：
DP_ID=12345 DP_KEY=xxxx bash deploy/setup-cert.sh
```

Let's Encrypt（ISRG Root X1 链）签发 `mianba.vip + www.mianba.vip`，装到前端机
`/opt/mianba-web/certs/`（旧 TrustAsia 证书自动备份），acme.sh cron 到期自动续、自动 reload nginx。
脚本末尾会在前端机本机回环验证 HTTPS——回环不受阿里云 SNI 拦截影响，现在就能验。
签发只动 DNSPod 解析记录，与备案状态无关。

### 3. 发布一次前端（带上 HSTS 补齐等 nginx 改动）

```bash
bash deploy/deploy-web.sh
```

### 4. 提前降 DNS TTL

DNSPod 控制台把 `mianba.vip` 和 `www.mianba.vip` 的 TTL 调到 300 秒（提前 ≥1 天调，
让旧 TTL 过期），切换日生效才快、回退才快。

## 二、切换日（备案通过后）

### 第 1 步：确认阿里云放行域名 SNI

从任一公网机器：

```bash
curl --resolve mianba.vip:443:106.14.143.151 https://mianba.vip/actuator/health
```

返回 200（JSON）→ 放行，继续。仍被 reset → 备案拦截未同步，去阿里云备案控制台确认状态为
「已完成」，仍拦截就提工单要求刷新拦截白名单（通常过审后几小时内自动解除）。

### 第 2 步：直连验收（DNS 未动，零风险）

```bash
for p in / /app/ /actuator/health /api/auth/config; do
  curl -fsS --max-time 20 --resolve mianba.vip:443:106.14.143.151 "https://mianba.vip$p" -o /dev/null && echo "OK $p"
done
```

再用真浏览器（改 hosts 或用上面 --resolve 的思路）：**Chrome、Safari（或 iPhone）、Firefox**
三个都要开一次 `https://mianba.vip/`，证书栏无警告——这一步专门验证新证书链全平台受信。

### 第 3 步：DNS 切换（DNSPod 控制台）

- `mianba.vip`：CNAME `mianba.vip.eo.dnse0.com` → **A 记录 `106.14.143.151`**
- `www.mianba.vip`：同样改为 A `106.14.143.151`（或 CNAME 指向 mianba.vip）
- 验证：`dig mianba.vip +short @119.29.29.29` 返回 `106.14.143.151`

### 第 4 步：真机验收

- `curl https://mianba.vip/actuator/health`（走真实 DNS）
- 手机 App 打开一节练习（域名没变，应当无缝）；桌面版同样点一遍
- Android APK 下载链接 `/download/...` 可下载
- 若个别用户端还命中 EdgeOne 旧缓存 HTML：EdgeOne 控制台刷新 `/` 和 `/app/` 缓存
  （旧 TTL 未过期期间，流量即使仍走 EdgeOne，其回源链路也通向新机，业务不中断）

### 第 5 步：观察 24–48 小时

重点：出题 SSE 流式不断流、移动端预取正常、文件上传（50MB 上限）、Grafana 面板无 5xx 尖峰。

## 三、回退路径（任意时刻可用）

DNS 把两条记录改回 CNAME `mianba.vip.eo.dnse0.com` 即可（TTL 已降，分钟级生效）。
EdgeOne → 旧机过渡入口 → 新机的链路全程保持未拆，服务器侧无需任何操作。
DNS 回切后可再检查旧机两个过渡入口配置仍在（见 README「运维和回退」）。

## 四、收尾（稳定运行 ≥1 周后）

1. EdgeOne 控制台停用 mianba.vip 加速（腾讯云侧备案接入保留，无害）。
2. 旧机过渡入口退役：宿主机 `/etc/nginx/conf.d/mianba.conf` 可保留（它只会把请求转去新机，留着等于多一条兜底入口），legacy web 容器可 `docker compose stop web`（确认 DNS 已不再经 EdgeOne）。
3. 阿里云安全组复核：仅放行 80/443 + 管理 SSH 端口。
4. 前端机 `certs/*.bak-*` 旧证书备份保留 1–2 个续期周期后清理。
5. 若 EdgeOne 计费资源不再使用，释放之；`mianba.vip.eo.dnse0.com` 的 CNAME 已不存在，无需处理。

## 附：为什么当时被拦（备忘）

备案 = 主体 + 域名 + 接入商。本域名接入商为腾讯云（域名在腾讯云购、备案经腾讯云提交）；
旧杂牌机时代「备案在腾讯、托管在杂牌」，杂牌不查 + 对外入口是 EdgeOne（腾讯系），故未暴露。
入口换成阿里云机器后，阿里云名下无此域名接入记录 → 拦带域名 SNI 的 443。接入备案只是
在阿里云名下补一条接入记录，主体/域名/备案号均不变。
