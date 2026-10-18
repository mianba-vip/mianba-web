#!/usr/bin/env bash
# 独立前端机：官网 + /app + /download；后端仍在 103.236.92.40。
# 首次运行 setup-backend-tunnel.sh，并将域名证书放进服务器 $DEPLOY_DIR/certs/。
# 用法：bash deploy/deploy-web.sh [--skip-build]
set -Eeuo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/deploy/ssh-common.sh"
cd "$ROOT"
SKIP_BUILD=false
case "${1:-}" in
  '') ;;
  --skip-build) SKIP_BUILD=true ;;
  *) echo "用法：bash deploy/deploy-web.sh [--skip-build]" >&2; exit 1 ;;
esac
DEPLOY_DIR="${DEPLOY_DIR:-/opt/mianba-web}"
OFFICIAL_SITE_DIR="${OFFICIAL_SITE_DIR:-$ROOT/../interview-homegrown/official-site}"
[[ "$DEPLOY_DIR" =~ ^/[A-Za-z0-9._/-]+$ && "$DEPLOY_DIR" != / &&
   ! "$DEPLOY_DIR" =~ (^|/)\.\.(/|$) ]] || { echo 'DEPLOY_DIR 必须是安全的绝对路径' >&2; exit 1; }
echo "==> 预检前端机 $REMOTE:$SSH_PORT"
"${SSH[@]}" "$REMOTE" "set -eu; command -v nginx; command -v curl; command -v tar;
  test -s '$DEPLOY_DIR/certs/mianba.vip.pem'; test -s '$DEPLOY_DIR/certs/mianba.vip.key';
  systemctl is-active --quiet mianba-backend-tunnel;
  curl -fsS --max-time 15 http://127.0.0.1:23333/healthz"
if [[ "$SKIP_BUILD" != true ]]; then
  echo '==> 构建网页模式（相对 /api）'
  npm run build:web
fi
test -s dist/index.html
LOCAL_JS="$(grep -oE 'assets/index-[^" ]+\.js' dist/index.html | head -1)"
test -n "$LOCAL_JS"
RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short HEAD)-$$"
STAGE="$DEPLOY_DIR/releases/$RELEASE_ID"
# 保留完整旧版本和旧版带哈希的资源，兼容已打开的页面及 CDN 缓存。
echo "==> 上传至 $STAGE"
"${SSH[@]}" "$REMOTE" "set -eu; install -d -m 755 '$DEPLOY_DIR/releases';
  mkdir '$STAGE';
  if [ -L '$DEPLOY_DIR/current' ]; then cp -a '$DEPLOY_DIR/current/.' '$STAGE/'; fi;
  mkdir -p '$STAGE/app'"
if [[ -f "$OFFICIAL_SITE_DIR/index.html" ]]; then
  tar -C "$OFFICIAL_SITE_DIR" -czf - . | "${SSH[@]}" "$REMOTE" "tar -xzf - -C '$STAGE'"
fi
tar -C "$ROOT/dist" -czf - . | "${SSH[@]}" "$REMOTE" "tar -xzf - -C '$STAGE/app'"
tar -C "$ROOT/deploy" -czf - nginx.conf deploy-remote.sh | \
  "${SSH[@]}" "$REMOTE" "mkdir -p '$STAGE/.deploy'; tar -xzf - -C '$STAGE/.deploy'"
echo '==> Nginx 校验、原子切换和 HTTPS/API 验收（失败自动回退）'
"${SSH[@]}" "$REMOTE" "bash '$STAGE/.deploy/deploy-remote.sh' '$DEPLOY_DIR' '$RELEASE_ID' '$LOCAL_JS'"
echo '==> 从部署端验证当前域名入口的 HTTPS 和本次构建'
CURL_BIN="$(command -v curl.exe || command -v curl)"
CURL_TLS=()
# Schannel 无法连接 CRL 时只放宽离线吊销查询，仍验证证书链和域名。
if "$CURL_BIN" -V | grep -qi Schannel; then CURL_TLS+=(--ssl-revoke-best-effort); fi
CURL_ROUTE=()
if [[ "${CHECK_DIRECT_ORIGIN:-false}" == true ]]; then
  CURL_ROUTE+=(--resolve "mianba.vip:443:$SSH_HOST")
fi
"$CURL_BIN" "${CURL_TLS[@]}" "${CURL_ROUTE[@]}" -fsS --max-time 20 \
  https://mianba.vip/actuator/health
"$CURL_BIN" "${CURL_TLS[@]}" "${CURL_ROUTE[@]}" -fsS --max-time 20 \
  "https://mianba.vip/app/?release=$RELEASE_ID" | grep -F "$LOCAL_JS" >/dev/null
echo
echo "DEPLOY_OK: https://mianba.vip/app/ → 前端源站 $SSH_HOST"
