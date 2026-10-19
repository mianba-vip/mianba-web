#!/usr/bin/env bash
# 一次性证书方案：在前端机安装 acme.sh 并用 DNS-01 签发 Let's Encrypt 证书
# （mianba.vip + www.mianba.vip，ISRG Root X1 链，Chrome/Safari/Firefox/Edge 全平台受信），
# 安装到 $DEPLOY_DIR/certs/ 并配置自动续期（acme.sh 自带 cron，续期后自动 reload nginx）。
#
# 为什么弃用现有 TrustAsia 证书：其链终于 TrustAsia TLS RSA Root CA，
# 仅 Chrome/Chromium 系信任，Apple(Safari/iOS)/Microsoft(Windows)/Mozilla(Firefox) 均未收录，
# EdgeOne 切走后这些浏览器会直接报证书错误。
#
# 为什么用 DNS-01：域名 DNS 在 DNSPod（腾讯云）；HTTP-01 需要域名先解析到本机，
# 而备案接入通过前阿里云拦截域名访问，形成死锁。DNS-01 不碰服务器，随时可签。
# （acme.sh 会把 DP_Id/DP_Key 存到前端机 ~/.acme.sh/account.conf 供续期使用。）
#
# 用法（在本仓库根目录）：
#   DP_ID=12345 DP_KEY=xxxxxx bash deploy/setup-cert.sh
# 可选：ACME_EMAIL=you@example.com（LE 到期提醒）
# DNSPod API 密钥：console.dnspod.cn → 账号中心 → API 密钥（DP_Id + DP_Key）。
set -Eeuo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/deploy/ssh-common.sh"
cd "$ROOT"

DEPLOY_DIR="${DEPLOY_DIR:-/opt/mianba-web}"
ACME_EMAIL="${ACME_EMAIL:-}"

# 严格校验输入，避免拼进远端命令的注入面
[[ "${DP_ID:-}" =~ ^[0-9]{1,10}$ ]] || { echo 'DP_ID 必须是 DNSPod 数字 ID' >&2; exit 1; }
[[ "${DP_KEY:-}" =~ ^[A-Za-z0-9_-]{20,64}$ ]] || { echo 'DP_KEY 格式不正确（应为 20-64 位 DNSPod API Token）' >&2; exit 1; }
[[ -z "${ACME_EMAIL:-}" || "${ACME_EMAIL}" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$ ]] || { echo 'ACME_EMAIL 格式不正确' >&2; exit 1; }
[[ "$DEPLOY_DIR" =~ ^/[A-Za-z0-9._/-]+$ && "$DEPLOY_DIR" != / &&
   ! "$DEPLOY_DIR" =~ (^|/)\.\.(/|$) ]] || { echo 'DEPLOY_DIR 必须是安全的绝对路径' >&2; exit 1; }

echo '==> 1/5 预检前端机依赖'
"${SSH[@]}" "$REMOTE" "set -eu; command -v curl
  command -v crontab >/dev/null || echo '警告：前端机无 crontab，自动续期需改用 systemd timer 自行安排'"

echo '==> 2/5 安装 acme.sh（已装则跳过；GitHub 失败自动换 gitee 镜像）'
"${SSH[@]}" "$REMOTE" 'set -eu
  if [ ! -s "$HOME/.acme.sh/acme.sh" ]; then
    curl -fsS https://get.acme.sh | sh -s email=acme@mianba.vip ||
      { git clone --depth 1 https://gitee.com/neilpang/acme.sh.git /tmp/acme.sh-install &&
        cd /tmp/acme.sh-install && ./acme.sh --install -m acme@mianba.vip; }
  fi
  "$HOME/.acme.sh/acme.sh" --version >/dev/null'

echo "==> 3/5 DNS-01 签发 Let's Encrypt 证书（含 www；失败会保留原证书不动）"
"${SSH[@]}" "$REMOTE" "set -eu; export DP_Id='$DP_ID' DP_Key='$DP_KEY';
  \$HOME/.acme.sh/acme.sh --issue --dns dns_dp --server letsencrypt \\
    -d mianba.vip -d www.mianba.vip ${ACME_EMAIL:+--accountemail} ${ACME_EMAIL:+$ACME_EMAIL} ||
    { ec=\$?; echo '签发失败：最常见原因是 DNSPod API 密钥/权限，或域名不在该 DNSPod 账号下' >&2; exit \$ec; }"

echo '==> 4/5 备份旧证书并安装新证书（reloadcmd 会被续期时自动重放）'
"${SSH[@]}" "$REMOTE" "set -eu
  install -d -m 700 '$DEPLOY_DIR/certs'
  ts=\$(date -u +%Y%m%dT%H%M%SZ)
  for f in mianba.vip.pem mianba.vip.key; do
    if [ -s '$DEPLOY_DIR/certs/'\$f ]; then cp -a '$DEPLOY_DIR/certs/'\$f '$DEPLOY_DIR/certs/'\$f.bak-\$ts; fi
  done
  \$HOME/.acme.sh/acme.sh --install-cert -d mianba.vip \\
    --fullchain-file '$DEPLOY_DIR/certs/mianba.vip.pem' \\
    --key-file '$DEPLOY_DIR/certs/mianba.vip.key' \\
    --reloadcmd 'nginx -t && systemctl reload nginx'
  chmod 600 '$DEPLOY_DIR/certs/mianba.vip.key'"

echo '==> 5/5 验证：证书链/有效期/本机 HTTPS（回环不受阿里云域名拦截影响）'
"${SSH[@]}" "$REMOTE" "set -eu
  openssl x509 -in '$DEPLOY_DIR/certs/mianba.vip.pem' -noout -issuer -enddate -ext subjectAltName
  curl -fsS --max-time 15 --resolve mianba.vip:443:127.0.0.1 https://mianba.vip/actuator/health
  echo; echo '自动续期 cron：'; crontab -l | grep -F acme.sh || echo '（未发现 acme.sh cron，请手动确认）'"

echo
echo "CERT_OK: 新证书已就位并接管 $DEPLOY_DIR/certs/；旧证书备份为 *.bak-*"
echo '注意：公网带 SNI 验证仍需等阿里云接入备案通过后进行（见 CUTOVER.md）。'
