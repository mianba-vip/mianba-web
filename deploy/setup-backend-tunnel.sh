#!/usr/bin/env bash
# 一次性建立前端到后端的 SSH 隧道；私钥只在前端机生成并保存。
set -Eeuo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/deploy/ssh-common.sh"
BACKEND_HOST="${BACKEND_HOST:-103.236.92.40}"
BACKEND_SSH_PORT="${BACKEND_SSH_PORT:-37777}"
BACKEND_USER="${BACKEND_USER:-root}"
[[ "$BACKEND_HOST" =~ ^[A-Za-z0-9.-]+$ && "$BACKEND_USER" =~ ^[A-Za-z0-9_-]+$ &&
   "$BACKEND_SSH_PORT" =~ ^[0-9]+$ ]] || exit 1
BACKEND_SSH=("$SSH_BIN" -i "$SSH_KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new
  -o ConnectTimeout=15 -p "$BACKEND_SSH_PORT" "$BACKEND_USER@$BACKEND_HOST")
"${SSH[@]}" "$REMOTE" 'set -eu; install -d -m 700 /etc/mianba-web;
  if [ ! -f /etc/mianba-web/backend_ed25519 ]; then
    ssh-keygen -q -t ed25519 -N "" -C mianba-frontend-backend-tunnel -f /etc/mianba-web/backend_ed25519;
  fi'
TUNNEL_PUB="$("${SSH[@]}" "$REMOTE" 'cat /etc/mianba-web/backend_ed25519.pub')"
[[ "$TUNNEL_PUB" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+\ mianba-frontend-backend-tunnel$ ]] || exit 1
"${BACKEND_SSH[@]}" "set -eu; umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys;
  if ! grep -qF '$TUNNEL_PUB' ~/.ssh/authorized_keys; then
    printf '\n%s\n' 'restrict,port-forwarding,permitopen=\"127.0.0.1:23333\",command=\"/bin/false\" $TUNNEL_PUB' >> ~/.ssh/authorized_keys;
  fi"
# 通过已经认证的管理会话读取 host key，隧道严格校验。
HOST_KEY="$("${BACKEND_SSH[@]}" 'cat /etc/ssh/ssh_host_ed25519_key.pub')"
[[ "$HOST_KEY" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+ ]] || exit 1
HOST_KEY_NAME="$BACKEND_HOST"
if [[ "$BACKEND_SSH_PORT" != 22 ]]; then HOST_KEY_NAME="[$BACKEND_HOST]:$BACKEND_SSH_PORT"; fi
printf '%s %s\n' "$HOST_KEY_NAME" "$HOST_KEY" | \
  "${SSH[@]}" "$REMOTE" 'umask 077; cat > /etc/mianba-web/backend_known_hosts'
sed -e "s|__BACKEND_HOST__|$BACKEND_HOST|g" \
    -e "s|__BACKEND_SSH_PORT__|$BACKEND_SSH_PORT|g" \
    -e "s|__BACKEND_USER__|$BACKEND_USER|g" "$ROOT/deploy/mianba-backend-tunnel.service" | \
  "${SSH[@]}" "$REMOTE" 'cat > /etc/systemd/system/mianba-backend-tunnel.service;
    systemctl daemon-reload; systemctl enable mianba-backend-tunnel; systemctl restart mianba-backend-tunnel'
"${SSH[@]}" "$REMOTE" 'set -eu;
  for attempt in $(seq 1 15); do
    if curl -fsS --max-time 5 http://127.0.0.1:23333/healthz; then echo; exit 0; fi;
    sleep 2;
  done;
  journalctl -u mianba-backend-tunnel -n 20 --no-pager; exit 1'
