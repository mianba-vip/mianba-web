#!/usr/bin/env bash
# ============================================================================
# mianba-web 独立部署：构建网页模式产物 → 上传源站 /opt/mianba/web-image/web/app
#                → 重建 web 镜像并重启容器 → /app 即时生效
#
# 只更新 SPA（web/app），不触碰官网首页（web/index.html）与 /download APK 目录。
#
# 用法（在仓库根目录任意位置执行）：
#   bash deploy/deploy-web.sh [--skip-build]
#
# 可配置环境变量（均有默认值）：
#   SSH_HOST   服务器 IP        默认 103.236.92.40
#   SSH_PORT   SSH 端口（NAT）  默认 37777
#   SSH_USER   SSH 用户名       默认 root
#   SSH_KEY    SSH 私钥路径     默认自动探测
#   DEPLOY_DIR 服务器部署目录   默认 /opt/mianba
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SKIP_BUILD=false
[ "${1:-}" = "--skip-build" ] && SKIP_BUILD=true

SSH_HOST="${SSH_HOST:-103.236.92.40}"
SSH_PORT="${SSH_PORT:-37777}"
SSH_USER="${SSH_USER:-root}"
if [ -z "${SSH_KEY:-}" ]; then
  for _k in "$HOME/.ssh/id_ed25519" "$HOME/.ssh/id_rsa" "/mnt/c/Users/31136/.ssh/id_rsa" "/c/Users/31136/.ssh/id_rsa"; do
    if [ -f "$_k" ]; then SSH_KEY="$_k"; break; fi
  done
fi
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_rsa}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/mianba}"

step() { echo; echo "==> $1"; }

# ssh/scp 解析：优先 Windows 自带 OpenSSH（Git Bash 自带的偶有损坏）
resolve_pair() {
  local d="${WINDIR:-/c/Windows}/System32/OpenSSH"
  if [ -x "$d/ssh.exe" ] && [ -x "$d/scp.exe" ] && "$d/ssh.exe" -V 2>&1 | grep -qi ssh; then
    SSH_BIN="$d/ssh.exe"; return 0
  fi
  SSH_BIN="$(command -v ssh 2>/dev/null || true)"
  [ -n "$SSH_BIN" ] || { echo "❌ 缺少可用的 ssh" >&2; exit 1; }
}
resolve_pair

SSH=("$SSH_BIN" -i "$SSH_KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=15 -p "$SSH_PORT")
REMOTE="$SSH_USER@$SSH_HOST"

# 原子上传目录：staging 换名（保留 .previous 供回滚），与后端 deploy 脚本同款
upload_tree() {
  local local_dir="$1"
  local remote_target="$2"
  local remote_parent="${remote_target%/*}"
  local remote_name="${remote_target##*/}"
  local remote_stage="$remote_parent/.${remote_name}.uploading"
  local remote_previous="$remote_parent/.${remote_name}.previous"

  "${SSH[@]}" "$REMOTE" \
    "set -e; rm -rf -- '$remote_stage'; mkdir -p '$remote_stage'"
  tar -C "$local_dir" -czf - . | \
    "${SSH[@]}" "$REMOTE" "tar -xzf - -C '$remote_stage'"
  "${SSH[@]}" "$REMOTE" \
    "set -e; rm -rf -- '$remote_previous'; \
     if [ -e '$remote_target' ]; then mv '$remote_target' '$remote_previous'; fi; \
     mv '$remote_stage' '$remote_target'"
}

# ---------- 0/3 预检 ----------
[ -f "$SSH_KEY" ] || { echo "❌ SSH 私钥不存在：$SSH_KEY"; exit 1; }
step "0/3 预检服务器连通性（${SSH_USER}@${SSH_HOST}:${SSH_PORT}）"
if ! "${SSH[@]}" "$REMOTE" 'command -v docker > /dev/null && echo SSH_OK' 2>/dev/null | grep -q SSH_OK; then
  echo "❌ 无法 SSH 到服务器（检查网络/密钥/端口）"
  exit 1
fi
echo "   ✓ SSH 连通"

# ---------- 1/3 构建 ----------
if [ "$SKIP_BUILD" = "true" ]; then
  step "1/3 跳过构建（--skip-build）"
else
  step "1/3 构建网页模式产物"
  npm run build:web
fi
[ -f dist/index.html ] || { echo "❌ dist/index.html 不存在"; exit 1; }
LOCAL_JS=$(grep -oE 'assets/index-[^"]+\.js' dist/index.html | head -1)
echo "   ✓ 产物: $LOCAL_JS"

# ---------- 2/3 上传 SPA（只替换 /app 子树，保留官网与 APK 下载） ----------
step "2/3 上传 SPA 到 ${DEPLOY_DIR}/web-image/web/app"
upload_tree "$ROOT/dist" "$DEPLOY_DIR/web-image/web/app"
echo "   ✓ 已上传（官网首页与 /download 不受影响）"

# ---------- 3/3 重建 web 镜像并重启容器 ----------
step "3/3 重建 web 镜像 + 重启容器"
"${SSH[@]}" "$REMOTE" \
  "export COMPOSE_FILE='$DEPLOY_DIR/docker-compose.yml'; \
   cd '$DEPLOY_DIR' && docker compose build web > /dev/null && docker compose up -d web" \
  2>&1 | grep -vE "version.*obsolete" | tail -3

# ---------- 验收 ----------
step "验收（源站本机回环 + 线上）"
sleep 2
REMOTE_JS=$("${SSH[@]}" "$REMOTE" "curl -s --max-time 8 http://127.0.0.1:18080/app/ | grep -oE 'assets/index-[^\"]+\.js' | head -1" 2>/dev/null || true)
echo "   本地产物: $LOCAL_JS"
echo "   线上引用: ${REMOTE_JS:-（未取到）}"
if [ -n "$REMOTE_JS" ] && [ "$REMOTE_JS" = "$LOCAL_JS" ]; then
  echo "✅ /app 已更新为本次构建"
else
  echo "⚠️ 线上引用与本地产物不一致（可能是 EdgeOne/浏览器缓存），稍后重试或强刷"
fi
echo "✅ 部署完成"
